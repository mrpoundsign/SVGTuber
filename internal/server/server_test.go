package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/rig"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

func TestServer_AvatarSVG(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	svgContent := `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="purple"/></svg>`

	if err := os.WriteFile(avatarPath, []byte(svgContent), 0644); err != nil {
		t.Fatalf("Failed to create test avatar file: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine())

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/avatar.svg", nil)
	srv.handleAvatarSVG(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", rec.Code)
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "image/svg+xml") {
		t.Errorf("Expected Content-Type image/svg+xml, got %s", contentType)
	}

	if rec.Body.String() != svgContent {
		t.Errorf("Body mismatch. Got %s, expected %s", rec.Body.String(), svgContent)
	}
}

func TestServer_RigJSON(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
		<g id="head" inkscape:label="Head [Follow {yaw: 15; pitch: 10}]"></g>
	</svg>`

	if err := os.WriteFile(avatarPath, []byte(svgContent), 0644); err != nil {
		t.Fatalf("Failed to create test avatar file: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine())
	if _, err := srv.ReloadRig(); err != nil {
		t.Fatalf("ReloadRig failed: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/rig.json", nil)
	srv.handleRigJSON(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", rec.Code)
	}

	var rigDef rig.RigDefinition
	if err := json.Unmarshal(rec.Body.Bytes(), &rigDef); err != nil {
		t.Fatalf("Failed to unmarshal rig.json: %v", err)
	}

	if len(rigDef.Elements) != 1 || rigDef.Elements[0].ID != "head" {
		t.Errorf("Unexpected rig elements: %+v", rigDef.Elements)
	}
}

func TestServer_WebSocketReload(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatarPath, []byte("<svg></svg>"), 0644)

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine())

	httpServer := httptest.NewServer(http.HandlerFunc(srv.handleOverlayWS))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial WebSocket: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	// Give server a moment to register connection in hub
	time.Sleep(50 * time.Millisecond)

	// Broadcast reload message
	hub.BroadcastReload()

	// Read message from WebSocket
	readCtx, readCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer readCancel()

	typ, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("Failed to read from WebSocket: %v", err)
	}

	if typ != websocket.MessageText {
		t.Fatalf("Expected text message, got %v", typ)
	}

	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("Failed to parse JSON message: %v", err)
	}

	if msg.Type != "reload" {
		t.Errorf("Expected message type 'reload', got %q", msg.Type)
	}
}

func TestServer_TrackerStream(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatarPath, []byte("<svg></svg>"), 0644)

	hub := NewHub()
	engine := tracking.NewEngine()
	srv := New(0, avatarPath, hub, engine)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/overlay", srv.handleOverlayWS)
	mux.HandleFunc("/ws/tracker", srv.handleTrackerWS)
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Connect overlay client
	overlayURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/overlay"
	overlayConn, _, err := websocket.Dial(ctx, overlayURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial overlay WS: %v", err)
	}
	defer func() { _ = overlayConn.Close(websocket.StatusNormalClosure, "") }()

	// Connect tracker client
	trackerURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/tracker"
	trackerConn, _, err := websocket.Dial(ctx, trackerURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial tracker WS: %v", err)
	}
	defer func() { _ = trackerConn.Close(websocket.StatusNormalClosure, "") }()

	time.Sleep(50 * time.Millisecond)

	// Send FaceFrame from tracker
	face := tracking.FaceFrame{
		Timestamp: 1000,
		Present:   true,
		Yaw:       12.5,
		Blendshapes: map[string]float64{
			"jawOpen": 0.5,
		},
	}
	faceBytes, _ := json.Marshal(face)
	if err := trackerConn.Write(ctx, websocket.MessageText, faceBytes); err != nil {
		t.Fatalf("Failed to write to tracker WS: %v", err)
	}

	// Read ParamFrame from overlay
	readCtx, readCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer readCancel()

	_, data, err := overlayConn.Read(readCtx)
	if err != nil {
		t.Fatalf("Failed to read from overlay WS: %v", err)
	}

	var params tracking.ParamFrame
	if err := json.Unmarshal(data, &params); err != nil {
		t.Fatalf("Failed to parse ParamFrame: %v", err)
	}

	if params.Type != "param_frame" {
		t.Errorf("Expected Type 'param_frame', got %q", params.Type)
	}
	if !params.Present {
		t.Errorf("Expected Present=true")
	}
	if params.MouthOpen == 0 {
		t.Errorf("Expected MouthOpen > 0 from blendshapes")
	}
}

func TestServer_APISettings(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatarPath, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0644)

	cfgPath := filepath.Join(tempDir, "com.github", "mrpoundsign.svgtuber", "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Failed to initialize config manager: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine(cfgMgr), cfgMgr)

	// GET /api/settings
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	srv.handleAPISettings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on GET, got %d", rec.Code)
	}

	var resp struct {
		Settings   config.Settings `json:"settings"`
		ConfigPath string          `json:"configPath"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp.Settings.Tracking.MouthGain != 1.4 {
		t.Errorf("Expected MouthGain 1.4, got %f", resp.Settings.Tracking.MouthGain)
	}

	// POST /api/settings
	updatePayload := `{"version":1,"tracking":{"mouthGain":2.5,"mouthThreshold":0.12,"blinkThreshold":0.5,"eyeGazeGain":1.2,"yawMultiplier":1.0,"pitchMultiplier":1.0,"rollMultiplier":1.0,"poseSmoothing":1.0}}`
	recPost := httptest.NewRecorder()
	reqPost := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(updatePayload))
	srv.handleAPISettings(recPost, reqPost)

	if recPost.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on POST, got %d: %s", recPost.Code, recPost.Body.String())
	}

	if cfgMgr.Get().Tracking.MouthGain != 2.5 {
		t.Errorf("Expected updated MouthGain 2.5, got %f", cfgMgr.Get().Tracking.MouthGain)
	}
}

