package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// TrackingSettings contains tunable multipliers and thresholds for avatar tracking.
type TrackingSettings struct {
	MouthGain       float64 `json:"mouthGain"`       // Multiplier on raw jawOpen (default: 1.4)
	MouthThreshold  float64 `json:"mouthThreshold"`  // Open mouth trigger threshold (default: 0.08)
	BlinkThreshold   float64 `json:"blinkThreshold"`   // Closed eye trigger threshold (legacy fallback, default: 0.45)
	BlinkThresholdL  float64 `json:"blinkThresholdL"`  // Left eye closed trigger threshold (default: 0.45)
	BlinkThresholdR  float64 `json:"blinkThresholdR"`  // Right eye closed trigger threshold (default: 0.45)
	BlinkSyncDelayMs float64 `json:"blinkSyncDelayMs"` // Window to synchronize bilateral blinks in ms (default: 50.0)
	WinkIsBlink      bool    `json:"winkIsBlink"`      // When true, closing either eye closes both eyes (default: false)
	SmileThreshold   float64 `json:"smileThreshold"`   // Smile trigger threshold (default: 0.50)
	EnableSmile      bool    `json:"enableSmile"`      // Enable smile expression tracking (default: true)
	EyeGazeGain      float64 `json:"eyeGazeGain"`      // Multiplier on pupil gaze range (default: 1.0)
	YawMultiplier    float64 `json:"yawMultiplier"`    // Head yaw rotation sensitivity (default: 1.0)
	PitchMultiplier  float64 `json:"pitchMultiplier"`  // Head pitch rotation sensitivity (default: 1.0)
	RollMultiplier       float64 `json:"rollMultiplier"`       // Head roll tilt sensitivity (default: 1.0)
	PoseSmoothing        float64 `json:"poseSmoothing"`        // Smoothing strength multiplier (default: 1.0)
	AutoBlink            bool    `json:"autoBlink"`            // Autonomous natural blinking (default: true)
	AutoBlinkMode        string  `json:"autoBlinkMode"`        // "always", "face_lost_only", "tracked_only" (default: "always")
	AutoBlinkIntervalSec float64 `json:"autoBlinkIntervalSec"` // Interval between auto-blinks in seconds (default: 4.0)
	AutoGaze             bool    `json:"autoGaze"`             // Autonomous subtle eye gaze saccades (default: true)
	AutoGazeMode         string  `json:"autoGazeMode"`         // "always", "face_lost_only", "tracked_only" (default: "always")
	AutoGazeRange        float64 `json:"autoGazeRange"`        // Scale multiplier on gaze micro-movements (default: 1.0)
	AutoTilt             bool    `json:"autoTilt"`             // Autonomous gentle head tilt and sway (default: true)
	AutoTiltMode         string  `json:"autoTiltMode"`         // "always", "face_lost_only", "tracked_only" (default: "always")
	AutoTiltAmount       float64 `json:"autoTiltAmount"`       // Scale multiplier on head sway/tilt (default: 1.0)
	PhysicsEnabled       bool    `json:"physicsEnabled"`       // Enable secondary spring physics and sway (default: true)
	PhysicsAmount        float64 `json:"physicsAmount"`        // Multiplier on physics spring/sway displacement (default: 1.0)
}

// AudioSettings contains microphone lip-sync and blending configuration.
type AudioSettings struct {
	Mode        string  `json:"mode"`        // "hybrid", "camera", "audio" (default: "hybrid")
	MicGain     float64 `json:"micGain"`     // Multiplier on raw mic volume (default: 1.5)
	NoiseGate   float64 `json:"noiseGate"`   // Threshold below which input is silence (default: 0.04)
	DecaySmooth  float64 `json:"decaySmooth"`  // Envelope release smoothing (default: 0.1)
	BounceAmount float64 `json:"bounceAmount"` // Multiplier on voice-reactive bounce height and squash (default: 1.0)
}

