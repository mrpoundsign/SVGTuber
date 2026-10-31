package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/mrpoundsign/appinstaller/pkg/updater"
)

// AvatarDir returns the currently active avatar directory path.
func (s *Server) AvatarDir() string {
	s.rigMu.RLock()
	defer s.rigMu.RUnlock()
	return s.avatarDir
}

// AvatarPath returns the full path to the currently active avatar SVG file.
func (s *Server) AvatarPath() string {
	s.rigMu.RLock()
	defer s.rigMu.RUnlock()
	return s.avatarPath
}

// CurrentAvatar returns the relative name of the currently active avatar SVG file.
func (s *Server) CurrentAvatar() string {
	s.rigMu.RLock()
	defer s.rigMu.RUnlock()
	return s.currentAvatar
}

// SetOpenDirFunc overrides the directory-opening implementation (used in unit tests).
func (s *Server) SetOpenDirFunc(fn func(dir string) error) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.openDirFn = fn
}

// OpenDirectory opens the specified folder in the host operating system's file manager.
func OpenDirectory(dir string) error {
	cleanDir := strings.TrimSpace(dir)
	if cleanDir == "" {
		return errors.New("directory path cannot be empty")
	}
	absDir, err := filepath.Abs(cleanDir)
	if err == nil {
		cleanDir = absDir
	}
	info, err := os.Stat(cleanDir)
	if err != nil {
		return fmt.Errorf("directory not found: %w", err)
	}
	if !info.IsDir() {
		cleanDir = filepath.Dir(cleanDir)
	}
	if testing.Testing() {
		return nil
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", cleanDir)
	case "darwin":
		cmd = exec.Command("open", cleanDir)
	default:
		if _, err := exec.LookPath("wslview"); err == nil {
			cmd = exec.Command("wslview", cleanDir)
		} else {
			cmd = exec.Command("xdg-open", cleanDir)
		}
	}
	return cmd.Start()
}

func (s *Server) handleAPIAvatarOpenDir(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	s.rigMu.RLock()
	dir := s.avatarDir
	openFn := s.openDirFn
	s.rigMu.RUnlock()

	if openFn == nil {
		openFn = OpenDirectory
	}
	if err := openFn(dir); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":     fmt.Sprintf("failed to open avatar directory: %v", err),
			"avatarDir": dir,
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    "opened",
		"avatarDir": dir,
	})
}

// UpdateCheckResponse represents the JSON payload returned by GET /api/update/check.
type UpdateCheckResponse struct {
	CurrentVersion  string              `json:"currentVersion"`
	LatestVersion   string              `json:"latestVersion"`
	TagName         string              `json:"tagName"`
	UpdateAvailable bool                `json:"updateAvailable"`
	ReleaseName     string              `json:"releaseName"`
	ReleaseNotes    string              `json:"releaseNotes"`
	HTMLURL         string              `json:"htmlUrl"`
	InstallMode     updater.InstallMode `json:"installMode"`
	AssetName       string              `json:"assetName,omitempty"`
	AssetSize       int64               `json:"assetSize,omitempty"`
	DownloadURL     string              `json:"downloadUrl,omitempty"`
}

// SetUpdateChecker configures a custom updater.Checker instance (used in unit tests).
func (s *Server) SetUpdateChecker(c *updater.Checker) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	if c != nil {
		s.updateChecker = c
	}
}

// SetUpdateTargetExe overrides the target executable path for self-update detection and replacement.
func (s *Server) SetUpdateTargetExe(exePath string) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.updateTargetExe = exePath
}

// SetUpdateApplyFunc overrides the final apply-and-restart action (used in unit tests to avoid spawning processes).
func (s *Server) SetUpdateApplyFunc(fn func(verifiedAssetPath, targetExePath string, mode updater.InstallMode) error) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.updateApplyFn = fn
}

func (s *Server) currentSemver() string {
	s.rigMu.RLock()
	ver := strings.TrimSpace(s.version)
	s.rigMu.RUnlock()
	if ver == "" || ver == "dev" {
		return "0.0.7"
	}
	return updater.NormalizeVersion(ver)
}

