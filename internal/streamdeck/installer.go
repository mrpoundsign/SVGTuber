package streamdeck

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// PluginDirName is the Elgato Stream Deck bundle directory name.
const PluginDirName = "com.github.mrpoundsign.svgtuber.sdPlugin"

// DefaultPort is the default SVGTuber HTTP and WebSocket control port.
const DefaultPort = 7420

// PluginStatus describes the installation and version state of the Elgato Stream Deck plugin.
type PluginStatus struct {
	Installed        bool
	InstalledVersion string
	BundledVersion   string
	NeedsUpdate      bool
}

//go:embed all:plugin/com.github.mrpoundsign.svgtuber.sdPlugin
var embeddedPluginFS embed.FS

// BundledPluginVersion returns the Version declared in the embedded Stream Deck manifest.json.
func BundledPluginVersion() string {
	data, err := embeddedPluginFS.ReadFile("plugin/" + PluginDirName + "/manifest.json")
	if err != nil {
		return "1.0.0.0"
	}
	var m struct {
		Version string `json:"Version"`
	}
	if err := json.Unmarshal(data, &m); err != nil || strings.TrimSpace(m.Version) == "" {
		return "1.0.0.0"
	}
	return strings.TrimSpace(m.Version)
}

// InstalledPluginVersion returns the Version from the installed Stream Deck manifest.json
// in targetBaseDir (or DefaultPluginsDir if empty), or "" if not installed.
func InstalledPluginVersion(targetBaseDir string) string {
	if strings.TrimSpace(targetBaseDir) == "" {
		dir, err := DefaultPluginsDir()
		if err != nil {
			return ""
		}
		targetBaseDir = dir
	}
	if !IsPluginInstalled(targetBaseDir) {
		return ""
	}
	manifestPath := filepath.Join(targetBaseDir, PluginDirName, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return ""
	}
	var m struct {
		Version string `json:"Version"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return ""
	}
	return strings.TrimSpace(m.Version)
}

// CheckPluginStatus inspects targetBaseDir (or DefaultPluginsDir if empty) and reports whether
// the Stream Deck plugin is installed, its installed version, the bundled version, and whether
// an update is available.
func CheckPluginStatus(targetBaseDir string) PluginStatus {
	bundled := BundledPluginVersion()
	installed := IsPluginInstalled(targetBaseDir)
	if !installed {
		return PluginStatus{
			Installed:      false,
			BundledVersion: bundled,
		}
	}
	instVer := InstalledPluginVersion(targetBaseDir)
	needsUpdate := instVer == "" || compareDotVersions(bundled, instVer) > 0
	return PluginStatus{
		Installed:        true,
		InstalledVersion: instVer,
		BundledVersion:   bundled,
		NeedsUpdate:      needsUpdate,
	}
}

func compareDotVersions(a, b string) int {
	aParts := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	bParts := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	maxLen := max(len(bParts), len(aParts))
	for i := range maxLen {
		var ai, bi int
		if i < len(aParts) {
			ai, _ = strconv.Atoi(aParts[i])
		}
		if i < len(bParts) {
			bi, _ = strconv.Atoi(bParts[i])
		}
		if ai > bi {
			return 1
		}
		if ai < bi {
			return -1
		}
	}
	return 0
}

// DefaultPluginsDir returns the standard Elgato Stream Deck Plugins directory
// (%APPDATA%\Elgato\StreamDeck\Plugins on Windows, or UserConfigDir fallback).
func DefaultPluginsDir() (string, error) {
	appData := os.Getenv("APPDATA")
	if strings.TrimSpace(appData) == "" {
		cfgDir, err := os.UserConfigDir()
		if err != nil {
			return "", fmt.Errorf("streamdeck: resolve user config dir: %w", err)
		}
		appData = cfgDir
	}
	return filepath.Join(appData, "Elgato", "StreamDeck", "Plugins"), nil
}

// IsPluginInstalled reports whether the SVGTuber Stream Deck plugin manifest and runtime bundle
// are present in targetBaseDir (or DefaultPluginsDir if targetBaseDir is empty).
func IsPluginInstalled(targetBaseDir string) bool {
	if strings.TrimSpace(targetBaseDir) == "" {
		dir, err := DefaultPluginsDir()
		if err != nil {
			return false
		}
		targetBaseDir = dir
	}
	manifestPath := filepath.Join(targetBaseDir, PluginDirName, "manifest.json")
	scriptPath := filepath.Join(targetBaseDir, PluginDirName, "bin", "plugin.js")
	if _, err := os.Stat(manifestPath); err != nil {
		return false
	}
	if _, err := os.Stat(scriptPath); err != nil {
		return false
	}
	return true
}

// InstallPlugin extracts the embedded com.github.mrpoundsign.svgtuber.sdPlugin bundle into targetBaseDir
// (or DefaultPluginsDir if targetBaseDir is empty) and returns the installed .sdPlugin directory path.
func InstallPlugin(targetBaseDir string) (string, error) {
	return InstallPluginWithPort(targetBaseDir, DefaultPort)
}

// InstallPluginWithPort extracts the embedded com.github.mrpoundsign.svgtuber.sdPlugin bundle into targetBaseDir
// and writes a default config.json with the configured SVGTuber server port.
func InstallPluginWithPort(targetBaseDir string, port int) (string, error) {
	if strings.TrimSpace(targetBaseDir) == "" {
		dir, err := DefaultPluginsDir()
		if err != nil {
			return "", err
		}
		targetBaseDir = dir
	}
	if port <= 0 || port > 65535 {
		port = DefaultPort
	}

	destPluginDir := filepath.Join(targetBaseDir, PluginDirName)
	const embedRoot = "plugin/" + PluginDirName

	err := fs.WalkDir(embeddedPluginFS, embedRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(embedRoot, path)
		if err != nil {
			return err
		}
		rel = filepath.FromSlash(rel)
		targetPath := filepath.Join(destPluginDir, rel)
		if d.IsDir() {
			return os.MkdirAll(targetPath, 0o750)
		}
		data, err := embeddedPluginFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read embedded %s: %w", path, err)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o750); err != nil {
			return fmt.Errorf("mkdir %s: %w", filepath.Dir(targetPath), err)
		}
		if err := os.WriteFile(targetPath, data, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", targetPath, err)
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("streamdeck: install plugin: %w", err)
	}

	cfgBytes, err := json.MarshalIndent(map[string]any{
		"host": "127.0.0.1",
		"port": port,
	}, "", "  ")
	if err == nil {
		_ = os.WriteFile(filepath.Join(destPluginDir, "config.json"), cfgBytes, 0o600)
	}

	return destPluginDir, nil
}