// AccessoryConfig represents an external SVG accessory attachment.
type AccessoryConfig struct {
	ID       string  `json:"id"`               // Unique identifier, e.g. "sunglasses"
	File     string  `json:"file"`             // Relative filename in accessories/ directory
	Name     string  `json:"name,omitempty"`   // User-friendly display name
	Target   string  `json:"target,omitempty"` // Anchor element ID in avatar SVG (e.g. "layer_head", "head")
	X        float64 `json:"x"`                // Horizontal offset in pixels
	Y        float64 `json:"y"`                // Vertical offset in pixels
	ScaleX   float64 `json:"scaleX"`           // Horizontal scale/stretch (default: 1.0)
	ScaleY   float64 `json:"scaleY"`           // Vertical scale/stretch (default: 1.0)
	Rotation float64 `json:"rotation"`         // Rotation degrees
	Order      string  `json:"order,omitempty"`  // Layer order: "front" (default) or "back"
	Enabled    bool    `json:"enabled"`          // Whether accessory is equipped
	Expression string  `json:"expression,omitempty"` // Optional trigger expression (e.g. "sweat", "blush", or empty for always)
}

// Settings represents the complete user configuration.
type Settings struct {
	Version           int                          `json:"version"`
	AvatarDir         string                       `json:"avatarDir,omitempty"`     // Directory containing avatar SVGs
	CurrentAvatar     string                       `json:"currentAvatar,omitempty"` // Relative path/filename of active avatar within AvatarDir
	AvatarPath        string                       `json:"avatarPath,omitempty"`    // Full absolute path (for backwards compatibility)
	Tracking          TrackingSettings             `json:"tracking"`
	Audio             AudioSettings                `json:"audio"`
	Accessories       []AccessoryConfig            `json:"accessories,omitempty"`       // Active / default accessories fallback
	AvatarAccessories map[string][]AccessoryConfig `json:"avatarAccessories,omitempty"` // Per-avatar accessory configurations
}

// DefaultSettings returns a initialized Settings object with tuned defaults.
func DefaultSettings() Settings {
	return Settings{
		Version: 2,
		Tracking: TrackingSettings{
			MouthGain:        1.4,
			MouthThreshold:   0.08,
			BlinkThreshold:   0.45,
			BlinkThresholdL:  0.45,
			BlinkThresholdR:  0.45,
			BlinkSyncDelayMs: 50.0,
			WinkIsBlink:      false,
			SmileThreshold:   0.50,
			EnableSmile:      true,
			EyeGazeGain:      1.0,
			YawMultiplier:    1.0,
			PitchMultiplier:  1.0,
			RollMultiplier:       1.0,
			PoseSmoothing:        1.0,
			AutoBlink:            true,
			AutoBlinkMode:        "always",
			AutoBlinkIntervalSec: 4.0,
			AutoGaze:             true,
			AutoGazeMode:         "always",
			AutoGazeRange:        1.0,
			AutoTilt:             true,
			AutoTiltMode:         "always",
			AutoTiltAmount:       1.0,
			PhysicsEnabled:       true,
			PhysicsAmount:        1.0,
		},
		Audio: AudioSettings{
			Mode:         "hybrid",
			MicGain:      1.5,
			NoiseGate:    0.04,
			DecaySmooth:  0.1,
			BounceAmount: 1.0,
		},
	}
}

// Manager manages loading, saving, and thread-safe access to application settings.
type Manager struct {
	mu         sync.RWMutex
	settings   Settings
	customPath string // optional custom path for testing
}

// NewManager initializes a Manager and loads settings from disk, falling back to defaults.
func NewManager(customPath ...string) (*Manager, error) {
	m := &Manager{
		settings: DefaultSettings(),
	}
	if len(customPath) > 0 && customPath[0] != "" {
		m.customPath = customPath[0]
	}

	if err := m.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		// Log or return error if reading corrupted settings
		return nil, fmt.Errorf("loading settings: %w", err)
	}

	return m, nil
}

// ConfigPath returns the OS-specific file path to settings.json in the
// com.github/mrpoundsign.svgtuber configuration directory.
func (m *Manager) ConfigPath() (string, error) {
	if m.customPath != "" {
		return m.customPath, nil
	}

	baseDir, err := os.UserConfigDir()
	if err != nil {
		// Fallback to home directory if UserConfigDir fails
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("resolving user config dir: %w", err)
		}
		baseDir = filepath.Join(home, ".config")
	}

	return filepath.Join(baseDir, "com.github", "mrpoundsign.svgtuber", "settings.json"), nil
}

