package server

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/mrpoundsign/appinstaller/pkg/updater"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

func buildMockArchiveForHost(t *testing.T, exePayload []byte) (assetName string, archiveBytes []byte, sha256Hex string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		assetName = fmt.Sprintf("SVGTuber-v0.0.8-windows-%s.zip", runtime.GOARCH)
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, err := zw.Create("svgtuber.exe")
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := w.Write(exePayload); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
		if err := zw.Close(); err != nil {
			t.Fatalf("close zip: %v", err)
		}
		archiveBytes = buf.Bytes()
	} else {
		assetName = fmt.Sprintf("SVGTuber-v0.0.8-%s-%s.tar.gz", runtime.GOOS, runtime.GOARCH)
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		tw := tar.NewWriter(gz)
		hdr := &tar.Header{
			Name:     "svgtuber",
			Mode:     0755,
			Size:     int64(len(exePayload)),
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := tw.Write(exePayload); err != nil {
			t.Fatalf("write tar body: %v", err)
		}
		if err := tw.Close(); err != nil {
			t.Fatalf("close tar: %v", err)
		}
		if err := gz.Close(); err != nil {
			t.Fatalf("close gzip: %v", err)
		}
		archiveBytes = buf.Bytes()
	}
	sum := sha256.Sum256(archiveBytes)
	sha256Hex = hex.EncodeToString(sum[:])
	return assetName, archiveBytes, sha256Hex
}

