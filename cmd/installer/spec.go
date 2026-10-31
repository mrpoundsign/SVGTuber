package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mrpoundsign/appinstaller/pkg/installer"
)

//go:embed payload/*
var payloadFS embed.FS

var (
	AppVersion = "0.0.7"

	// Overridable in unit tests to guarantee strict test isolation inside os.TempDir().
	starterWorkspaceDirOverride string
	purgeDirsOverride           []string
	registryOverride            installer.RegistryManager
)

func buildAppSpec() installer.AppSpec {
	return installer.AppSpec{
		AppName:       "SVGTuber",
		AppID:         "com.github.mrpoundsign.svgtuber",
		Description:   "Zero-CGO, browser-tracked SVG VTuber engine for Inkscape and OBS",
		Publisher:     "mrpoundsign",
		Version:       AppVersion,
		RepoOwner:     "mrpoundsign",
		RepoName:      "SVGTuber",
		BinaryName:    "svgtuber.exe",
		PayloadFS:     payloadFS,
		PayloadSubdir: "payload",
		DataDirsToPurge: func() []string {
			if len(purgeDirsOverride) > 0 {
				return purgeDirsOverride
			}
			var dirs []string
			if cfgDir, err := os.UserConfigDir(); err == nil && cfgDir != "" {
				dirs = append(dirs,
					filepath.Join(cfgDir, "com.github", "mrpoundsign.svgtuber"),
					filepath.Join(cfgDir, "com.github.mrpoundsign.svgtuber"),
				)
			}
			if localApp := os.Getenv("LOCALAPPDATA"); localApp != "" {
				dirs = append(dirs, filepath.Join(localApp, "com.github.mrpoundsign.svgtuber"))
			} else if cacheDir, err := os.UserCacheDir(); err == nil && cacheDir != "" {
				dirs = append(dirs, filepath.Join(cacheDir, "com.github.mrpoundsign.svgtuber"))
			}
			return dirs
		},
		OptionalComponents: []installer.ComponentSpec{
			{
				ID:          "starter_workspace",
				Title:       "Create Starter Avatar Workspace",
				Description: `Copy starter avatar.svg and accessories/ to Documents\SVGTuber`,
				DefaultOn:   true,
				Run: func(_ context.Context, installDir string, progress func(cur, total int64, status string)) error {
					wsDir, err := resolveStarterWorkspaceDir()
					if err != nil {
						return err
					}
					progress(0, 2, "Preparing Documents\\SVGTuber workspace...")
					if err := copyStarterWorkspace(installDir, wsDir); err != nil {
						return err
					}
					progress(2, 2, "Starter avatar workspace ready.")
					return nil
				},
			},
			{
				ID:          "add_path",
				Title:       "Add svgtuber to User PATH",
				Description: "Register svgtuber in User PATH for CLI and MCP server usage",
				DefaultOn:   true,
				Run: func(_ context.Context, installDir string, progress func(cur, total int64, status string)) error {
					progress(0, 1, "Adding SVGTuber to User PATH...")
					reg := registryOverride
					if reg == nil {
						ins := installer.NewInstaller(installer.AppSpec{AppName: "SVGTuber"})
						reg = ins.Registry
					}
					if reg != nil {
						if err := reg.AddToUserPath(installDir); err != nil {
							return err
						}
					}
					markManifestAddedToPath(installDir)
					progress(1, 1, "Added SVGTuber to User PATH.")
					return nil
				},
			},
		},
	}
}

func resolveStarterWorkspaceDir() (string, error) {
	if starterWorkspaceDirOverride != "" {
		return starterWorkspaceDirOverride, nil
	}
	if testing.Testing() {
		return filepath.Join(os.TempDir(), "svgtuber-test-workspace"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	return filepath.Join(home, "Documents", "SVGTuber"), nil
}

func copyStarterWorkspace(installDir, wsDir string) error {
	accDstDir := filepath.Join(wsDir, "accessories")
	if err := os.MkdirAll(accDstDir, 0755); err != nil {
		return fmt.Errorf("create starter workspace dir: %w", err)
	}

	avatarSrc := filepath.Join(installDir, "avatar.svg")
	avatarDst := filepath.Join(wsDir, "avatar.svg")
	if _, err := os.Stat(avatarSrc); err == nil {
		if err := copyFileIfMissing(avatarSrc, avatarDst); err != nil {
			return fmt.Errorf("copy starter avatar.svg: %w", err)
		}
	}

	accSrcDir := filepath.Join(installDir, "accessories")
	entries, err := os.ReadDir(accSrcDir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".svg") {
				continue
			}
			src := filepath.Join(accSrcDir, entry.Name())
			dst := filepath.Join(accDstDir, entry.Name())
			if err := copyFileIfMissing(src, dst); err != nil {
				return fmt.Errorf("copy starter accessory %s: %w", entry.Name(), err)
			}
		}
	}
	return nil
}

func copyFileIfMissing(srcPath, dstPath string) error {
	if _, err := os.Stat(dstPath); err == nil {
		// Preserve existing user files in Documents\SVGTuber
		return nil
	}
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()

	if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
		return err
	}
	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return err
	}
	return dst.Close()
}

func markManifestAddedToPath(installDir string) {
	manifest, err := installer.LoadManifest(installDir)
	if err != nil || manifest == nil {
		return
	}
	manifest.AddedToUserPath = true
	if data, err := json.MarshalIndent(manifest, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(installDir, installer.ManifestFileName), data, 0644)
	}
}