// Get returns a copy of the active settings.
func (m *Manager) Get() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

// GetAvatarPath returns the persisted avatar path from settings.
func (m *Manager) GetAvatarPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings.AvatarPath
}

// GetAvatarDir returns the persisted avatar directory from settings.
func (m *Manager) GetAvatarDir() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings.AvatarDir
}

// GetCurrentAvatar returns the active avatar relative path within AvatarDir.
func (m *Manager) GetCurrentAvatar() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings.CurrentAvatar
}

// GetActiveAvatarPath returns the full resolved path to the active avatar SVG.
func (m *Manager) GetActiveAvatarPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.settings.AvatarDir != "" && m.settings.CurrentAvatar != "" {
		return filepath.Join(m.settings.AvatarDir, filepath.FromSlash(m.settings.CurrentAvatar))
	}
	return m.settings.AvatarPath
}

func normalizeAvatarKey(key string) string {
	k := filepath.ToSlash(filepath.Clean(strings.TrimSpace(key)))
	if k == "." || k == "/" || k == "" {
		return ""
	}
	return k
}

// SetAvatarPath updates the avatar path, extracts its directory and relative name, and persists it to disk.
func (m *Manager) SetAvatarPath(p string) error {
	m.mu.Lock()
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	m.settings.AvatarPath = abs
	m.settings.AvatarDir = filepath.Dir(abs)
	m.settings.CurrentAvatar = filepath.Base(abs)
	k := normalizeAvatarKey(m.settings.CurrentAvatar)
	if m.settings.AvatarAccessories != nil && k != "" {
		if list, exists := m.settings.AvatarAccessories[k]; exists {
			m.settings.Accessories = make([]AccessoryConfig, len(list))
			copy(m.settings.Accessories, list)
		}
	}
	m.mu.Unlock()
	return m.Save()
}

// SetAvatarLocation sets the avatar path and directory (alias for SetAvatarPath).
func (m *Manager) SetAvatarLocation(fullPath string) error {
	return m.SetAvatarPath(fullPath)
}

// SetActiveAvatar updates the current active avatar relative to AvatarDir and persists to disk.
func (m *Manager) SetActiveAvatar(relPath string) error {
	m.mu.Lock()
	cleanRel := filepath.ToSlash(relPath)
	m.settings.CurrentAvatar = cleanRel
	if m.settings.AvatarDir != "" {
		m.settings.AvatarPath = filepath.Join(m.settings.AvatarDir, filepath.FromSlash(cleanRel))
	}
	k := normalizeAvatarKey(cleanRel)
	if m.settings.AvatarAccessories != nil && k != "" {
		if list, exists := m.settings.AvatarAccessories[k]; exists {
			m.settings.Accessories = make([]AccessoryConfig, len(list))
			copy(m.settings.Accessories, list)
		}
	}
	m.mu.Unlock()
	return m.Save()
}

// ScanAvailableAvatars scans the configured AvatarDir (including subdirectories) for .svg files.
func (m *Manager) ScanAvailableAvatars() ([]string, error) {
	m.mu.RLock()
	dir := m.settings.AvatarDir
	m.mu.RUnlock()
	return ScanAvatarDir(dir)
}

// GetAccessories returns a copy of all configured accessories for the active avatar.
func (m *Manager) GetAccessories() []AccessoryConfig {
	return m.GetAccessoriesForAvatar("")
}

// GetAccessoriesForAvatar returns accessories configured for a specific avatar (or active avatar if empty).
func (m *Manager) GetAccessoriesForAvatar(avatarKey string) []AccessoryConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()

	k := normalizeAvatarKey(avatarKey)
	isActive := false
	if k == "" {
		k = normalizeAvatarKey(m.settings.CurrentAvatar)
		isActive = true
	} else if k == normalizeAvatarKey(m.settings.CurrentAvatar) {
		isActive = true
	}

	var list []AccessoryConfig
	if m.settings.AvatarAccessories != nil && k != "" {
		if specific, exists := m.settings.AvatarAccessories[k]; exists {
			list = specific
		} else if len(m.settings.AvatarAccessories) > 0 {
			list = []AccessoryConfig{}
		}
	}
	if list == nil {
		if isActive {
			list = m.settings.Accessories
		} else {
			list = []AccessoryConfig{}
		}
	}

	out := make([]AccessoryConfig, len(list))
	copy(out, list)
	return out
}

