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
