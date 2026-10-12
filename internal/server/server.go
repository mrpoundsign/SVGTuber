package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/rig"
	"github.com/mrpoundsign/SVGTuber/internal/svg"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
	"github.com/mrpoundsign/SVGTuber/internal/watcher"
	"github.com/mrpoundsign/SVGTuber/web"
)

// Server coordinates the HTTP file server and WebSocket endpoints.
type Server struct {
	port               int
	avatarPath         string
	avatarDir          string
	currentAvatar      string
	hub                *Hub
	engine             *tracking.Engine
	configMgr          *config.Manager
	rigMu              sync.RWMutex
	rigDef             *rig.RigDefinition
	rigParser          rig.Parser
	preprocessedAvatar []byte
	avatarWatcher      *watcher.AvatarWatcher
	accessoriesDir     string
	version            string
	commit             string
	date               string
	expMgr        *ExpressionManager
	trackerMu     sync.RWMutex
	trackerConns  map[*websocket.Conn]chan []byte
	httpServer    *http.Server
	listener      net.Listener
}

// New constructs an unstarted Server instance.
func New(port int, avatarPath string, hub *Hub, engine *tracking.Engine, cfg ...*config.Manager) *Server {
	var cm *config.Manager
	if len(cfg) > 0 {
		cm = cfg[0]
	}

	absAvatar, err := filepath.Abs(avatarPath)
	if err != nil {
		absAvatar = avatarPath
	}

	avatarDir := filepath.Dir(absAvatar)
	currentAvatar := filepath.Base(absAvatar)
	if cm != nil {
		if cm.GetAvatarDir() != "" {
			avatarDir = cm.GetAvatarDir()
		}
		if cm.GetCurrentAvatar() != "" {
			currentAvatar = cm.GetCurrentAvatar()
			absAvatar = filepath.Join(avatarDir, filepath.FromSlash(currentAvatar))
		} else {
			_ = cm.SetActiveAvatar(currentAvatar)
		}
	}

	accessoriesDir := filepath.Join(avatarDir, "accessories")

	s := &Server{
		port:           port,
		avatarPath:     absAvatar,
		avatarDir:      avatarDir,
		accessoriesDir: accessoriesDir,
		currentAvatar:  currentAvatar,
		hub:            hub,
		engine:         engine,
		configMgr:      cm,
		rigParser:      rig.DefaultParser,
		trackerConns:   make(map[*websocket.Conn]chan []byte),
	}

	expMgr := NewExpressionManager(func(active map[string]bool) {
		update := map[string]any{
			"type":        "expression_update",
			"expressions": active,
		}
		hub.BroadcastJSON(update)
		s.broadcastTracker(update)
	})
	s.expMgr = expMgr

	if engine != nil {
		engine.SetExpressionProvider(expMgr.GetActive)
	}

	if _, err := s.ReloadRig(); err != nil {
		log.Printf("[Server] Initial rig load warning: %v", err)
	}

	return s
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

	// Sub-filesystems for web assets: prefer live disk assets during local development if present
	var overlayFS fs.FS
	var studioFS fs.FS
	if fi, err := os.Stat("web/overlay"); err == nil && fi.IsDir() {
		overlayFS = os.DirFS("web/overlay")
		studioFS = os.DirFS("web/studio")
	} else {
		overlayFS, err = fs.Sub(web.StaticFS, "overlay")
		if err != nil {
			return fmt.Errorf("loading overlay static assets: %w", err)
		}
		studioFS, err = fs.Sub(web.StaticFS, "studio")
		if err != nil {
			return fmt.Errorf("loading studio static assets: %w", err)
		}
	}

	noCacheFileServer := func(fsys fs.FS) http.Handler {
		fsHandler := http.FileServer(http.FS(fsys))
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
			fsHandler.ServeHTTP(w, r)
		})
	}
	mux.Handle("/overlay/", http.StripPrefix("/overlay/", noCacheFileServer(overlayFS)))
	mux.Handle("/studio/", http.StripPrefix("/studio/", noCacheFileServer(studioFS)))

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
	mux.HandleFunc("/api/version", s.handleAPIVersion)
	mux.HandleFunc("/api/calibrate", s.handleAPICalibrate)
	mux.HandleFunc("/api/settings", s.handleAPISettings)
	mux.HandleFunc("/api/settings/reset", s.handleAPISettingsReset)

	// Expression REST endpoints
	mux.HandleFunc("/api/expressions", s.handleAPIExpressions)
	mux.HandleFunc("/api/expressions/toggle", s.handleAPIExpressionToggle)
	mux.HandleFunc("/api/expressions/set", s.handleAPIExpressionSet)
	mux.HandleFunc("/api/expressions/trigger", s.handleAPIExpressionTrigger)
	mux.HandleFunc("/api/expressions/reset", s.handleAPIExpressionReset)
	mux.HandleFunc("/api/avatar/reload", s.handleAPIAvatarReload)
	mux.HandleFunc("/api/avatars", s.handleAPIAvatars)
	mux.HandleFunc("/api/avatars/select", s.handleAPIAvatarSelect)

	// Accessories REST endpoints & static file server
	mux.HandleFunc("/accessories/", s.handleAccessoryFile)
	mux.HandleFunc("/api/accessories", s.handleAPIAccessories)
	mux.HandleFunc("/api/accessories/toggle", s.handleAPIAccessoryToggle)
	mux.HandleFunc("/api/accessories/update", s.handleAPIAccessoryUpdate)
	mux.HandleFunc("/api/accessories/remove", s.handleAPIAccessoryRemove)

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
	s.rigMu.RLock()
	currentPath := s.avatarPath
	preprocessed := s.preprocessedAvatar
	s.rigMu.RUnlock()

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if len(preprocessed) > 0 {
		_, _ = w.Write(preprocessed)
		return
	}

	absPath, err := filepath.Abs(currentPath)
	if err != nil {
		http.Error(w, "Invalid avatar path", http.StatusBadRequest)
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to open avatar SVG: %v", err), http.StatusNotFound)
		return
	}
	defer func() { _ = f.Close() }()

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
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	s.hub.Register(conn)
	defer s.hub.Unregister(conn)

	// Send initial active expressions and accessories to new overlay connection
	if s.expMgr != nil {
		active := s.expMgr.GetActive()
		if len(active) > 0 {
			if data, err := json.Marshal(map[string]any{
				"type":        "expression_update",
				"expressions": active,
			}); err == nil {
				_ = conn.Write(r.Context(), websocket.MessageText, data)
			}
		}
	}
	if s.configMgr != nil {
		accs := s.configMgr.GetAccessories()
		if len(accs) > 0 {
			if data, err := json.Marshal(map[string]any{
				"type":        "accessory_update",
				"accessories": accs,
			}); err == nil {
				_ = conn.Write(r.Context(), websocket.MessageText, data)
			}
		}
	}

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
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
	log.Println("[Server] Studio tracker connected.")

	msgCh := make(chan []byte, 16)
	s.trackerMu.Lock()
	if s.trackerConns == nil {
		s.trackerConns = make(map[*websocket.Conn]chan []byte)
	}
	s.trackerConns[conn] = msgCh
	s.trackerMu.Unlock()

	defer func() {
		s.trackerMu.Lock()
		delete(s.trackerConns, conn)
		close(msgCh)
		s.trackerMu.Unlock()
	}()

	// Dedicated write pump for tracker connection
	go func() {
		for msg := range msgCh {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		}
	}()

	// Send initial rig and expression state to newly connected Studio tracker
	s.rigMu.RLock()
	currentRig := s.rigDef
	s.rigMu.RUnlock()
	if currentRig != nil {
		if data, err := json.Marshal(map[string]any{"type": "rig_update", "rig": currentRig}); err == nil {
			select {
			case msgCh <- data:
			default:
			}
		}
	}
	if s.expMgr != nil {
		if data, err := json.Marshal(map[string]any{"type": "expression_update", "expressions": s.expMgr.GetActive()}); err == nil {
			select {
			case msgCh <- data:
			default:
			}
		}
	}

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
			case "expression_toggle":
				var p struct {
					Name string `json:"name"`
				}
				if err := json.Unmarshal(data, &p); err == nil && p.Name != "" && s.expMgr != nil {
					s.expMgr.Toggle(p.Name)
				}
				continue
			case "expression_set":
				var p struct {
					Name   string `json:"name"`
					Active bool   `json:"active"`
				}
				if err := json.Unmarshal(data, &p); err == nil && p.Name != "" && s.expMgr != nil {
					s.expMgr.Set(p.Name, p.Active)
				}
				continue
			case "expression_reset":
				if s.expMgr != nil {
					s.expMgr.Reset()
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

// SetRigParser configures a custom rig parser implementation for dependency injection.
func (s *Server) SetRigParser(p rig.Parser) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	if p != nil {
		s.rigParser = p
	}
}