func TestServer_APIExpressions(t *testing.T) {
	hub := NewHub()
	srv := New(0, "testdata/test_avatar.svg", hub, nil)
	srv.expMgr.SetAvailable([]string{"blush", "tears", "angry"})

	// 1. GET /api/expressions
	recGet := httptest.NewRecorder()
	reqGet := httptest.NewRequest(http.MethodGet, "/api/expressions", nil)
	srv.handleAPIExpressions(recGet, reqGet)

	if recGet.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on GET, got %d", recGet.Code)
	}

	var getResp struct {
		Active    map[string]bool `json:"active"`
		Available []string        `json:"available"`
	}
	if err := json.Unmarshal(recGet.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("Failed to decode GET response: %v", err)
	}
	if len(getResp.Available) != 3 {
		t.Errorf("Expected 3 available expressions, got %d", len(getResp.Available))
	}

	// 2. POST /api/expressions/toggle?name=blush
	recToggle := httptest.NewRecorder()
	reqToggle := httptest.NewRequest(http.MethodPost, "/api/expressions/toggle?name=blush", nil)
	srv.handleAPIExpressionToggle(recToggle, reqToggle)

	if recToggle.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on toggle, got %d", recToggle.Code)
	}
	if !srv.expMgr.GetActive()["blush"] {
		t.Errorf("Expected blush to be active after toggle")
	}

	// 3. POST /api/expressions/set (JSON body)
	recSet := httptest.NewRecorder()
	reqSet := httptest.NewRequest(http.MethodPost, "/api/expressions/set", strings.NewReader(`{"name":"angry","active":true}`))
	srv.handleAPIExpressionSet(recSet, reqSet)

	if recSet.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on set, got %d", recSet.Code)
	}
	if !srv.expMgr.GetActive()["angry"] {
		t.Errorf("Expected angry to be active after set")
	}

	// 4. POST /api/expressions/reset
	recReset := httptest.NewRecorder()
	reqReset := httptest.NewRequest(http.MethodPost, "/api/expressions/reset", nil)
	srv.handleAPIExpressionReset(recReset, reqReset)

	if recReset.Code != http.StatusOK {
		t.Fatalf("Expected status 200 on reset, got %d", recReset.Code)
	}
	if len(srv.expMgr.GetActive()) != 0 {
		t.Errorf("Expected 0 active expressions after reset, got %v", srv.expMgr.GetActive())
	}
}

type mockRigParser struct {
	customDef *rig.RigDefinition
}

func (m *mockRigParser) Parse(svgData []byte) (*rig.RigDefinition, error) {
	return m.customDef, nil
}

