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
)

func TestServer_AvatarSVG(t *testing.T) {
	tempDir := t.TempDir()
	avatarPath := filepath.Join(tempDir, "avatar.svg")
	svgContent := `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="purple"/></svg>`

	if err := os.WriteFile(avatarPath, []byte(svgContent), 0644); err != nil {
		t.Fatalf("Failed to create test avatar file: %v", err)
	}

	hub := NewHub()
	srv := New(0, avatarPath, hub)

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
	srv := New(0, avatarPath, hub)

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
