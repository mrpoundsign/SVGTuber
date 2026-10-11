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

func TestAccessoryManagement(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")

	mgr, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	acc := AccessoryConfig{
		ID:       "sunglasses",
		File:     "sunglasses.svg",
		Name:     "Cool Shades",
		Target:   "layer_head",
		X:        10,
		Y:        20,
		ScaleX:   1.2,
		ScaleY:   1.2,
		Rotation: 5,
		Order:    "front",
		Enabled:  false,
	}

	if err := mgr.SetAccessory(acc); err != nil {
		t.Fatalf("SetAccessory failed: %v", err)
	}

	list := mgr.GetAccessories()
	if len(list) != 1 {
		t.Fatalf("Expected 1 accessory, got %d", len(list))
	}
	if list[0].ID != "sunglasses" || list[0].ScaleX != 1.2 {
		t.Errorf("Unexpected accessory values: %+v", list[0])
	}

	// Toggle accessory
	newState, err := mgr.ToggleAccessory("sunglasses")
	if err != nil {
		t.Fatalf("ToggleAccessory failed: %v", err)
	}
	if !newState {
		t.Errorf("Expected enabled state to be true after toggle")
	}

	// Verify persistence
	mgr2, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Reload failed: %v", err)
	}
	list2 := mgr2.GetAccessories()
	if len(list2) != 1 || !list2[0].Enabled {
		t.Errorf("Persisted accessory mismatch: %+v", list2)
	}

	// Remove accessory
	if err := mgr.RemoveAccessory("sunglasses"); err != nil {
		t.Fatalf("RemoveAccessory failed: %v", err)
	}
	if len(mgr.GetAccessories()) != 0 {
		t.Errorf("Expected 0 accessories after removal")
	}
}

func TestManager_PerAvatarAccessories(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")

	mgr, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	avatar1 := "nana.svg"
	avatar2 := "robots/bot.svg"

	if err := mgr.SetActiveAvatar(avatar1); err != nil {
		t.Fatalf("SetActiveAvatar failed: %v", err)
	}

	// Add accessory to avatar 1
	acc1 := AccessoryConfig{
		ID:         "cat_ears",
		File:       "cat_ears.svg",
		Name:       "Cat Ears",
		Target:     "layer_head",
		Expression: "blush",
		Enabled:    true,
	}
	if err := mgr.SetAccessoryForAvatar(avatar1, acc1); err != nil {
		t.Fatalf("SetAccessoryForAvatar failed: %v", err)
	}

	// Add different accessory to avatar 2
	acc2 := AccessoryConfig{
		ID:         "sweat",
		File:       "sweat_drop.svg",
		Name:       "Sweat Drop",
		Target:     "Head",
		Expression: "isSweat",
		Enabled:    true,
	}
	if err := mgr.SetAccessoryForAvatar(avatar2, acc2); err != nil {
		t.Fatalf("SetAccessoryForAvatar failed: %v", err)
	}

	// Verify avatar 1 has cat_ears
	a1List := mgr.GetAccessoriesForAvatar(avatar1)
	if len(a1List) != 1 || a1List[0].ID != "cat_ears" || a1List[0].Expression != "blush" {
		t.Fatalf("Avatar 1 accessories mismatch: %+v", a1List)
	}

	// Verify avatar 2 has sweat
	a2List := mgr.GetAccessoriesForAvatar(avatar2)
	if len(a2List) != 1 || a2List[0].ID != "sweat" || a2List[0].Expression != "isSweat" {
		t.Fatalf("Avatar 2 accessories mismatch: %+v", a2List)
	}

	// Verify GetAccessories() reflects active avatar (avatar1)
	activeList := mgr.GetAccessories()
	if len(activeList) != 1 || activeList[0].ID != "cat_ears" {
		t.Fatalf("Active avatar accessories mismatch: %+v", activeList)
	}

	// Switch active avatar to avatar2
	if err := mgr.SetActiveAvatar(avatar2); err != nil {
		t.Fatalf("SetActiveAvatar failed: %v", err)
	}
	activeList2 := mgr.GetAccessories()
	if len(activeList2) != 1 || activeList2[0].ID != "sweat" {
		t.Fatalf("Switched active avatar accessories mismatch: %+v", activeList2)
	}

	// Reload from disk and verify persistence across avatars
	mgrReloaded, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("Reload failed: %v", err)
	}
	a1Reloaded := mgrReloaded.GetAccessoriesForAvatar(avatar1)
	if len(a1Reloaded) != 1 || a1Reloaded[0].ID != "cat_ears" || a1Reloaded[0].Expression != "blush" {
		t.Fatalf("Reloaded avatar 1 accessories mismatch: %+v", a1Reloaded)
	}
	a2Reloaded := mgrReloaded.GetAccessoriesForAvatar(avatar2)
	if len(a2Reloaded) != 1 || a2Reloaded[0].ID != "sweat" || a2Reloaded[0].Expression != "isSweat" {
		t.Fatalf("Reloaded avatar 2 accessories mismatch: %+v", a2Reloaded)
	}
}

func TestConfigManager_UpdatePreservesAccessories(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "settings.json")

	mgr, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	avatar := "test.svg"
	if err := mgr.SetActiveAvatar(avatar); err != nil {
		t.Fatalf("SetActiveAvatar failed: %v", err)
	}

	acc := AccessoryConfig{
		ID:      "shades",
		File:    "shades.svg",
		Target:  "layer_head",
		Enabled: true,
	}
	if err := mgr.SetAccessoryForAvatar(avatar, acc); err != nil {
		t.Fatalf("SetAccessoryForAvatar failed: %v", err)
	}

	// Verify accessory exists before Update
	before := mgr.GetAccessoriesForAvatar(avatar)
	if len(before) != 1 || before[0].ID != "shades" {
		t.Fatalf("Expected 1 accessory before update, got: %+v", before)
	}

	// Simulate frontend updating tracking sliders (which sends Settings with empty/nil accessories)
	sliderUpdate := Settings{
		Version: 2,
		Tracking: TrackingSettings{
			MouthGain: 2.5,
		},
	}
	if err := mgr.Update(sliderUpdate); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	// Verify accessory was NOT wiped
	after := mgr.GetAccessoriesForAvatar(avatar)
	if len(after) != 1 || after[0].ID != "shades" {
		t.Fatalf("Update wiped accessories! Expected 1 accessory, got: %+v", after)
	}

	// Reload from disk and verify persistence
	mgrReloaded, err := NewManager(cfgPath)
	if err != nil {
		t.Fatalf("NewManager reload failed: %v", err)
	}
	afterReload := mgrReloaded.GetAccessoriesForAvatar(avatar)
	if len(afterReload) != 1 || afterReload[0].ID != "shades" {
		t.Fatalf("Reloaded config missing accessories! Got: %+v", afterReload)
	}

	// Verify Reset also preserves accessories
	if _, err := mgr.Reset(); err != nil {
		t.Fatalf("Reset failed: %v", err)
	}
	afterReset := mgr.GetAccessoriesForAvatar(avatar)
	if len(afterReset) != 1 || afterReset[0].ID != "shades" {
		t.Fatalf("Reset wiped accessories! Got: %+v", afterReset)
	}
}