func TestAPIUpdateCheckAndApply(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	if err := os.WriteFile(avatarPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="head"/></svg>`), 0644); err != nil {
		t.Fatalf("write test avatar: %v", err)
	}

	exeName := "svgtuber"
	if runtime.GOOS == "windows" {
		exeName = "svgtuber.exe"
	}
	targetExe := filepath.Join(tempDir, exeName)
	if err := os.WriteFile(targetExe, []byte("old-binary-v0.0.7"), 0755); err != nil {
		t.Fatalf("write mock target exe: %v", err)
	}

	newPayload := []byte("new-binary-v0.0.8-verified")
	assetName, archiveBytes, assetHash := buildMockArchiveForHost(t, newPayload)

	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/mrpoundsign/SVGTuber/releases/latest":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "v0.0.8",
				"name":     "SVGTuber v0.0.8",
				"body":     "### What's New\n- Unified installer and self-updater",
				"html_url": "https://github.com/mrpoundsign/SVGTuber/releases/tag/v0.0.8",
				"assets": []map[string]any{
					{
						"name":                 assetName,
						"browser_download_url": ghServer.URL + "/download/" + assetName,
						"size":                 len(archiveBytes),
					},
					{
						"name":                 "checksums.txt",
						"browser_download_url": ghServer.URL + "/download/checksums.txt",
						"size":                 128,
					},
				},
			})
		case "/download/checksums.txt":
			_, _ = fmt.Fprintf(w, "%s  %s\n", assetHash, assetName)
		case "/download/" + assetName:
			_, _ = w.Write(archiveBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	srv := New(0, avatarPath, NewHub(), tracking.NewEngine())
	srv.SetVersion("0.0.7", "abc1234", "2026-10-31")
	chk := updater.NewChecker("mrpoundsign", "SVGTuber")
	chk.APIBaseURL = ghServer.URL
	srv.SetUpdateChecker(chk)
	srv.SetUpdateTargetExe(targetExe)

	var appliedAsset, appliedExe string
	var appliedMode updater.InstallMode
	srv.SetUpdateApplyFunc(func(verifiedAssetPath, targetExePath string, mode updater.InstallMode) error {
		appliedAsset = verifiedAssetPath
		appliedExe = targetExePath
		appliedMode = mode
		return updater.ReplacePortableBinary(verifiedAssetPath, targetExePath)
	})

	// 1. Check for update when 0.0.7 < 0.0.8
	reqCheck := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	recCheck := httptest.NewRecorder()
	srv.handleAPIUpdateCheck(recCheck, reqCheck)
	if recCheck.Code != http.StatusOK {
		t.Fatalf("GET /api/update/check status = %d, body = %s", recCheck.Code, recCheck.Body.String())
	}

	var checkResp UpdateCheckResponse
	if err := json.NewDecoder(recCheck.Body).Decode(&checkResp); err != nil {
		t.Fatalf("decode check response: %v", err)
	}
	if !checkResp.UpdateAvailable {
		t.Fatalf("expected UpdateAvailable = true, got false (%+v)", checkResp)
	}
	if checkResp.LatestVersion != "0.0.8" {
		t.Errorf("LatestVersion = %q, want 0.0.8", checkResp.LatestVersion)
	}
	if checkResp.AssetName != assetName {
		t.Errorf("AssetName = %q, want %q", checkResp.AssetName, assetName)
	}

	// 2. Apply update via POST /api/update/apply
	reqApply := httptest.NewRequest(http.MethodPost, "/api/update/apply", nil)
	recApply := httptest.NewRecorder()
	srv.handleAPIUpdateApply(recApply, reqApply)
	if recApply.Code != http.StatusOK {
		t.Fatalf("POST /api/update/apply status = %d, body = %s", recApply.Code, recApply.Body.String())
	}

	if appliedAsset == "" || appliedExe != targetExe {
		t.Fatalf("expected custom apply callback to be invoked on %s, got asset=%q exe=%q mode=%q", targetExe, appliedAsset, appliedExe, appliedMode)
	}

	updatedBytes, err := os.ReadFile(targetExe)
	if err != nil {
		t.Fatalf("read updated binary: %v", err)
	}
	if !bytes.Equal(updatedBytes, newPayload) {
		t.Errorf("updated binary content = %q, want %q", string(updatedBytes), string(newPayload))
	}
	if _, err := os.Stat(targetExe + ".old"); err != nil {
		t.Errorf("expected backup binary %s.old to exist: %v", targetExe, err)
	}

	// 3. When version is already 0.0.8, /api/update/check reports updateAvailable=false
	srv.SetVersion("0.0.8", "def5678", "2026-10-31")
	reqCheck2 := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	recCheck2 := httptest.NewRecorder()
	srv.handleAPIUpdateCheck(recCheck2, reqCheck2)
	var checkResp2 UpdateCheckResponse
	if err := json.NewDecoder(recCheck2.Body).Decode(&checkResp2); err != nil {
		t.Fatalf("decode check response 2: %v", err)
	}
	if checkResp2.UpdateAvailable {
		t.Errorf("expected UpdateAvailable = false when already at 0.0.8")
	}

	// And POST /api/update/apply returns status: up_to_date
	reqApply2 := httptest.NewRequest(http.MethodPost, "/api/update/apply", nil)
	recApply2 := httptest.NewRecorder()
	srv.handleAPIUpdateApply(recApply2, reqApply2)
	if recApply2.Code != http.StatusOK {
		t.Fatalf("POST /api/update/apply (up_to_date) status = %d", recApply2.Code)
	}
	var applyResp2 map[string]any
	_ = json.NewDecoder(recApply2.Body).Decode(&applyResp2)
	if applyResp2["status"] != "up_to_date" {
		t.Errorf("expected status = up_to_date, got %v", applyResp2["status"])
	}
}

func TestAPIUpdateApplyChecksumMismatch(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatarPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><g id="head"/></svg>`), 0644)

	assetName, archiveBytes, _ := buildMockArchiveForHost(t, []byte("tampered-binary"))
	wrongHash := "0000000000000000000000000000000000000000000000000000000000000000"

	var ghServer *httptest.Server
	ghServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/mrpoundsign/SVGTuber/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "v0.0.9",
				"name":     "SVGTuber v0.0.9",
				"assets": []map[string]any{
					{
						"name":                 assetName,
						"browser_download_url": ghServer.URL + "/download/" + assetName,
						"size":                 len(archiveBytes),
					},
					{
						"name":                 "checksums.txt",
						"browser_download_url": ghServer.URL + "/download/checksums.txt",
						"size":                 128,
					},
				},
			})
		case "/download/checksums.txt":
			_, _ = fmt.Fprintf(w, "%s  %s\n", wrongHash, assetName)
		case "/download/" + assetName:
			_, _ = w.Write(archiveBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ghServer.Close()

	srv := New(0, avatarPath, NewHub(), tracking.NewEngine())
	srv.SetVersion("0.0.7", "abc", "2026-10-31")
	chk := updater.NewChecker("mrpoundsign", "SVGTuber")
	chk.APIBaseURL = ghServer.URL
	srv.SetUpdateChecker(chk)

	reqApply := httptest.NewRequest(http.MethodPost, "/api/update/apply", nil)
	recApply := httptest.NewRecorder()
	srv.handleAPIUpdateApply(recApply, reqApply)
	if recApply.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502 on checksum mismatch, got %d: %s", recApply.Code, recApply.Body.String())
	}
}

func TestOpenDirectoryAndAvatarDir(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatarPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><g id="head"/></svg>`), 0644)

	srv := New(0, avatarPath, NewHub(), tracking.NewEngine())
	if srv.AvatarDir() != tempDir {
		t.Errorf("AvatarDir() = %q, want %q", srv.AvatarDir(), tempDir)
	}
	if srv.CurrentAvatar() != "avatar.svg" {
		t.Errorf("CurrentAvatar() = %q, want avatar.svg", srv.CurrentAvatar())
	}
	if err := OpenDirectory(tempDir); err != nil {
		t.Errorf("OpenDirectory(%q) failed: %v", tempDir, err)
	}
}