func TestServer_SetRigParserDI(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	if err := os.WriteFile(avatarPath, []byte(`<svg></svg>`), 0644); err != nil {
		t.Fatalf("Failed to create dummy avatar: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub, tracking.NewEngine())

	mockDef := &rig.RigDefinition{
		Version: "2.0-mock",
		Elements: []rig.RigElement{
			{ID: "injected_elem", Label: "Injected [Idle]"},
		},
	}
	srv.SetRigParser(&mockRigParser{customDef: mockDef})

	rigDef, err := srv.ReloadRig()
	if err != nil {
		t.Fatalf("ReloadRig failed: %v", err)
	}

	if rigDef.Version != "2.0-mock" {
		t.Errorf("Expected mock version 2.0-mock, got %s", rigDef.Version)
	}
	if len(rigDef.Elements) != 1 || rigDef.Elements[0].ID != "injected_elem" {
		t.Errorf("Expected injected element, got %+v", rigDef.Elements)
	}
}

func TestServer_AvatarManagement(t *testing.T) {
	tempDir := t.TempDir()
	avatar1Path := filepath.Join(tempDir, "avatar.svg")
	_ = os.WriteFile(avatar1Path, []byte(`<svg id="root"><g id="h1" inkscape:label="Head [Follow]"></g></svg>`), 0644)

	subDir := filepath.Join(tempDir, "alts")
	_ = os.MkdirAll(subDir, 0755)
	avatar2Path := filepath.Join(subDir, "casual.svg")
	_ = os.WriteFile(avatar2Path, []byte(`<svg id="root"><g id="h2" inkscape:label="Head [Follow]"></g></svg>`), 0644)

	cfgPath := filepath.Join(tempDir, "settings.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatar1Path, hub, tracking.NewEngine(), cfgMgr)

	// 1. GET /api/avatars
	recList := httptest.NewRecorder()
	reqList := httptest.NewRequest(http.MethodGet, "/api/avatars", nil)
	srv.handleAPIAvatars(recList, reqList)

	if recList.Code != http.StatusOK {
		t.Fatalf("Expected 200 on /api/avatars, got %d", recList.Code)
	}

	var listResp struct {
		AvatarDir     string   `json:"avatarDir"`
		CurrentAvatar string   `json:"currentAvatar"`
		Avatars       []string `json:"avatars"`
	}
	if err := json.Unmarshal(recList.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("Failed to parse /api/avatars response: %v", err)
	}

	if len(listResp.Avatars) != 2 {
		t.Fatalf("Expected 2 avatars in list, got %v", listResp.Avatars)
	}
	if listResp.Avatars[0] != "alts/casual.svg" || listResp.Avatars[1] != "avatar.svg" {
		t.Errorf("Unexpected avatar list: %v", listResp.Avatars)
	}

	// 2. POST /api/avatars/select - Path Traversal Security Check
	recBad := httptest.NewRecorder()
	reqBad := httptest.NewRequest(http.MethodPost, "/api/avatars/select?avatar=../outside.svg", nil)
	srv.handleAPIAvatarSelect(recBad, reqBad)
	if recBad.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 on path traversal attempt, got %d", recBad.Code)
	}

	// 3. POST /api/avatars/select - Valid switch to subdirectory avatar
	recSelect := httptest.NewRecorder()
	reqSelect := httptest.NewRequest(http.MethodPost, "/api/avatars/select", strings.NewReader(`{"avatar":"alts/casual.svg"}`))
	srv.handleAPIAvatarSelect(recSelect, reqSelect)

	if recSelect.Code != http.StatusOK {
		t.Fatalf("Expected 200 on avatar select, got %d (body: %s)", recSelect.Code, recSelect.Body.String())
	}

	srv.rigMu.RLock()
	current := srv.currentAvatar
	srv.rigMu.RUnlock()
	if current != "alts/casual.svg" {
		t.Errorf("Expected current avatar 'alts/casual.svg', got %q", current)
	}

	if cfgMgr.GetCurrentAvatar() != "alts/casual.svg" {
		t.Errorf("Expected config CurrentAvatar 'alts/casual.svg', got %q", cfgMgr.GetCurrentAvatar())
	}

	// 4. Verify /avatar.svg now serves avatar2 content
	recSVG := httptest.NewRecorder()
	reqSVG := httptest.NewRequest(http.MethodGet, "/avatar.svg", nil)
	srv.handleAvatarSVG(recSVG, reqSVG)
	if !strings.Contains(recSVG.Body.String(), `id="h2"`) {
		t.Errorf("Expected /avatar.svg to serve casual.svg content, got %s", recSVG.Body.String())
	}
}