// SetWatcher configures the file watcher so it can be dynamically redirected when swapping avatars.
func (s *Server) SetWatcher(w *watcher.AvatarWatcher) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.avatarWatcher = w
}

// SwitchAvatar changes the active avatar SVG to a file relative to avatarDir.
func (s *Server) SwitchAvatar(relPath string) error {
	relPath = strings.TrimSpace(relPath)
	if relPath == "" {
		return errors.New("avatar path cannot be empty")
	}

	cleanRel := filepath.Clean(filepath.FromSlash(relPath))
	if strings.HasPrefix(cleanRel, "..") || filepath.IsAbs(cleanRel) {
		return fmt.Errorf("invalid avatar relative path: %s", relPath)
	}

	s.rigMu.RLock()
	dir := s.avatarDir
	s.rigMu.RUnlock()

	targetPath := filepath.Join(dir, cleanRel)
	if _, err := os.Stat(targetPath); err != nil {
		return fmt.Errorf("avatar file not found: %w", err)
	}

	s.rigMu.Lock()
	s.avatarPath = targetPath
	s.currentAvatar = filepath.ToSlash(cleanRel)
	fw := s.avatarWatcher
	s.rigMu.Unlock()

	if s.configMgr != nil {
		_ = s.configMgr.SetActiveAvatar(s.currentAvatar)
	}

	if fw != nil {
		if err := fw.SwitchFile(targetPath); err != nil {
			log.Printf("[Server] Watcher switch warning: %v", err)
		}
	}

	rigDef, err := s.ReloadRig()
	if err != nil {
		return fmt.Errorf("reloading rig for %s: %w", targetPath, err)
	}

	s.hub.BroadcastReload()
	s.broadcastAccessoryUpdate()
	s.broadcastTracker(map[string]any{
		"type":          "avatar_swapped",
		"currentAvatar": s.currentAvatar,
		"avatarDir":     s.avatarDir,
	})

	log.Printf("[Server] Swapped avatar to: %s (rig elements: %d)", s.currentAvatar, len(rigDef.Elements))
	return nil
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

	preprocessed, err := svg.PreprocessSVG(data)
	if err == nil {
		data = preprocessed
	} else {
		log.Printf("[Server] SVG preprocessing warning: %v", err)
	}

	s.rigMu.RLock()
	parser := s.rigParser
	s.rigMu.RUnlock()
	if parser == nil {
		parser = rig.DefaultParser
	}

	rigDef, err := parser.Parse(data)
	if err != nil {
		return nil, fmt.Errorf("parsing rig from SVG: %w", err)
	}

	s.rigMu.Lock()
	s.rigDef = rigDef
	s.preprocessedAvatar = data
	s.rigMu.Unlock()

	if s.expMgr != nil {
		available := s.refreshAvailableExpressions(rigDef)
		log.Printf("[Server] Discovered %d expressions (avatar + accessories): %v", len(available), available)
	}

	log.Printf("[Server] Loaded rig with %d rigged elements.", len(rigDef.Elements))
	s.hub.BroadcastJSON(map[string]any{
		"type": "rig_update",
		"rig":  rigDef,
	})
	s.broadcastTracker(map[string]any{
		"type": "rig_update",
		"rig":  rigDef,
	})

	return rigDef, nil
}

