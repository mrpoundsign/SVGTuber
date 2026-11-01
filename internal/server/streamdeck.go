package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
)

// Port returns the active HTTP/WebSocket port of the server (or configured port).
func (s *Server) Port() int {
	if s.configMgr != nil {
		if p := s.configMgr.GetPort(); p > 0 && p <= 65535 && s.port == 0 {
			return p
		}
	}
	if s.port > 0 && s.port <= 65535 {
		return s.port
	}
	if s.listener != nil {
		if _, portStr, err := net.SplitHostPort(s.listener.Addr().String()); err == nil {
			if p, convErr := strconv.Atoi(portStr); convErr == nil && p > 0 {
				return p
			}
		}
	}
	return config.DefaultPort
}

// SetStreamDeckPluginsDir overrides the target directory where the Elgato Stream Deck plugin is installed (used in tests).
func (s *Server) SetStreamDeckPluginsDir(dir string) {
	s.rigMu.Lock()
	defer s.rigMu.Unlock()
	s.streamDeckPluginsDir = dir
}

// StreamDeckPluginsDir returns the configured or default Elgato Stream Deck plugins directory.
func (s *Server) StreamDeckPluginsDir() string {
	s.rigMu.RLock()
	dir := s.streamDeckPluginsDir
	s.rigMu.RUnlock()
	if strings.TrimSpace(dir) != "" {
		return dir
	}
	defDir, err := streamdeck.DefaultPluginsDir()
	if err != nil {
		return ""
	}
	return defDir
}

func (s *Server) handleAPIStreamDeckStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"GET required"}`, http.StatusMethodNotAllowed)
		return
	}

	dir := s.StreamDeckPluginsDir()
	installed := streamdeck.IsPluginInstalled(dir)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"installed":     installed,
		"pluginsDir":    dir,
		"pluginDirName": streamdeck.PluginDirName,
		"port":          s.Port(),
	})
}

func (s *Server) handleAPIStreamDeckInstall(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
		return
	}

	dir := s.StreamDeckPluginsDir()
	port := s.Port()
	if s.configMgr != nil {
		if cfgPort := s.configMgr.GetPort(); cfgPort > 0 && cfgPort <= 65535 {
			port = cfgPort
		}
	}
	installedPath, err := streamdeck.InstallPluginWithPort(dir, port)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":      fmt.Sprintf("failed to install Stream Deck plugin: %v", err),
			"pluginsDir": dir,
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        "installed",
		"installed":     true,
		"installedPath": installedPath,
		"pluginsDir":    dir,
		"pluginDirName": streamdeck.PluginDirName,
	})
}

// NormalizeTrackingMode normalizes a tracking mode string to "hybrid", "camera", or "audio".
func NormalizeTrackingMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "camera", "camera_only":
		return "camera"
	case "audio", "audio_only", "voice", "voice_only", "pngtuber":
		return "audio"
	default:
		return "hybrid"
	}
}

// NextTrackingMode cycles through "hybrid" -> "camera" -> "audio" -> "hybrid".
func NextTrackingMode(current string) string {
	switch NormalizeTrackingMode(current) {
	case "hybrid":
		return "camera"
	case "camera":
		return "audio"
	default:
		return "hybrid"
	}
}

// CurrentTrackingMode returns the active tracking/audio mode ("hybrid", "camera", or "audio").
func (s *Server) CurrentTrackingMode() string {
	if s.configMgr == nil {
		return "hybrid"
	}
	return NormalizeTrackingMode(s.configMgr.Get().Audio.Mode)
}

// SetTrackingMode updates the active tracking mode, saves configuration, and broadcasts a mode_update event.
func (s *Server) SetTrackingMode(mode string) (string, error) {
	norm := NormalizeTrackingMode(mode)
	if s.configMgr != nil {
		cur := s.configMgr.Get()
		cur.Audio.Mode = norm
		if err := s.configMgr.Update(cur); err != nil {
			return norm, err
		}
	}
	s.broadcastTracker(map[string]any{
		"type": "mode_update",
		"mode": norm,
	})
	return norm, nil
}

// CycleTrackingMode advances to the next tracking mode and broadcasts a mode_update event.
func (s *Server) CycleTrackingMode() (string, error) {
	next := NextTrackingMode(s.CurrentTrackingMode())
	return s.SetTrackingMode(next)
}

// CycleAvatar switches to the next available avatar SVG in avatarDir in alphabetical order.
func (s *Server) CycleAvatar() (string, error) {
	s.rigMu.RLock()
	dir := s.avatarDir
	cur := s.currentAvatar
	s.rigMu.RUnlock()

	avatars, err := config.ScanAvatarDir(dir)
	if err != nil {
		return cur, err
	}
	if len(avatars) == 0 {
		return cur, errors.New("no avatar SVG files found in avatar directory")
	}

	nextIdx := 0
	for i, a := range avatars {
		if strings.EqualFold(a, cur) {
			nextIdx = (i + 1) % len(avatars)
			break
		}
	}
	target := avatars[nextIdx]
	if err := s.SwitchAvatar(target); err != nil {
		return cur, err
	}
	return target, nil
}

// ToggleAccessoryByQuery toggles an accessory on the current avatar matching ID, filename, or display name.
func (s *Server) ToggleAccessoryByQuery(query string) (string, bool, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return "", false, errors.New("accessory query cannot be empty")
	}
	if s.configMgr == nil {
		return "", false, errors.New("config manager not initialized")
	}

	s.rigMu.RLock()
	avatarKey := s.currentAvatar
	s.rigMu.RUnlock()

	accs := s.configMgr.GetAccessoriesForAvatar(avatarKey)
	qNoExt := strings.TrimSuffix(strings.ToLower(q), ".svg")
	matchedID := q
	for _, acc := range accs {
		fileNoExt := strings.TrimSuffix(strings.ToLower(acc.File), ".svg")
		if strings.EqualFold(acc.ID, q) ||
			strings.EqualFold(acc.File, q) ||
			fileNoExt == qNoExt ||
			(acc.Name != "" && strings.EqualFold(acc.Name, q)) {
			matchedID = acc.ID
			break
		}
	}

	newState, err := s.configMgr.ToggleAccessoryForAvatar(avatarKey, matchedID)
	if err != nil {
		return "", false, err
	}
	s.broadcastAccessoryUpdate()
	return matchedID, newState, nil
}

func (s *Server) buildStateSnapshot() map[string]any {
	s.rigMu.RLock()
	dir := s.avatarDir
	curAvatar := s.currentAvatar
	s.rigMu.RUnlock()

	avatars, _ := config.ScanAvatarDir(dir)
	var activeExprs map[string]bool
	var availExprs []string
	if s.expMgr != nil {
		activeExprs = s.expMgr.GetActive()
		availExprs = s.expMgr.GetAvailable()
	} else {
		activeExprs = map[string]bool{}
	}

	var accs []config.AccessoryConfig
	if s.configMgr != nil {
		accs = s.configMgr.GetAccessoriesForAvatar(curAvatar)
	}

	return map[string]any{
		"type":                 "state_snapshot",
		"currentAvatar":        curAvatar,
		"avatarDir":            dir,
		"avatars":              avatars,
		"expressions":          activeExprs,
		"availableExpressions": availExprs,
		"accessories":          accs,
		"mode":                 s.CurrentTrackingMode(),
	}
}

func (s *Server) handleAPIState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.buildStateSnapshot())
}

func (s *Server) handleAPIMode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"mode": s.CurrentTrackingMode(),
		})
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	mode := r.URL.Query().Get("mode")
	if mode == "" && r.Body != nil {
		var req struct {
			Mode string `json:"mode"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		mode = req.Mode
	}

	var (
		newMode string
		err     error
	)
	if strings.EqualFold(mode, "cycle") || mode == "" {
		newMode, err = s.CycleTrackingMode()
	} else {
		newMode, err = s.SetTrackingMode(mode)
	}
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": err.Error(),
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"mode":   newMode,
	})
}

