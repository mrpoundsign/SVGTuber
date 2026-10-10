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

func TestConfig_AutoUpgrade(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")

	// Write legacy v1 config JSON with only avatarPath
	v1JSON := `{
		"version": 1,
		"avatarPath": "/home/user/stream/avatar.svg",
		"tracking": { "mouthGain": 1.5 }
	}`
	if err := os.WriteFile(cfgPath, []byte(v1JSON), 0644); err != nil {
		t.Fatalf("Failed to write v1 config: %v", err)
	}

	mgr, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager failed to load v1 config: %v", err)
	}

	settings := mgr.Get()
	if settings.Version != 2 {
		t.Errorf("Expected auto-upgraded Version 2, got %d", settings.Version)
	}
	if settings.AvatarDir != "/home/user/stream" {
		t.Errorf("Expected AvatarDir '/home/user/stream', got %q", settings.AvatarDir)
	}
	if settings.CurrentAvatar != "avatar.svg" {
		t.Errorf("Expected CurrentAvatar 'avatar.svg', got %q", settings.CurrentAvatar)
	}

	// Verify file on disk was upgraded
	mgrReloaded, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Reloading upgraded config failed: %v", err)
	}
	if mgrReloaded.Get().Version != 2 {
		t.Errorf("Expected disk file to have Version 2, got %d", mgrReloaded.Get().Version)
	}
}

func TestScanAvatarDir(t *testing.T) {
	tmpDir := t.TempDir()

	// Create structure:
	// tmpDir/
	//   root.svg
	//   notes.txt
	//   outfits/
	//     casual.svg
	//     formal.SVG
	//   .hidden/
	//     secret.svg
	_ = os.WriteFile(filepath.Join(tmpDir, "root.svg"), []byte("<svg/>"), 0644)
	_ = os.WriteFile(filepath.Join(tmpDir, "notes.txt"), []byte("text"), 0644)

	outfitsDir := filepath.Join(tmpDir, "outfits")
	_ = os.MkdirAll(outfitsDir, 0755)
	_ = os.WriteFile(filepath.Join(outfitsDir, "casual.svg"), []byte("<svg/>"), 0644)
	_ = os.WriteFile(filepath.Join(outfitsDir, "formal.SVG"), []byte("<svg/>"), 0644)

	hiddenDir := filepath.Join(tmpDir, ".hidden")
	_ = os.MkdirAll(hiddenDir, 0755)
	_ = os.WriteFile(filepath.Join(hiddenDir, "secret.svg"), []byte("<svg/>"), 0644)

	results, err := ScanAvatarDir(tmpDir)
	if err != nil {
		t.Fatalf("ScanAvatarDir failed: %v", err)
	}

	expected := []string{"outfits/casual.svg", "outfits/formal.SVG", "root.svg"}
	if len(results) != len(expected) {
		t.Fatalf("Expected %d avatars, got %d: %v", len(expected), len(results), results)
	}
	for i, exp := range expected {
		if results[i] != exp {
			t.Errorf("Result [%d]: expected %q, got %q", i, exp, results[i])
		}
	}
}