// SetAccessory adds or updates an accessory configuration for the active avatar and persists to disk.
func (m *Manager) SetAccessory(acc AccessoryConfig) error {
	return m.SetAccessoryForAvatar("", acc)
}

// SetAccessoryForAvatar adds or updates an accessory for a specific avatar.
func (m *Manager) SetAccessoryForAvatar(avatarKey string, acc AccessoryConfig) error {
	m.mu.Lock()
	if m.settings.AvatarAccessories == nil {
		m.settings.AvatarAccessories = make(map[string][]AccessoryConfig)
	}

	k := normalizeAvatarKey(avatarKey)
	if k == "" {
		k = normalizeAvatarKey(m.settings.CurrentAvatar)
	}
	if k == "" {
		k = "default"
	}

	currentList := m.settings.AvatarAccessories[k]
	if currentList == nil && len(m.settings.AvatarAccessories) == 0 && len(m.settings.Accessories) > 0 {
		currentList = append([]AccessoryConfig(nil), m.settings.Accessories...)
	}

	found := false
	for i, existing := range currentList {
		if existing.ID == acc.ID {
			currentList[i] = acc
			found = true
			break
		}
	}
	if !found {
		currentList = append(currentList, acc)
	}

	m.settings.AvatarAccessories[k] = currentList
	if k == normalizeAvatarKey(m.settings.CurrentAvatar) || m.settings.CurrentAvatar == "" {
		m.settings.Accessories = append([]AccessoryConfig(nil), currentList...)
	}
	m.mu.Unlock()
	return m.Save()
}

// ToggleAccessory toggles the enabled state of an accessory for the active avatar.
func (m *Manager) ToggleAccessory(id string) (bool, error) {
	return m.ToggleAccessoryForAvatar("", id)
}

// ToggleAccessoryForAvatar toggles an accessory's enabled state for a specific avatar.
func (m *Manager) ToggleAccessoryForAvatar(avatarKey string, id string) (bool, error) {
	m.mu.Lock()
	if m.settings.AvatarAccessories == nil {
		m.settings.AvatarAccessories = make(map[string][]AccessoryConfig)
	}

	k := normalizeAvatarKey(avatarKey)
	if k == "" {
		k = normalizeAvatarKey(m.settings.CurrentAvatar)
	}
	if k == "" {
		k = "default"
	}

	currentList := m.settings.AvatarAccessories[k]
	if currentList == nil && len(m.settings.AvatarAccessories) == 0 && len(m.settings.Accessories) > 0 {
		currentList = append([]AccessoryConfig(nil), m.settings.Accessories...)
	}

	var newState bool
	found := false
	for i, existing := range currentList {
		if existing.ID == id {
			currentList[i].Enabled = !currentList[i].Enabled
			newState = currentList[i].Enabled
			found = true
			break
		}
	}
	if !found {
		m.mu.Unlock()
		return false, fmt.Errorf("accessory with ID %q not found for avatar %q", id, k)
	}

	m.settings.AvatarAccessories[k] = currentList
	if k == normalizeAvatarKey(m.settings.CurrentAvatar) || m.settings.CurrentAvatar == "" {
		m.settings.Accessories = append([]AccessoryConfig(nil), currentList...)
	}
	m.mu.Unlock()
	return newState, m.Save()
}

// RemoveAccessory removes an accessory for the active avatar.
func (m *Manager) RemoveAccessory(id string) error {
	return m.RemoveAccessoryForAvatar("", id)
}