func (s *Server) getUpdaterConfig() (*updater.Checker, string, func(string, string, updater.InstallMode) error) {
	s.rigMu.RLock()
	defer s.rigMu.RUnlock()
	chk := s.updateChecker
	if chk == nil {
		chk = updater.NewChecker("mrpoundsign", "SVGTuber")
	}
	exe := updater.ResolveTargetExecutable(s.updateTargetExe)
	return chk, exe, s.updateApplyFn
}

func (s *Server) handleAPIUpdateCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	chk, exePath, _ := s.getUpdaterConfig()
	curVer := s.currentSemver()
	mode := updater.DetectInstallMode(exePath)

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	rel, isNewer, err := chk.CheckLatest(ctx, curVer)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":          fmt.Sprintf("failed to check latest release: %v", err),
			"currentVersion": curVer,
			"installMode":    mode,
		})
		return
	}

	resp := UpdateCheckResponse{
		CurrentVersion:  curVer,
		LatestVersion:   rel.Version,
		TagName:         rel.TagName,
		UpdateAvailable: isNewer,
		ReleaseName:     rel.Name,
		ReleaseNotes:    rel.Body,
		HTMLURL:         rel.HTMLURL,
		InstallMode:     mode,
	}

	if asset, err := updater.SelectAsset(rel, mode, runtime.GOOS, runtime.GOARCH); err == nil && asset != nil {
		resp.AssetName = asset.Name
		resp.AssetSize = asset.Size
		resp.DownloadURL = asset.BrowserDownloadURL
	}

	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleAPIUpdateApply(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	chk, exePath, customApply := s.getUpdaterConfig()
	curVer := s.currentSemver()
	mode := updater.DetectInstallMode(exePath)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	rel, isNewer, err := chk.CheckLatest(ctx, curVer)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": fmt.Sprintf("failed to fetch release metadata: %v", err),
		})
		return
	}

	if !isNewer {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":          "up_to_date",
			"currentVersion":  curVer,
			"latestVersion":   rel.Version,
			"updateAvailable": false,
		})
		return
	}

	asset, err := updater.SelectAsset(rel, mode, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": fmt.Sprintf("no compatible release asset for %s/%s (%s): %v", runtime.GOOS, runtime.GOARCH, mode, err),
		})
		return
	}

	destDir := filepath.Join(os.TempDir(), "svgtuber-update")
	s.broadcastTracker(map[string]any{
		"type":       "update_progress",
		"stage":      "downloading",
		"downloaded": int64(0),
		"total":      asset.Size,
		"asset":      asset.Name,
		"version":    rel.Version,
	})

	verifiedPath, err := chk.DownloadAndVerify(ctx, rel, asset, destDir, func(downloaded, total int64) {
		s.broadcastTracker(map[string]any{
			"type":       "update_progress",
			"stage":      "downloading",
			"downloaded": downloaded,
			"total":      total,
			"asset":      asset.Name,
			"version":    rel.Version,
		})
	})
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": fmt.Sprintf("download and SHA-256 verification failed: %v", err),
		})
		return
	}

	s.broadcastTracker(map[string]any{
		"type":    "update_progress",
		"stage":   "applying",
		"asset":   asset.Name,
		"version": rel.Version,
	})

	if customApply != nil {
		if err := customApply(verifiedPath, exePath, mode); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": fmt.Sprintf("failed to apply update: %v", err),
			})
			return
		}
	} else {
		onQuit := func() {
			go func() {
				time.Sleep(250 * time.Millisecond)
				shutCtx, shutCancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer shutCancel()
				_ = s.Shutdown(shutCtx)
				os.Exit(0)
			}()
		}
		if err := updater.ApplyAndRestart(verifiedPath, exePath, mode, onQuit); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": fmt.Sprintf("failed to apply update and restart: %v", err),
			})
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "updating",
		"version":     rel.Version,
		"asset":       asset.Name,
		"installMode": mode,
	})
}
