package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigPath_PlatformSpecific(t *testing.T) {
	mgr, err := NewManager()
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	path, err := mgr.ConfigPath()
	if err != nil {
		t.Fatalf("ConfigPath failed: %v", err)
	}

	expectedSub := filepath.Join("com.github", "mrpoundsign.svgtuber", "settings.json")
	if !strings.HasSuffix(path, expectedSub) {
		t.Errorf("Expected path to end with %q, got %q", expectedSub, path)
	}
}

func TestConfigManager_SaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "com.github", "mrpoundsign.svgtuber", "settings.json")

	mgr, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager with custom path failed: %v", err)
	}

	initial := mgr.Get()
	if initial.Tracking.MouthGain != 1.4 {
		t.Errorf("Expected default MouthGain 1.4, got %f", initial.Tracking.MouthGain)
	}

	// Update settings
	updated := initial
	updated.Tracking.MouthGain = 2.2
	updated.Tracking.MouthThreshold = 0.05
	updated.Tracking.YawMultiplier = 1.3
	updated.Audio.Mode = "audio"
	updated.Audio.MicGain = 2.0

	if err := mgr.Update(updated); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify file was written
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Fatalf("Expected settings file to exist at %s", cfgPath)
	}

	// Reload in a fresh manager instance
	mgr2, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager reload failed: %v", err)
	}

	loaded := mgr2.Get()
	if loaded.Tracking.MouthGain != 2.2 {
		t.Errorf("Expected reloaded MouthGain 2.2, got %f", loaded.Tracking.MouthGain)
	}
	if loaded.Tracking.MouthThreshold != 0.05 {
		t.Errorf("Expected reloaded MouthThreshold 0.05, got %f", loaded.Tracking.MouthThreshold)
	}
	if loaded.Tracking.YawMultiplier != 1.3 {
		t.Errorf("Expected reloaded YawMultiplier 1.3, got %f", loaded.Tracking.YawMultiplier)
	}
	if loaded.Audio.Mode != "audio" {
		t.Errorf("Expected reloaded Audio.Mode 'audio', got %q", loaded.Audio.Mode)
	}
	if loaded.Audio.MicGain != 2.0 {
		t.Errorf("Expected reloaded Audio.MicGain 2.0, got %f", loaded.Audio.MicGain)
	}

	// Set and test AvatarPath
	if err := mgr2.SetAvatarPath("/path/to/my_avatar.svg"); err != nil {
		t.Fatalf("SetAvatarPath failed: %v", err)
	}
	if mgr2.GetAvatarPath() != "/path/to/my_avatar.svg" {
		t.Errorf("Expected AvatarPath '/path/to/my_avatar.svg', got %q", mgr2.GetAvatarPath())
	}

	// Reset
	reset, err := mgr2.Reset()
	if err != nil {
		t.Fatalf("Reset failed: %v", err)
	}
	if reset.Tracking.MouthGain != 1.4 {
		t.Errorf("Expected reset MouthGain 1.4, got %f", reset.Tracking.MouthGain)
	}
	if reset.AvatarPath != "/path/to/my_avatar.svg" {
		t.Errorf("Expected AvatarPath to be preserved after reset, got %q", reset.AvatarPath)
	}
}
