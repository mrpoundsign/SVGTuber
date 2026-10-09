package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/rig"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
	"github.com/mrpoundsign/SVGTuber/web"
)

// Server coordinates the HTTP file server and WebSocket endpoints.
type Server struct {
	port       int
	avatarPath string
	hub        *Hub
	engine     *tracking.Engine
	configMgr  *config.Manager
	rigMu      sync.RWMutex
	rigDef     *rig.RigDefinition
	httpServer *http.Server
	listener   net.Listener
}

// New constructs an unstarted Server instance.
func New(port int, avatarPath string, hub *Hub, engine *tracking.Engine, cfg ...*config.Manager) *Server {
	var cm *config.Manager
	if len(cfg) > 0 {
		cm = cfg[0]
	}
	return &Server{
		port:       port,
		avatarPath: avatarPath,
		hub:        hub,
		engine:     engine,
		configMgr:  cm,
	}
}

// Start binds the port and starts listening for HTTP and WebSocket requests.
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Root redirects to /studio/
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/studio/", http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})

	// Sub-filesystems for embedded web assets
	overlayFS, err := fs.Sub(web.StaticFS, "overlay")
	if err != nil {
		return fmt.Errorf("loading overlay static assets: %w", err)
	}
	studioFS, err := fs.Sub(web.StaticFS, "studio")
	if err != nil {
		return fmt.Errorf("loading studio static assets: %w", err)
	}

	mux.Handle("/overlay/", http.StripPrefix("/overlay/", http.FileServer(http.FS(overlayFS))))
	mux.Handle("/studio/", http.StripPrefix("/studio/", http.FileServer(http.FS(studioFS))))

	// Direct endpoint for OBS browser source: /overlay (without trailing slash)
	mux.HandleFunc("/overlay", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/overlay/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/studio", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/studio/", http.StatusMovedPermanently)
	})

	// Avatar SVG and Rig endpoints
	mux.HandleFunc("/avatar.svg", s.handleAvatarSVG)
	mux.HandleFunc("/rig.json", s.handleRigJSON)

	// Overlay and Tracker WebSocket endpoints
	mux.HandleFunc("/ws/overlay", s.handleOverlayWS)
	mux.HandleFunc("/ws/tracker", s.handleTrackerWS)

	// REST API control endpoints
	mux.HandleFunc("/api/calibrate", s.handleAPICalibrate)
	mux.HandleFunc("/api/settings", s.handleAPISettings)
	mux.HandleFunc("/api/settings/reset", s.handleAPISettingsReset)

	// Initial parse of SVG rig definition
	if _, err := s.ReloadRig(); err != nil {
		log.Printf("[Warning] Initial rig parse failed: %v", err)
	}

	addr := fmt.Sprintf(":%d", s.port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	s.listener = ln

	s.httpServer = &http.Server{
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := s.httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[Server] HTTP server error: %v", err)
		}
	}()

	return nil
}

// Addr returns the listener address if started, or configured port.
func (s *Server) Addr() string {
	if s.listener != nil {
		return s.listener.Addr().String()
	}
	return fmt.Sprintf(":%d", s.port)
}

func (s *Server) handleAvatarSVG(w http.ResponseWriter, r *http.Request) {
	absPath, err := filepath.Abs(s.avatarPath)
	if err != nil {
		http.Error(w, "Invalid avatar path", http.StatusBadRequest)
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to open avatar SVG: %v", err), http.StatusNotFound)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	_, _ = io.Copy(w, f)
}

func (s *Server) handleOverlayWS(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow connections from OBS CEF browser source
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("[Server] WebSocket accept error: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	s.hub.Register(conn)
	defer s.hub.Unregister(conn)

	// Keep connection open and read messages until closed
	ctx := r.Context()
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			// Disconnect or error
			break
		}
	}
}

func (s *Server) handleTrackerWS(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("[Server] Tracker WS accept error: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	log.Println("[Server] Studio tracker connected.")

	ctx := r.Context()
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			log.Printf("[Server] Studio tracker disconnected: %v", err)
			break
		}
		if typ != websocket.MessageText {
			continue
		}

		// Check for control signals first
		var ctrl struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &ctrl); err == nil && ctrl.Type != "" {
			switch ctrl.Type {
			case "calibrate":
				if s.engine != nil {
					s.engine.Calibrate()
					_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"calibrated"}`))
				}
				continue
			case "reset_calibration":
				if s.engine != nil {
					s.engine.ResetCalibration()
					_ = conn.Write(ctx, websocket.MessageText, []byte(`{"type":"calibration_reset"}`))
				}
				continue
			}
		}

		// Parse as FaceFrame and process through tracking engine
		var face tracking.FaceFrame
		if err := json.Unmarshal(data, &face); err == nil {
			if s.engine != nil {
				params := s.engine.Process(face)
				s.hub.BroadcastParams(params)
			}
		}
	}
}

func (s *Server) handleAPICalibrate(w http.ResponseWriter, r *http.Request) {
	if s.engine != nil {
		s.engine.Calibrate()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"calibrated"}`))
}

func (s *Server) handleAPISettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.configMgr == nil {
		http.Error(w, `{"error":"config manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	if r.Method == http.MethodGet {
		cfgPath, _ := s.configMgr.ConfigPath()
		resp := map[string]any{
			"settings":   s.configMgr.Get(),
			"configPath": cfgPath,
		}
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var newSettings config.Settings
		if err := json.NewDecoder(r.Body).Decode(&newSettings); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"invalid json: %s"}`, err.Error()), http.StatusBadRequest)
			return
		}

		if err := s.configMgr.Update(newSettings); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"failed to save settings: %s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		cfgPath, _ := s.configMgr.ConfigPath()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "ok",
			"settings":   s.configMgr.Get(),
			"configPath": cfgPath,
		})
		return
	}

	http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
}

func (s *Server) handleAPISettingsReset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.configMgr == nil {
		http.Error(w, `{"error":"config manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	defaults, err := s.configMgr.Reset()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to reset settings: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	cfgPath, _ := s.configMgr.ConfigPath()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":     "ok",
		"settings":   defaults,
		"configPath": cfgPath,
	})
}

// ReloadRig re-reads the avatar SVG from disk, parses its rig directives, and broadcasts an update.
func (s *Server) ReloadRig() (*rig.RigDefinition, error) {
	absPath, err := filepath.Abs(s.avatarPath)
	if err != nil {
		return nil, fmt.Errorf("resolving avatar path: %w", err)
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("reading avatar file: %w", err)
	}

	rigDef, err := rig.ParseSVG(data)
	if err != nil {
		return nil, fmt.Errorf("parsing rig from SVG: %w", err)
	}

	s.rigMu.Lock()
	s.rigDef = rigDef
	s.rigMu.Unlock()

	log.Printf("[Server] Loaded rig with %d rigged elements.", len(rigDef.Elements))
	s.hub.BroadcastJSON(map[string]any{
		"type": "rig_update",
		"rig":  rigDef,
	})

	return rigDef, nil
}

func (s *Server) handleRigJSON(w http.ResponseWriter, r *http.Request) {
	s.rigMu.RLock()
	rigDef := s.rigDef
	s.rigMu.RUnlock()

	if rigDef == nil {
		http.Error(w, "Rig not loaded", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_ = json.NewEncoder(w).Encode(rigDef)
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}