func (s *Server) handleWSControlCommand(ctrlType string, data []byte) bool {
	switch ctrlType {
	case "get_state":
		s.broadcastTracker(s.buildStateSnapshot())
		return true

	case "calibrate":
		if s.engine != nil {
			s.engine.Calibrate()
		}
		s.broadcastTracker(map[string]any{"type": "calibrated"})
		return true

	case "reset_calibration":
		if s.engine != nil {
			s.engine.ResetCalibration()
		}
		s.broadcastTracker(map[string]any{"type": "calibration_reset"})
		return true

	case "expression_toggle":
		var p struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.Name != "" && s.expMgr != nil {
			s.expMgr.Toggle(p.Name)
		}
		return true

	case "expression_set":
		var p struct {
			Name   string `json:"name"`
			Active bool   `json:"active"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.Name != "" && s.expMgr != nil {
			s.expMgr.Set(p.Name, p.Active)
		}
		return true

	case "expression_trigger":
		var p struct {
			Name     string `json:"name"`
			Duration string `json:"duration"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.Name != "" && s.expMgr != nil {
			dur, _ := time.ParseDuration(p.Duration)
			if dur <= 0 {
				dur = 3 * time.Second
			}
			s.expMgr.Trigger(p.Name, dur)
		}
		return true

	case "expression_reset":
		if s.expMgr != nil {
			s.expMgr.Reset()
		}
		return true

	case "accessory_toggle":
		var p struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.ID != "" {
			_, _, _ = s.ToggleAccessoryByQuery(p.ID)
		}
		return true

	case "avatar_select":
		var p struct {
			Avatar string `json:"avatar"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.Avatar != "" {
			_ = s.SwitchAvatar(p.Avatar)
		}
		return true

	case "avatar_cycle":
		_, _ = s.CycleAvatar()
		return true

	case "avatar_reload":
		if _, err := s.ReloadRig(); err == nil {
			s.hub.BroadcastReload()
		}
		return true

	case "set_mode":
		var p struct {
			Mode string `json:"mode"`
		}
		if err := json.Unmarshal(data, &p); err == nil && p.Mode != "" {
			_, _ = s.SetTrackingMode(p.Mode)
		}
		return true

	case "cycle_mode":
		_, _ = s.CycleTrackingMode()
		return true
	}

	return false
}