// RemoveAccessoryForAvatar removes an accessory for a specific avatar.
func (m *Manager) RemoveAccessoryForAvatar(avatarKey string, id string) error {
	m.mu.Lock()
	if m.settings.AvatarAccessories == nil {
		m.settings.AvatarAccessories = make(map[string][]AccessoryConfig)
	}

	k := normalizeAvatarKey(avatarKey)
	if k == "" {
		k = normalizeAvatarKey(m.settings.CurrentAvatar)
	}
	if k == "" {
		k = "default"
	}

	currentList := m.settings.AvatarAccessories[k]
	if currentList == nil && len(m.settings.AvatarAccessories) == 0 && len(m.settings.Accessories) > 0 {
		currentList = append([]AccessoryConfig(nil), m.settings.Accessories...)
	}

	filtered := make([]AccessoryConfig, 0, len(currentList))
	for _, acc := range currentList {
		if acc.ID != id {
			filtered = append(filtered, acc)
		}
	}
	m.settings.AvatarAccessories[k] = filtered

	if k == normalizeAvatarKey(m.settings.CurrentAvatar) || m.settings.CurrentAvatar == "" {
		m.settings.Accessories = append([]AccessoryConfig(nil), filtered...)
	}
	m.mu.Unlock()
	return m.Save()
}

// Update updates the active settings and persists them to disk.
func (m *Manager) Update(newSettings Settings) error {
	m.mu.Lock()
	// Preserve configured AvatarDir, CurrentAvatar, and AvatarPath if incoming payload leaves them empty
	if newSettings.AvatarDir == "" && m.settings.AvatarDir != "" {
		newSettings.AvatarDir = m.settings.AvatarDir
	}
	if newSettings.CurrentAvatar == "" && m.settings.CurrentAvatar != "" {
		newSettings.CurrentAvatar = m.settings.CurrentAvatar
	}
	if newSettings.AvatarPath == "" && m.settings.AvatarPath != "" {
		newSettings.AvatarPath = m.settings.AvatarPath
	}
	m.settings = newSettings
	m.mu.Unlock()

	return m.Save()
}

// Reset restores settings to default values and saves to disk while preserving avatar directory and paths.
func (m *Manager) Reset() (Settings, error) {
	defaults := DefaultSettings()
	m.mu.Lock()
	defaults.AvatarDir = m.settings.AvatarDir
	defaults.CurrentAvatar = m.settings.CurrentAvatar
	defaults.AvatarPath = m.settings.AvatarPath
	m.settings = defaults
	m.mu.Unlock()

	err := m.Save()
	return defaults, err
}

