package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
	RollMultiplier   float64 `json:"rollMultiplier"`   // Head roll tilt sensitivity (default: 1.0)
	PoseSmoothing    float64 `json:"poseSmoothing"`    // Smoothing strength multiplier (default: 1.0)
}

// AudioSettings contains microphone lip-sync and blending configuration.
type AudioSettings struct {
	Mode        string  `json:"mode"`        // "hybrid", "camera", "audio" (default: "hybrid")
	MicGain     float64 `json:"micGain"`     // Multiplier on raw mic volume (default: 1.5)
	NoiseGate   float64 `json:"noiseGate"`   // Threshold below which input is silence (default: 0.04)
	DecaySmooth float64 `json:"decaySmooth"` // Envelope release smoothing (default: 0.1)
}

// Settings represents the complete user configuration.
type Settings struct {
	Version  int              `json:"version"`
	Tracking TrackingSettings `json:"tracking"`
	Audio    AudioSettings    `json:"audio"`
}

// DefaultSettings returns a initialized Settings object with tuned defaults.
func DefaultSettings() Settings {
	return Settings{
		Version: 1,
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
			RollMultiplier:   1.0,
			PoseSmoothing:    1.0,
		},
		Audio: AudioSettings{
			Mode:        "hybrid",
			MicGain:     1.5,
			NoiseGate:   0.04,
			DecaySmooth: 0.1,
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

// Update updates the active settings and persists them to disk.
func (m *Manager) Update(newSettings Settings) error {
	m.mu.Lock()
	m.settings = newSettings
	m.mu.Unlock()

	return m.Save()
}

// Reset restores settings to default values and saves to disk.
func (m *Manager) Reset() (Settings, error) {
	defaults := DefaultSettings()
	m.mu.Lock()
	m.settings = defaults
	m.mu.Unlock()

	err := m.Save()
	return defaults, err
}

// Load reads the settings file from disk. If the file does not exist, it initializes with defaults.
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

	m.mu.Lock()
	m.settings = s
	m.mu.Unlock()

	return nil
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
