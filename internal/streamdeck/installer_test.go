package streamdeck_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mrpoundsign/SVGTuber/internal/streamdeck"
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

	status := streamdeck.CheckPluginStatus(baseDir)
	if !status.Installed || status.NeedsUpdate {
		t.Fatalf("expected installed and up-to-date status, got %+v", status)
	}
	if status.InstalledVersion != streamdeck.BundledPluginVersion() {
		t.Fatalf("InstalledVersion = %q, want %q", status.InstalledVersion, streamdeck.BundledPluginVersion())
	}

	// Simulate an older installed version in manifest.json
	manifestPath := filepath.Join(installedDir, "manifest.json")
	if err := os.WriteFile(manifestPath, []byte(`{"Version":"0.9.0.0"}`), 0o600); err != nil {
		t.Fatalf("write older manifest.json: %v", err)
	}
	olderStatus := streamdeck.CheckPluginStatus(baseDir)
	if !olderStatus.Installed || !olderStatus.NeedsUpdate || olderStatus.InstalledVersion != "0.9.0.0" {
		t.Fatalf("expected NeedsUpdate=true for 0.9.0.0, got %+v", olderStatus)
	}
}