// Load reads the settings file from disk. If the file does not exist, it initializes with defaults.
// Automatically upgrades legacy configs (Version 1 -> Version 2) by deriving avatarDir and currentAvatar.
func (m *Manager) Load() error {
	path, err := m.ConfigPath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			m.mu.Lock()
			m.settings = DefaultSettings()
			m.mu.Unlock()
			return nil
		}
		return err
	}

	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("parsing settings JSON: %w", err)
	}

	// Auto-upgrade version and split legacy AvatarPath into AvatarDir and CurrentAvatar
	upgraded := false
	if s.Version < 2 {
		s.Version = 2
		upgraded = true
	}
	if s.AvatarPath != "" {
		if s.AvatarDir == "" {
			s.AvatarDir = filepath.Dir(s.AvatarPath)
			upgraded = true
		}
		if s.CurrentAvatar == "" {
			if rel, err := filepath.Rel(s.AvatarDir, s.AvatarPath); err == nil && !strings.HasPrefix(rel, "..") {
				s.CurrentAvatar = filepath.ToSlash(rel)
			} else {
				s.CurrentAvatar = filepath.Base(s.AvatarPath)
			}
			upgraded = true
		}
	} else if s.AvatarDir != "" && s.CurrentAvatar != "" {
		s.AvatarPath = filepath.Join(s.AvatarDir, filepath.FromSlash(s.CurrentAvatar))
	}

	// Validate / fill missing defaults
	if s.Tracking.MouthGain <= 0 {
		s.Tracking.MouthGain = 1.4
	}
	if s.Tracking.MouthThreshold <= 0 {
		s.Tracking.MouthThreshold = 0.08
	}
	if s.Tracking.BlinkThreshold <= 0 {
		s.Tracking.BlinkThreshold = 0.45
	}
	if s.Tracking.BlinkThresholdL <= 0 {
		if s.Tracking.BlinkThreshold > 0 {
			s.Tracking.BlinkThresholdL = s.Tracking.BlinkThreshold
		} else {
			s.Tracking.BlinkThresholdL = 0.45
		}
	}
	if s.Tracking.BlinkThresholdR <= 0 {
		if s.Tracking.BlinkThreshold > 0 {
			s.Tracking.BlinkThresholdR = s.Tracking.BlinkThreshold
		} else {
			s.Tracking.BlinkThresholdR = 0.45
		}
	}
	if s.Tracking.BlinkSyncDelayMs < 0 {
		s.Tracking.BlinkSyncDelayMs = 0
	} else if s.Tracking.BlinkSyncDelayMs == 0 && s.Tracking.BlinkThresholdL == s.Tracking.BlinkThreshold {
		s.Tracking.BlinkSyncDelayMs = 50.0
	}
	if s.Tracking.SmileThreshold <= 0 {
		s.Tracking.SmileThreshold = 0.50
	}
	if s.Tracking.EyeGazeGain <= 0 {
		s.Tracking.EyeGazeGain = 1.0
	}
	if s.Tracking.YawMultiplier <= 0 {
		s.Tracking.YawMultiplier = 1.0
	}
	if s.Tracking.PitchMultiplier <= 0 {
		s.Tracking.PitchMultiplier = 1.0
	}
	if s.Tracking.RollMultiplier <= 0 {
		s.Tracking.RollMultiplier = 1.0
	}
	if s.Tracking.AutoBlinkIntervalSec <= 0 {
		s.Tracking.AutoBlinkIntervalSec = 4.0
	}
	if s.Tracking.AutoBlinkMode == "" {
		s.Tracking.AutoBlinkMode = "always"
	}
	if s.Tracking.AutoGazeRange <= 0 {
		s.Tracking.AutoGazeRange = 1.0
	}
	if s.Tracking.AutoGazeMode == "" {
		s.Tracking.AutoGazeMode = "always"
	}
	if s.Tracking.AutoTiltAmount <= 0 {
		s.Tracking.AutoTiltAmount = 1.0
	}
	if s.Tracking.AutoTiltMode == "" {
		s.Tracking.AutoTiltMode = "always"
	}
	if s.Audio.Mode == "" {
		s.Audio.Mode = "hybrid"
	}
	if s.Audio.MicGain <= 0 {
		s.Audio.MicGain = 1.5
	}
	if s.Audio.NoiseGate <= 0 {
		s.Audio.NoiseGate = 0.04
	}
	if s.Audio.DecaySmooth <= 0 {
		s.Audio.DecaySmooth = 0.1
	}
	if s.Audio.BounceAmount <= 0 && !strings.Contains(string(data), "bounceAmount") {
		s.Audio.BounceAmount = 1.0
	}
	if !strings.Contains(string(data), "physicsEnabled") {
		s.Tracking.PhysicsEnabled = true
	}
	if s.Tracking.PhysicsAmount <= 0 && !strings.Contains(string(data), "physicsAmount") {
		s.Tracking.PhysicsAmount = 1.0
	}

	m.mu.Lock()
	m.settings = s
	m.mu.Unlock()

	// Persist automatically if upgraded from legacy format
	if upgraded {
		_ = m.Save()
	}

	return nil
}

// ScanAvatarDir recursively scans a directory for .svg files (including subdirectories)
// and returns their relative paths formatted with forward slashes.
func ScanAvatarDir(dir string) ([]string, error) {
	if dir == "" {
		return nil, nil
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(absDir); os.IsNotExist(err) {
		return nil, nil
	}

	var results []string
	err = filepath.WalkDir(absDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && path != absDir {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".svg") {
			rel, relErr := filepath.Rel(absDir, path)
			if relErr == nil && !strings.HasPrefix(rel, "..") {
				results = append(results, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(results)
	return results, nil
}

// Save writes the current settings formatted as JSON to disk.
func (m *Manager) Save() error {
	path, err := m.ConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	m.mu.RLock()
	data, err := json.MarshalIndent(m.settings, "", "  ")
	m.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("marshaling settings: %w", err)
	}

	tmpFile := path + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return fmt.Errorf("writing settings temp file: %w", err)
	}

	if err := os.Rename(tmpFile, path); err != nil {
		return fmt.Errorf("persisting settings file: %w", err)
	}

	return nil
}
