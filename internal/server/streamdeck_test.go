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
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

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
