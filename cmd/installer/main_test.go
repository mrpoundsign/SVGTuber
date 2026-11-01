package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/mrpoundsign/appinstaller/pkg/installer"

	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
)

type spyRegistry struct {
	addedPath   string
	removedPath string
}

func (s *spyRegistry) RegisterUninstall(installer.UninstallRegistration) error { return nil }
func (s *spyRegistry) UnregisterUninstall(string) error                        { return nil }
func (s *spyRegistry) AddToUserPath(dir string) error {
	s.addedPath = dir
	return nil
}
func (s *spyRegistry) RemoveFromUserPath(dir string) error {
	s.removedPath = dir
	return nil
}

func TestInstallerAppSpecAndOptionalComponents(t *testing.T) {
	tempRoot := t.TempDir()
	installDir := filepath.Join(tempRoot, "Programs", "SVGTuber")
	wsDir := filepath.Join(tempRoot, "Documents", "SVGTuber")
	sdDir := filepath.Join(tempRoot, "AppData", "Roaming", "Elgato", "StreamDeck", "Plugins")
	cfgDir := filepath.Join(tempRoot, "AppData", "Roaming", "com.github", "mrpoundsign.svgtuber")

	starterWorkspaceDirOverride = wsDir
	streamDeckPluginsDirOverride = sdDir
	purgeDirsOverride = []string{cfgDir}
	spyReg := &spyRegistry{}
	registryOverride = spyReg
	t.Cleanup(func() {
		starterWorkspaceDirOverride = ""
		streamDeckPluginsDirOverride = ""
		purgeDirsOverride = nil
		registryOverride = nil
	})

	spec := buildAppSpec()
	if spec.AppName != "SVGTuber" {
		t.Fatalf("AppName = %q, want SVGTuber", spec.AppName)
	}
	if spec.AppID != "com.github.mrpoundsign.svgtuber" {
		t.Fatalf("AppID = %q, want com.github.mrpoundsign.svgtuber", spec.AppID)
	}

	// Inject synthetic embedded payload for testing unpack + optional components
	spec.PayloadFS = fstest.MapFS{
		"payload/svgtuber.exe":               {Data: []byte("fake-svgtuber-exe"), Mode: 0755},
		"payload/avatar.svg":                 {Data: []byte("<svg id='starter'/>"), Mode: 0644},
		"payload/accessories/sunglasses.svg": {Data: []byte("<svg id='glasses'/>"), Mode: 0644},
		"payload/docs/RIGGING_GUIDE.md":      {Data: []byte("# Rigging Guide"), Mode: 0644},
		"payload/LICENSE":                    {Data: []byte("MIT"), Mode: 0644},
		"payload/README.md":                  {Data: []byte("# SVGTuber"), Mode: 0644},
	}

	ins := installer.NewInstaller(spec)
	ins.Registry = spyReg

	opts := installer.Options{
		InstallDir:              installDir,
		CreateStartMenuShortcut: true,
		CreateDesktopShortcut:   true,
		SelectedComponents: map[string]bool{
			"starter_workspace": true,
			"add_path":          true,
			"streamdeck_plugin": true,
		},
	}

	manifest, err := ins.Install(context.Background(), opts, nil)
	if err != nil {
		t.Fatalf("ins.Install failed: %v", err)
	}
	if manifest == nil {
		t.Fatal("expected non-nil manifest")
	}

	// Verify unpacked files in installDir
	for _, rel := range []string{"svgtuber.exe", "avatar.svg", "accessories/sunglasses.svg", "docs/RIGGING_GUIDE.md", "LICENSE", "README.md", "install-manifest.json"} {
		if _, err := os.Stat(filepath.Join(installDir, filepath.FromSlash(rel))); err != nil {
			t.Errorf("expected installed file %s to exist: %v", rel, err)
		}
	}

	// Verify starter_workspace copied avatar.svg and accessories/sunglasses.svg into wsDir
	wsAvatar := filepath.Join(wsDir, "avatar.svg")
	data, err := os.ReadFile(wsAvatar)
	if err != nil {
		t.Fatalf("expected starter avatar at %s: %v", wsAvatar, err)
	}
	if string(data) != "<svg id='starter'/>" {
		t.Errorf("starter avatar content = %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(wsDir, "accessories", "sunglasses.svg")); err != nil {
		t.Errorf("expected starter accessory in workspace: %v", err)
	}

	// Verify starter_workspace does NOT overwrite existing user-edited avatar.svg
	if err := os.WriteFile(wsAvatar, []byte("<svg id='user-custom'/>"), 0644); err != nil {
		t.Fatalf("write custom avatar: %v", err)
	}
	if err := copyStarterWorkspace(installDir, wsDir); err != nil {
		t.Fatalf("second copyStarterWorkspace failed: %v", err)
	}
	afterData, _ := os.ReadFile(wsAvatar)
	if string(afterData) != "<svg id='user-custom'/>" {
		t.Errorf("expected existing user avatar to be preserved, got %q", string(afterData))
	}

	// Verify add_path registered installDir in user PATH and updated install-manifest.json
	if spyReg.addedPath != installDir {
		t.Errorf("spyReg.addedPath = %q, want %q", spyReg.addedPath, installDir)
	}
	reloadedManifest, err := installer.LoadManifest(installDir)
	if err != nil {
		t.Fatalf("LoadManifest failed: %v", err)
	}
	if !reloadedManifest.AddedToUserPath {
		t.Error("expected reloaded manifest AddedToUserPath = true")
	}

	// Verify streamdeck_plugin installed com.github.mrpoundsign.svgtuber.sdPlugin into sdDir
	if !streamdeck.IsPluginInstalled(sdDir) {
		t.Errorf("expected Stream Deck plugin installed in %s", sdDir)
	}

	// Create mock config dir to verify purge on Uninstall
	if err := os.MkdirAll(cfgDir, 0755); err != nil {
		t.Fatalf("mkdir cfgDir: %v", err)
	}
	_ = os.WriteFile(filepath.Join(cfgDir, "settings.json"), []byte("{}"), 0644)

	if err := ins.Uninstall(context.Background(), installDir, true, nil); err != nil {
		t.Fatalf("ins.Uninstall failed: %v", err)
	}
	if spyReg.removedPath != installDir {
		t.Errorf("spyReg.removedPath = %q, want %q", spyReg.removedPath, installDir)
	}
	if _, err := os.Stat(cfgDir); !os.IsNotExist(err) {
		t.Errorf("expected purged config dir %s to be removed", cfgDir)
	}
}