func (s *Server) broadcastTracker(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	s.trackerMu.RLock()
	defer s.trackerMu.RUnlock()
	for _, ch := range s.trackerConns {
		select {
		case ch <- data:
		default:
		}
	}
}

func (s *Server) handleAPIAvatarReload(w http.ResponseWriter, r *http.Request) {
	rigDef, err := s.ReloadRig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.hub.BroadcastReload()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "reloaded",
		"rig":    rigDef,
	})
}

func (s *Server) handleAPIAvatars(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	s.rigMu.RLock()
	dir := s.avatarDir
	current := s.currentAvatar
	s.rigMu.RUnlock()

	avatars, err := config.ScanAvatarDir(dir)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to scan avatar directory: %v"}`, err), http.StatusInternalServerError)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"avatarDir":     dir,
		"currentAvatar": current,
		"avatars":       avatars,
	})
}

func (s *Server) handleAPIAvatarSelect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	var targetAvatar string
	targetAvatar = r.URL.Query().Get("avatar")
	if targetAvatar == "" {
		targetAvatar = r.URL.Query().Get("name")
	}

	if targetAvatar == "" && r.Body != nil {
		var payload struct {
			Avatar string `json:"avatar"`
			Name   string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err == nil {
			if payload.Avatar != "" {
				targetAvatar = payload.Avatar
			} else {
				targetAvatar = payload.Name
			}
		}
	}

	if targetAvatar == "" {
		http.Error(w, `{"error":"missing avatar parameter"}`, http.StatusBadRequest)
		return
	}

	if err := s.SwitchAvatar(targetAvatar); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%v"}`, err), http.StatusBadRequest)
		return
	}

	s.rigMu.RLock()
	current := s.currentAvatar
	dir := s.avatarDir
	s.rigMu.RUnlock()

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        "ok",
		"avatarDir":     dir,
		"currentAvatar": current,
	})
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

