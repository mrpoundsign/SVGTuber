package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

func TestAPIStreamDeckStatusAndInstall(t *testing.T) {
	wsDir := t.TempDir()
	avatarPath := filepath.Join(wsDir, "avatar.svg")
	if err := os.WriteFile(avatarPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`), 0o600); err != nil {
		t.Fatalf("write avatar: %v", err)
	}

	sdPluginsDir := t.TempDir()
	srv := New(0, avatarPath, NewHub(), tracking.NewEngine())
	srv.SetStreamDeckPluginsDir(sdPluginsDir)

	// 1. Check status before installation
	reqStatus := httptest.NewRequest(http.MethodGet, "/api/streamdeck/status", nil)
	recStatus := httptest.NewRecorder()
	srv.handleAPIStreamDeckStatus(recStatus, reqStatus)

	if recStatus.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recStatus.Code)
	}

	var statusBefore struct {
		Installed     bool   `json:"installed"`
		PluginsDir    string `json:"pluginsDir"`
		PluginDirName string `json:"pluginDirName"`
	}
	if err := json.NewDecoder(recStatus.Body).Decode(&statusBefore); err != nil {
		t.Fatalf("decode statusBefore: %v", err)
	}
	if statusBefore.Installed {
		t.Fatalf("expected Installed=false before POST /api/streamdeck/install")
	}

	// 2. Install Stream Deck plugin via POST /api/streamdeck/install
	reqInstall := httptest.NewRequest(http.MethodPost, "/api/streamdeck/install", nil)
	recInstall := httptest.NewRecorder()
	srv.handleAPIStreamDeckInstall(recInstall, reqInstall)

	if recInstall.Code != http.StatusOK {
		t.Fatalf("install status = %d, want 200", recInstall.Code)
	}

	var instPayload struct {
		Status        string `json:"status"`
		Installed     bool   `json:"installed"`
		InstalledPath string `json:"installedPath"`
	}
	if err := json.NewDecoder(recInstall.Body).Decode(&instPayload); err != nil {
		t.Fatalf("decode instPayload: %v", err)
	}
	if !instPayload.Installed || instPayload.Status != "installed" {
		t.Fatalf("unexpected install payload: %+v", instPayload)
	}
	if !streamdeck.IsPluginInstalled(sdPluginsDir) {
		t.Fatalf("expected streamdeck.IsPluginInstalled(%q) == true", sdPluginsDir)
	}

	// 3. Re-check status after installation
	reqStatus2 := httptest.NewRequest(http.MethodGet, "/api/streamdeck/status", nil)
	recStatus2 := httptest.NewRecorder()
	srv.handleAPIStreamDeckStatus(recStatus2, reqStatus2)

	if recStatus2.Code != http.StatusOK {
		t.Fatalf("status after install = %d, want 200", recStatus2.Code)
	}
	var statusAfter struct {
		Installed bool `json:"installed"`
	}
	if err := json.NewDecoder(recStatus2.Body).Decode(&statusAfter); err != nil {
		t.Fatalf("decode statusAfter: %v", err)
	}
	if !statusAfter.Installed {
		t.Fatalf("expected Installed=true after POST /api/streamdeck/install")
	}
}

func TestAPIModeAndCycleAvatar(t *testing.T) {
	wsDir := t.TempDir()
	aPath := filepath.Join(wsDir, "alpha.svg")
	bPath := filepath.Join(wsDir, "beta.svg")
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`
	if err := os.WriteFile(aPath, []byte(svgContent), 0o600); err != nil {
		t.Fatalf("write alpha.svg: %v", err)
	}
	if err := os.WriteFile(bPath, []byte(svgContent), 0o600); err != nil {
		t.Fatalf("write beta.svg: %v", err)
	}

	cfgMgr, err := config.NewManager(filepath.Join(wsDir, "config.json"))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	_ = cfgMgr.SetActiveAvatar("alpha.svg")

	srv := New(0, aPath, NewHub(), tracking.NewEngine(cfgMgr), cfgMgr)

	// Cycle avatar: alpha.svg -> beta.svg -> alpha.svg
	nextAvatar, err := srv.CycleAvatar()
	if err != nil {
		t.Fatalf("CycleAvatar 1: %v", err)
	}
	if nextAvatar != "beta.svg" {
		t.Fatalf("CycleAvatar 1 = %q, want beta.svg", nextAvatar)
	}

	nextAvatar2, err := srv.CycleAvatar()
	if err != nil {
		t.Fatalf("CycleAvatar 2: %v", err)
	}
	if nextAvatar2 != "alpha.svg" {
		t.Fatalf("CycleAvatar 2 = %q, want alpha.svg", nextAvatar2)
	}

	// Test POST /api/mode cycle: hybrid -> camera -> audio -> hybrid
	reqMode := httptest.NewRequest(http.MethodPost, "/api/mode", strings.NewReader(`{"mode":"cycle"}`))
	recMode := httptest.NewRecorder()
	srv.handleAPIMode(recMode, reqMode)

	if recMode.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recMode.Code)
	}
	var modeResp struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(recMode.Body).Decode(&modeResp); err != nil {
		t.Fatalf("decode modeResp: %v", err)
	}
	if modeResp.Mode != "camera" {
		t.Fatalf("mode = %q, want camera", modeResp.Mode)
	}
}
