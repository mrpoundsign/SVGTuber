package server

import (
	"bytes"
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

func TestServer_AccessoriesAPI(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	if err := os.WriteFile(avatarPath, []byte(`<svg></svg>`), 0644); err != nil {
		t.Fatalf("failed to write avatar: %v", err)
	}

	accDir := filepath.Join(tempDir, "accessories")
	if err := os.MkdirAll(accDir, 0755); err != nil {
		t.Fatalf("failed to create accessories dir: %v", err)
	}

	glassesSVG := `<svg id="sunglasses"><polygon points="0,0 10,10 0,10"/></svg>`
	if err := os.WriteFile(filepath.Join(accDir, "sunglasses.svg"), []byte(glassesSVG), 0644); err != nil {
		t.Fatalf("failed to write sample accessory: %v", err)
	}

	cfgMgr, err := config.NewManager(filepath.Join(tempDir, "config.json"))
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine(), cfgMgr)

	// 1. GET /api/accessories
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/accessories", nil)
	srv.handleAPIAccessories(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessories returned %d", rec.Code)
	}

	var accList struct {
		AvailableFiles  []string                 `json:"availableFiles"`
		FileExpressions map[string][]string      `json:"fileExpressions"`
		Accessories     []config.AccessoryConfig `json:"accessories"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &accList); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(accList.AvailableFiles) != 1 || accList.AvailableFiles[0] != "sunglasses.svg" {
		t.Errorf("expected availableFiles to have sunglasses.svg, got %+v", accList.AvailableFiles)
	}
	if accList.FileExpressions == nil {
		t.Errorf("expected non-nil FileExpressions map")
	}

	// 2. Static GET /accessories/sunglasses.svg
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/accessories/sunglasses.svg", nil)
	srv.handleAccessoryFile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleAccessoryFile returned %d", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "image/svg+xml") {
		t.Errorf("expected svg content-type, got %s", rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != glassesSVG {
		t.Errorf("content mismatch: got %s, want %s", rec.Body.String(), glassesSVG)
	}

	// 3. POST /api/accessories/update (add / update accessory)
	newAcc := config.AccessoryConfig{
		ID:       "cool_shades",
		File:     "sunglasses.svg",
		Name:     "Cool Shades",
		Target:   "layer_head",
		X:        12.5,
		Y:        -30.0,
		ScaleX:   1.2,
		ScaleY:   1.2,
		Rotation: 5.0,
		Order:    "front",
		Enabled:  true,
	}
	payload, _ := json.Marshal(newAcc)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/update", bytes.NewReader(payload))
	srv.handleAPIAccessoryUpdate(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryUpdate returned %d", rec.Code)
	}

	// Verify it saved in config
	cfgAccs := srv.configMgr.GetAccessories()
	if len(cfgAccs) != 1 || cfgAccs[0].ID != "cool_shades" || cfgAccs[0].X != 12.5 {
		t.Fatalf("accessory not properly updated in config: %+v", cfgAccs)
	}

	// 4. POST /api/accessories/toggle
	togglePayload, _ := json.Marshal(map[string]string{"id": "cool_shades"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/toggle", bytes.NewReader(togglePayload))
	srv.handleAPIAccessoryToggle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryToggle returned %d", rec.Code)
	}
	cfgAccs = srv.configMgr.GetAccessories()
	if cfgAccs[0].Enabled {
		t.Errorf("expected accessory to be toggled to false, got true")
	}

	// 5. POST /api/accessories/remove
	removePayload, _ := json.Marshal(map[string]string{"id": "cool_shades"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/remove", bytes.NewReader(removePayload))
	srv.handleAPIAccessoryRemove(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryRemove returned %d", rec.Code)
	}
	cfgAccs = srv.configMgr.GetAccessories()
	if len(cfgAccs) != 0 {
		t.Errorf("expected accessories to be empty after remove, got %+v", cfgAccs)
	}

	// 6. Test with ?avatar= query parameter and Expression triggers
	avatarA := "avatarA.svg"
	avatarB := "avatarB.svg"

	accExpr := config.AccessoryConfig{
		ID:         "blushing_shades",
		File:       "sunglasses.svg",
		Name:       "Blushing Shades",
		Target:     "Head",
		Expression: "blush",
		Enabled:    true,
	}
	payloadExpr, _ := json.Marshal(accExpr)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/update?avatar="+avatarA, bytes.NewReader(payloadExpr))
	srv.handleAPIAccessoryUpdate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryUpdate with avatar query returned %d", rec.Code)
	}

	// Verify GET /api/accessories?avatar=avatarA returns blushing_shades
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/accessories?avatar="+avatarA, nil)
	srv.handleAPIAccessories(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessories for avatarA returned %d", rec.Code)
	}
	var resA struct {
		Accessories []config.AccessoryConfig `json:"accessories"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resA)
	if len(resA.Accessories) != 1 || resA.Accessories[0].Expression != "blush" {
		t.Errorf("expected blush accessory on avatarA, got: %+v", resA.Accessories)
	}

	// Verify GET /api/accessories?avatar=avatarB returns empty list
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/accessories?avatar="+avatarB, nil)
	srv.handleAPIAccessories(rec, req)
	var resB struct {
		Accessories []config.AccessoryConfig `json:"accessories"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resB)
	if len(resB.Accessories) != 0 {
		t.Errorf("expected 0 accessories on avatarB, got: %+v", resB.Accessories)
	}
}

func TestServer_UnequippedAccessoryExpressionNotAvailable(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	avatarSVG := `<svg id="avatar"><g id="layer_blush" inkscape:label="[Show {when: isBlush}]"></g></svg>`
	if err := os.WriteFile(avatarPath, []byte(avatarSVG), 0644); err != nil {
		t.Fatalf("failed to write avatar: %v", err)
	}

	accDir := filepath.Join(tempDir, "accessories")
	if err := os.MkdirAll(accDir, 0755); err != nil {
		t.Fatalf("failed to create accessories dir: %v", err)
	}

	// Place sweat_drop.svg in accessories folder with isSweat directive
	sweatSVG := `<svg id="sweat_drop"><g id="sweat" inkscape:label="[Show {when: isSweat}]"></g></svg>`
	if err := os.WriteFile(filepath.Join(accDir, "sweat_drop.svg"), []byte(sweatSVG), 0644); err != nil {
		t.Fatalf("failed to write sweat accessory: %v", err)
	}

	cfgMgr, err := config.NewManager(filepath.Join(tempDir, "config.json"))
	if err != nil {
		t.Fatalf("failed to create config manager: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine(), cfgMgr)
	if _, err := srv.ReloadRig(); err != nil {
		t.Fatalf("failed to reload rig: %v", err)
	}

	// 1. Initially, sweat accessory is in the directory but NOT equipped/configured.
	// Only "blush" should be available; "sweat" must NOT be available.
	avail := srv.expMgr.GetAvailable()
	hasSweat := false
	hasBlush := false
	for _, e := range avail {
		if e == "sweat" {
			hasSweat = true
		}
		if e == "blush" {
			hasBlush = true
		}
	}
	if !hasBlush {
		t.Errorf("expected 'blush' to be available on avatar rig, got: %v", avail)
	}
	if hasSweat {
		t.Errorf("unequipped accessory expression 'sweat' should NOT be available, got: %v", avail)
	}

	// Verify via GET /api/expressions
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/expressions", nil)
	srv.handleAPIExpressions(rec, req)
	var expResp struct {
		Available []string `json:"available"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &expResp)
	for _, e := range expResp.Available {
		if e == "sweat" {
			t.Errorf("GET /api/expressions returned unequipped expression 'sweat'")
		}
	}

	// 2. Equip the accessory with Enabled: true
	acc := config.AccessoryConfig{
		ID:      "sweat_acc",
		File:    "sweat_drop.svg",
		Name:    "Sweat Drops",
		Target:  "layer_blush",
		Enabled: true,
	}
	payload, _ := json.Marshal(acc)
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/update", bytes.NewReader(payload))
	srv.handleAPIAccessoryUpdate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryUpdate failed: %d", rec.Code)
	}

	// Now "sweat" should be available
	avail = srv.expMgr.GetAvailable()
	hasSweat = false
	for _, e := range avail {
		if e == "sweat" {
			hasSweat = true
		}
	}
	if !hasSweat {
		t.Errorf("expected 'sweat' to become available after equipping accessory, got: %v", avail)
	}

	// 3. Toggle accessory to disabled (Enabled: false)
	togglePayload, _ := json.Marshal(map[string]string{"id": "sweat_acc"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/accessories/toggle", bytes.NewReader(togglePayload))
	srv.handleAPIAccessoryToggle(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handleAPIAccessoryToggle failed: %d", rec.Code)
	}

	// "sweat" should NO LONGER be available
	avail = srv.expMgr.GetAvailable()
	hasSweat = false
	for _, e := range avail {
		if e == "sweat" {
			hasSweat = true
		}
	}
	if hasSweat {
		t.Errorf("expected 'sweat' to be removed from available after disabling accessory, got: %v", avail)
	}
}