func (s *Server) handleAPIExpressions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.expMgr == nil {
		http.Error(w, `{"error":"expression manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	s.rigMu.RLock()
	var avatarExprs []string
	if s.rigDef != nil {
		avatarExprs = ExtractExpressionsFromRig(s.rigDef)
	}
	s.rigMu.RUnlock()

	resp := map[string]any{
		"active":            s.expMgr.GetActive(),
		"available":         s.expMgr.GetAvailable(),
		"avatarExpressions": avatarExprs,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleAPIExpressionToggle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.expMgr == nil {
		http.Error(w, `{"error":"expression manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	name := r.URL.Query().Get("name")
	if name == "" && r.Body != nil {
		var req struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		name = req.Name
	}

	if name == "" {
		http.Error(w, `{"error":"missing expression name parameter"}`, http.StatusBadRequest)
		return
	}

	newState, activeMap := s.expMgr.Toggle(name)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"name":        name,
		"active":      newState,
		"expressions": activeMap,
	})
}

func (s *Server) handleAPIExpressionSet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.expMgr == nil {
		http.Error(w, `{"error":"expression manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	name := r.URL.Query().Get("name")
	activeStr := r.URL.Query().Get("active")
	active := activeStr == "true" || activeStr == "1"

	if (name == "" || activeStr == "") && r.Body != nil {
		var req struct {
			Name   string `json:"name"`
			Active bool   `json:"active"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			if name == "" {
				name = req.Name
			}
			active = req.Active
		}
	}

	if name == "" {
		http.Error(w, `{"error":"missing expression name parameter"}`, http.StatusBadRequest)
		return
	}

	activeMap := s.expMgr.Set(name, active)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"name":        name,
		"active":      active,
		"expressions": activeMap,
	})
}

func (s *Server) handleAPIExpressionTrigger(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.expMgr == nil {
		http.Error(w, `{"error":"expression manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	name := r.URL.Query().Get("name")
	durStr := r.URL.Query().Get("duration")
	if name == "" && r.Body != nil {
		var req struct {
			Name     string `json:"name"`
			Duration string `json:"duration"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			name = req.Name
			if durStr == "" {
				durStr = req.Duration
			}
		}
	}

	if name == "" {
		http.Error(w, `{"error":"missing expression name parameter"}`, http.StatusBadRequest)
		return
	}

	dur, _ := time.ParseDuration(durStr)
	if dur <= 0 {
		dur = 3 * time.Second
	}

	activeMap := s.expMgr.Trigger(name, dur)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"name":        name,
		"durationMs":  dur.Milliseconds(),
		"expressions": activeMap,
	})
}

