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
	defer conn.Close(websocket.StatusNormalClosure, "")

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
	defer overlayConn.Close(websocket.StatusNormalClosure, "")

	// Connect tracker client
	trackerURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws/tracker"
	trackerConn, _, err := websocket.Dial(ctx, trackerURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial tracker WS: %v", err)
	}
	defer trackerConn.Close(websocket.StatusNormalClosure, "")

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
