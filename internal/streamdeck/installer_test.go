package streamdeck_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/server"
	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
)

func TestInstallPlugin(t *testing.T) {
	baseDir := t.TempDir()
	if streamdeck.IsPluginInstalled(baseDir) {
		t.Fatalf("expected IsPluginInstalled=false before installation")
	}

	installedDir, err := streamdeck.InstallPluginWithPort(baseDir, 7429)
	if err != nil {
		t.Fatalf("InstallPluginWithPort failed: %v", err)
	}
	wantDir := filepath.Join(baseDir, streamdeck.PluginDirName)
	if installedDir != wantDir {
		t.Fatalf("installedDir = %q, want %q", installedDir, wantDir)
	}
	if !streamdeck.IsPluginInstalled(baseDir) {
		t.Fatalf("expected IsPluginInstalled=true after installation")
	}

	requiredFiles := []string{
		"manifest.json",
		"config.json",
		filepath.Join("bin", "plugin.js"),
		filepath.Join("property-inspector", "index.html"),
		filepath.Join("property-inspector", "pi.js"),
		filepath.Join("imgs", "plugin.svg"),
		filepath.Join("imgs", "expression.svg"),
		filepath.Join("imgs", "accessory.svg"),
		filepath.Join("imgs", "avatar.svg"),
		filepath.Join("imgs", "mode.svg"),
		filepath.Join("imgs", "calibrate.svg"),
	}
	for _, rel := range requiredFiles {
		full := filepath.Join(installedDir, rel)
		info, statErr := os.Stat(full)
		if statErr != nil {
			t.Errorf("missing expected file %s: %v", rel, statErr)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("expected non-empty file %s", rel)
		}
	}

	cfgBytes, err := os.ReadFile(filepath.Join(installedDir, "config.json"))
	if err != nil {
		t.Fatalf("read config.json: %v", err)
	}
	if !strings.Contains(string(cfgBytes), "7429") {
		t.Errorf("expected config.json to contain configured port 7429, got: %s", string(cfgBytes))
	}
}