func (s *Server) handleAPIExpressionReset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.expMgr == nil {
		http.Error(w, `{"error":"expression manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	activeMap := s.expMgr.Reset()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"expressions": activeMap,
	})
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}

func (s *Server) handleAccessoryFile(w http.ResponseWriter, r *http.Request) {
	relPath := strings.TrimPrefix(r.URL.Path, "/accessories/")
	cleanRel := filepath.Clean(filepath.FromSlash(relPath))
	if strings.HasPrefix(cleanRel, "..") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	s.rigMu.RLock()
	accDir := s.accessoriesDir
	s.rigMu.RUnlock()

	fullPath := filepath.Join(accDir, filepath.FromSlash(cleanRel))
	f, err := os.Open(fullPath)
	if err != nil {
		fallbackPath := filepath.Join("testdata", "accessories", filepath.FromSlash(cleanRel))
		if fallbackF, fallbackErr := os.Open(fallbackPath); fallbackErr == nil {
			f = fallbackF
			err = nil
		}
	}
	if err != nil {
		http.Error(w, "accessory not found", http.StatusNotFound)
		return
	}
	defer func() { _ = f.Close() }()

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	_, _ = io.Copy(w, f)
}

func (s *Server) refreshAvailableExpressions(rigDef *rig.RigDefinition) []string {
	if s.expMgr == nil {
		return nil
	}
	available := ExtractExpressionsFromRig(rigDef)
	seen := make(map[string]bool)
	for _, e := range available {
		seen[e] = true
	}

	// Add expressions declared on or defined within actively equipped/enabled accessories only
	if s.configMgr != nil {
		fileExprs := s.scanAccessoryFileExpressions()
		for _, acc := range s.configMgr.GetAccessories() {
			if !acc.Enabled {
				continue
			}
			if acc.Expression != "" {
				clean := normalizeExpressionName(acc.Expression)
				if clean != "" && !seen[clean] {
					seen[clean] = true
					available = append(available, clean)
				}
			}
			if exprs, ok := fileExprs[acc.File]; ok {
				for _, e := range exprs {
					if !seen[e] {
						seen[e] = true
						available = append(available, e)
					}
				}
			}
		}
	}

	s.expMgr.SetAvailable(available)
	return available
}

func (s *Server) scanAccessoryFileExpressions() map[string][]string {
	fileExprs := make(map[string][]string)

	s.rigMu.RLock()
	accDir := s.accessoriesDir
	s.rigMu.RUnlock()

	dirs := []string{}
	if accDir != "" {
		dirs = append(dirs, accDir)
	}
	dirs = append(dirs, filepath.Join("testdata", "accessories"))

	seenFiles := make(map[string]bool)
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".svg") {
				continue
			}
			fname := entry.Name()
			if seenFiles[fname] {
				continue
			}
			seenFiles[fname] = true

			path := filepath.Join(dir, fname)
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			accRig, err := rig.DefaultParser.Parse(data)
			if err != nil {
				continue
			}
			exprs := ExtractExpressionsFromRig(accRig)
			if len(exprs) > 0 {
				fileExprs[fname] = exprs
			}
		}
	}
	return fileExprs
}

func (s *Server) handleAPIAccessories(w http.ResponseWriter, r *http.Request) {
	targetAvatar := r.URL.Query().Get("avatar")
	s.rigMu.RLock()
	currentAvatar := s.currentAvatar
	accDir := s.accessoriesDir
	s.rigMu.RUnlock()
	if targetAvatar == "" {
		targetAvatar = currentAvatar
	}

	availableFiles, _ := config.ScanAvatarDir(accDir)
	if len(availableFiles) == 0 {
		if fallbackFiles, err := config.ScanAvatarDir(filepath.Join("testdata", "accessories")); err == nil && len(fallbackFiles) > 0 {
			availableFiles = fallbackFiles
		}
	}

	var configured []config.AccessoryConfig
	if s.configMgr != nil {
		configured = s.configMgr.GetAccessoriesForAvatar(targetAvatar)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"currentAvatar":   currentAvatar,
		"targetAvatar":    targetAvatar,
		"availableFiles":  availableFiles,
		"fileExpressions": s.scanAccessoryFileExpressions(),
		"accessories":     configured,
	})
}

func (s *Server) handleAPIAccessoryToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	avatarKey := r.URL.Query().Get("avatar")
	id := r.URL.Query().Get("id")
	if id == "" {
		var req struct {
			ID     string `json:"id"`
			Avatar string `json:"avatar,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			id = req.ID
			if req.Avatar != "" {
				avatarKey = req.Avatar
			}
		}
	}
	if id == "" {
		http.Error(w, `{"error":"missing accessory id"}`, http.StatusBadRequest)
		return
	}

	if s.configMgr == nil {
		http.Error(w, `{"error":"config manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	if avatarKey == "" {
		s.rigMu.RLock()
		avatarKey = s.currentAvatar
		s.rigMu.RUnlock()
	}

	newState, err := s.configMgr.ToggleAccessoryForAvatar(avatarKey, id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusNotFound)
		return
	}

	s.broadcastAccessoryUpdate()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"id":          id,
		"enabled":     newState,
		"accessories": s.configMgr.GetAccessoriesForAvatar(avatarKey),
	})
}

func (s *Server) handleAPIAccessoryUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Avatar string `json:"avatar,omitempty"`
		config.AccessoryConfig
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json body"}`, http.StatusBadRequest)
		return
	}

	acc := req.AccessoryConfig
	if acc.ID == "" {
		http.Error(w, `{"error":"missing accessory id"}`, http.StatusBadRequest)
		return
	}
	if acc.File == "" {
		http.Error(w, `{"error":"missing accessory file"}`, http.StatusBadRequest)
		return
	}

	if s.configMgr == nil {
		http.Error(w, `{"error":"config manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	avatarKey := req.Avatar
	if avatarKey == "" {
		avatarKey = r.URL.Query().Get("avatar")
	}
	if avatarKey == "" {
		s.rigMu.RLock()
		avatarKey = s.currentAvatar
		s.rigMu.RUnlock()
	}

	if err := s.configMgr.SetAccessoryForAvatar(avatarKey, acc); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}

	s.broadcastAccessoryUpdate()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"accessory":   acc,
		"accessories": s.configMgr.GetAccessoriesForAvatar(avatarKey),
	})
}

func (s *Server) handleAPIAccessoryRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	avatarKey := r.URL.Query().Get("avatar")
	id := r.URL.Query().Get("id")
	if r.Body != nil {
		var req struct {
			ID     string `json:"id"`
			Avatar string `json:"avatar,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			if id == "" {
				id = req.ID
			}
			if avatarKey == "" && req.Avatar != "" {
				avatarKey = req.Avatar
			}
		}
	}
	if id == "" {
		http.Error(w, `{"error":"missing accessory id"}`, http.StatusBadRequest)
		return
	}

	if s.configMgr == nil {
		http.Error(w, `{"error":"config manager not initialized"}`, http.StatusInternalServerError)
		return
	}

	if avatarKey == "" {
		s.rigMu.RLock()
		avatarKey = s.currentAvatar
		s.rigMu.RUnlock()
	}

	if err := s.configMgr.RemoveAccessoryForAvatar(avatarKey, id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}

	s.broadcastAccessoryUpdate()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"id":          id,
		"accessories": s.configMgr.GetAccessoriesForAvatar(avatarKey),
	})
}

func (s *Server) broadcastAccessoryUpdate() {
	if s.configMgr == nil {
		return
	}
	_ = s.refreshAvailableExpressions(s.rigDef)
	update := map[string]any{
		"type":        "accessory_update",
		"accessories": s.configMgr.GetAccessories(),
	}
	s.hub.BroadcastJSON(update)
	s.broadcastTracker(update)
}

// SetVersion configures the runtime application version, commit hash, and build date.
func (s *Server) SetVersion(version, commit, date string) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.version = version
	s.commit = commit
	s.date = date
}

func (s *Server) handleAPIVersion(w http.ResponseWriter, r *http.Request) {
	s.rigMu.RLock()
	ver := s.version
	commit := s.commit
	date := s.date
	s.rigMu.RUnlock()

	if ver == "" {
		ver = "v0.0.5"
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"version": ver,
		"commit":  commit,
		"date":    date,
	})
}