func findNodeBinary() string {
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".asdf", "installs", "nodejs", "22.11.0", "bin", "node"),
		filepath.Join(home, ".asdf", "installs", "nodejs", "25.9.0", "bin", "node"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

type sdHostFrame struct {
	Event   string         `json:"event"`
	UUID    string         `json:"uuid,omitempty"`
	Context string         `json:"context,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

func TestStreamDeckPluginEndToEndWithHostSimulator(t *testing.T) {
	nodeBin := findNodeBinary()
	if nodeBin == "" {
		t.Skip("node binary not found in PATH; skipping Stream Deck host simulator integration test")
	}

	baseDir := t.TempDir()
	installedDir, err := streamdeck.InstallPlugin(baseDir)
	if err != nil {
		t.Fatalf("InstallPlugin: %v", err)
	}
	pluginJS := filepath.Join(installedDir, "bin", "plugin.js")

	// Set up temporary SVGTuber workspace with an avatar that has a "happy" expression and a "glasses" accessory
	wsDir := t.TempDir()
	avatarPath := filepath.Join(wsDir, "avatar.svg")
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100">
		<g id="happy_layer" inkscape:label="State {when: happy}"><circle cx="50" cy="50" r="10"/></g>
	</svg>`
	if err := os.WriteFile(avatarPath, []byte(svgContent), 0o600); err != nil {
		t.Fatalf("write avatar.svg: %v", err)
	}

	cfgPath := filepath.Join(wsDir, "config.json")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	_ = cfgMgr.SetActiveAvatar("avatar.svg")
	_ = cfgMgr.SetAccessoryForAvatar("avatar.svg", config.AccessoryConfig{
		ID:      "glasses",
		File:    "glasses.svg",
		Name:    "Glasses",
		Enabled: false,
	})

	hub := server.NewHub()
	engine := tracking.NewEngine(cfgMgr)
	stServer := server.New(0, avatarPath, hub, engine, cfgMgr)
	if err := stServer.Start(); err != nil {
		t.Fatalf("stServer.Start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = stServer.Shutdown(ctx)
	}()

	// Start Mock Elgato Stream Deck Host WebSocket server
	sdFramesCh := make(chan sdHostFrame, 128)
	sdConnCh := make(chan *websocket.Conn, 1)

	sdHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if acceptErr != nil {
			return
		}
		defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
		select {
		case sdConnCh <- conn:
		default:
		}
		for {
			_, raw, readErr := conn.Read(r.Context())
			if readErr != nil {
				return
			}
			var f sdHostFrame
			if json.Unmarshal(raw, &f) == nil {
				sdFramesCh <- f
			}
		}
	}))
	defer sdHTTP.Close()

	sdParsed, err := url.Parse(sdHTTP.URL)
	if err != nil {
		t.Fatalf("Parse sdHTTP.URL: %v", err)
	}
	sdPortStr := sdParsed.Port()

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	_, stPortStr, err := net.SplitHostPort(stServer.Addr())
	if err != nil {
		t.Fatalf("SplitHostPort(stServer.Addr()): %v", err)
	}
	stWsURL := fmt.Sprintf("ws://127.0.0.1:%s/ws/tracker?client=streamdeck", stPortStr)
	cmd := exec.CommandContext(
		ctx,
		nodeBin,
		pluginJS,
		"-port", sdPortStr,
		"-pluginUUID", "plugin-uuid-svgtuber",
		"-registerEvent", "registerPlugin",
		"-svgtuberUrl", stWsURL,
	)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start plugin.js: %v", err)
	}
	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()

	var sdConn *websocket.Conn
	select {
	case sdConn = <-sdConnCh:
	case <-ctx.Done():
		t.Fatalf("timed out waiting for plugin.js to connect to mock Stream Deck host")
	}

	// Wait for registerPlugin event
	registered := false
	for !registered {
		select {
		case f := <-sdFramesCh:
			if f.Event == "registerPlugin" && f.UUID == "plugin-uuid-svgtuber" {
				registered = true
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for registerPlugin frame")
		}
	}

	sendSD := func(msg map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(msg)
		if err := sdConn.Write(ctx, websocket.MessageText, raw); err != nil {
			t.Fatalf("sdConn.Write: %v", err)
		}
	}

	// 1. Send willAppear for Expression, Accessory, and Mode buttons
	sendSD(map[string]any{
		"event":   "willAppear",
		"action":  "com.github.mrpoundsign.svgtuber.expression",
		"context": "ctx-expr",
		"payload": map[string]any{
			"settings": map[string]any{
				"operation":  "toggle",
				"expression": "happy",
			},
		},
	})
	sendSD(map[string]any{
		"event":   "willAppear",
		"action":  "com.github.mrpoundsign.svgtuber.accessory",
		"context": "ctx-acc",
		"payload": map[string]any{
			"settings": map[string]any{
				"accessoryId": "glasses",
			},
		},
	})
	sendSD(map[string]any{
		"event":   "willAppear",
		"action":  "com.github.mrpoundsign.svgtuber.mode",
		"context": "ctx-mode",
		"payload": map[string]any{
			"settings": map[string]any{
				"targetMode": "cycle",
			},
		},
	})

	// Wait for initial HYBRID mode image
	gotInitialMode := false
	for !gotInitialMode {
		select {
		case f := <-sdFramesCh:
			if f.Event == "setImage" && f.Context == "ctx-mode" {
				img, _ := f.Payload["image"].(string)
				decoded, _ := url.PathUnescape(img)
				if strings.Contains(decoded, "HYBRID") {
					gotInitialMode = true
				}
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for initial HYBRID setImage on ctx-mode")
		}
	}

	// 2. Press Expression button -> should toggle "happy" to ACTIVE
	sendSD(map[string]any{
		"event":   "keyDown",
		"action":  "com.github.mrpoundsign.svgtuber.expression",
		"context": "ctx-expr",
		"payload": map[string]any{
			"settings": map[string]any{
				"operation":  "toggle",
				"expression": "happy",
			},
		},
	})

	gotHappyActive := false
	for !gotHappyActive {
		select {
		case f := <-sdFramesCh:
			if f.Event == "setImage" && f.Context == "ctx-expr" {
				img, _ := f.Payload["image"].(string)
				decoded, _ := url.PathUnescape(img)
				if strings.Contains(decoded, "HAPPY") && strings.Contains(decoded, "ACTIVE") {
					gotHappyActive = true
				}
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for HAPPY ACTIVE image on ctx-expr")
		}
	}

	// 3. Press Accessory button -> should toggle "glasses" to EQUIPPED
	sendSD(map[string]any{
		"event":   "keyDown",
		"action":  "com.github.mrpoundsign.svgtuber.accessory",
		"context": "ctx-acc",
		"payload": map[string]any{
			"settings": map[string]any{
				"accessoryId": "glasses",
			},
		},
	})

	gotGlassesEquipped := false
	for !gotGlassesEquipped {
		select {
		case f := <-sdFramesCh:
			if f.Event == "setImage" && f.Context == "ctx-acc" {
				img, _ := f.Payload["image"].(string)
				decoded, _ := url.PathUnescape(img)
				if strings.Contains(decoded, "GLASSES") && strings.Contains(decoded, "EQUIPPED") {
					gotGlassesEquipped = true
				}
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for GLASSES EQUIPPED image on ctx-acc")
		}
	}

	// 4. Press Mode button -> should cycle from "hybrid" to "camera" ("CAMERA ONLY")
	sendSD(map[string]any{
		"event":   "keyDown",
		"action":  "com.github.mrpoundsign.svgtuber.mode",
		"context": "ctx-mode",
		"payload": map[string]any{
			"settings": map[string]any{
				"targetMode": "cycle",
			},
		},
	})

	gotCameraMode := false
	for !gotCameraMode {
		select {
		case f := <-sdFramesCh:
			if f.Event == "setImage" && f.Context == "ctx-mode" {
				img, _ := f.Payload["image"].(string)
				decoded, _ := url.PathUnescape(img)
				if strings.Contains(decoded, "CAMERA ONLY") {
					gotCameraMode = true
				}
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for CAMERA ONLY image on ctx-mode")
		}
	}

	if got := stServer.CurrentTrackingMode(); got != "camera" {
		t.Fatalf("CurrentTrackingMode() = %q, want %q", got, "camera")
	}
}
