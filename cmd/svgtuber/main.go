package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/mrpoundsign/appinstaller/pkg/updater"
	"github.com/mrpoundsign/SVGTuber/internal/config"
	"github.com/mrpoundsign/SVGTuber/internal/mcp"
	"github.com/mrpoundsign/SVGTuber/internal/server"
	"github.com/mrpoundsign/SVGTuber/internal/tracking"
	"github.com/mrpoundsign/SVGTuber/internal/watcher"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	// Clean up any leftover .old executable from a previous portable self-update
	if selfExe := updater.ResolveTargetExecutable(""); selfExe != "" {
		_ = os.Remove(selfExe + ".old")
	}

	avatarFlag := flag.String("avatar", "", "Path to the Inkscape SVG avatar file (saved to config when specified)")
	port := flag.Int("port", 7420, "Port for the HTTP and WebSocket server")
	openStudio := flag.Bool("open-studio", false, "Automatically open the Studio control page in default browser")
	headlessFlag := flag.Bool("headless", false, "Run without the desktop control window (console mode)")
	showVersion := flag.Bool("version", false, "Print version information and exit")
	checkUpdate := flag.Bool("check-update", false, "Check GitHub Releases for a newer version and exit")
	applyUpdate := flag.Bool("update", false, "Download, verify (SHA-256), and install the latest SVGTuber update")
	mcpFlag := flag.Bool("mcp", false, "Run as Model Context Protocol (MCP) stdio server for Vectorcraft rigging and control")
	flag.Parse()

	if *showVersion {
		fmt.Printf("svgtuber %s (commit: %s, built: %s)\n", version, commit, date)
		return
	}

	if *checkUpdate || *applyUpdate {
		if err := runCLIUpdate(*applyUpdate); err != nil {
			log.Fatalf("Update failed: %v", err)
		}
		return
	}

	if *mcpFlag {
		log.SetOutput(os.Stderr)
		mcpServer := mcp.NewServer(os.Stdin, os.Stdout)
		if err := mcpServer.Run(); err != nil {
			log.Fatalf("Error running SVGTuber MCP server: %v", err)
		}
		return
	}

	cfgMgr, err := config.NewManager()
	if err != nil {
		log.Printf("[Warning] Failed to initialize config manager: %v (using defaults)", err)
	}

	// Resolve avatar path:
	// 1. Explicit -avatar flag (persisted to config)
	// 2. avatar.svg in current working directory (persisted to config)
	// 3. Previously saved avatar path in config
	// 4. Fallback to Documents\SVGTuber\avatar.svg, installed avatar.svg, or testdata/test_avatar.svg
	var avatarPath string
	if *avatarFlag != "" {
		absPath, err := filepath.Abs(*avatarFlag)
		if err != nil {
			absPath = *avatarFlag
		}
		if _, err := os.Stat(absPath); os.IsNotExist(err) {
			log.Fatalf("Specified avatar SVG file does not exist: %s", *avatarFlag)
		}
		avatarPath = absPath
		if cfgMgr != nil {
			if err := cfgMgr.SetAvatarLocation(absPath); err != nil {
				log.Printf("[Warning] Failed to save avatar path to config: %v", err)
			}
		}
	} else {
		cwdAvatar := "avatar.svg"
		if _, err := os.Stat(cwdAvatar); err == nil {
			abs, err := filepath.Abs(cwdAvatar)
			if err != nil {
				abs = cwdAvatar
			}
			avatarPath = abs
			if cfgMgr != nil {
				_ = cfgMgr.SetAvatarLocation(abs)
			}
			log.Printf("[Config] Found 'avatar.svg' in current directory; saved to config: %s", abs)
		} else if cfgMgr != nil && cfgMgr.GetActiveAvatarPath() != "" {
			saved := cfgMgr.GetActiveAvatarPath()
			if _, err := os.Stat(saved); err == nil {
				avatarPath = saved
				log.Printf("[Config] Using avatar from saved config: %s", saved)
			} else {
				log.Printf("[Config] Previously saved avatar path does not exist: %s", saved)
			}
		}

		if avatarPath == "" {
			for _, candidate := range defaultAvatarCandidates() {
				if _, err := os.Stat(candidate); err == nil {
					if abs, err := filepath.Abs(candidate); err == nil {
						avatarPath = abs
					} else {
						avatarPath = candidate
					}
					log.Printf("[Config] No avatar specified or found; using sample avatar: %s", avatarPath)
					break
				}
			}
			if avatarPath == "" {
				log.Fatalf("No avatar SVG found! Place an 'avatar.svg' in the current directory or specify with -avatar <path>.")
			}
		}
	}

	hub := server.NewHub()
	engine := tracking.NewEngine(cfgMgr)
	srv := server.New(*port, avatarPath, hub, engine, cfgMgr)
	srv.SetVersion(version, commit, date)

	if err := srv.Start(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}

	// Initialize file watcher for live reload
	fw, err := watcher.New(avatarPath, 100*time.Millisecond, func() {
		log.Printf("[Watcher] Avatar updated on disk. Broadcasting reload to overlays.")
		if _, err := srv.ReloadRig(); err != nil {
			log.Printf("[Watcher] Error reloading rig: %v", err)
		}
		hub.BroadcastReload()
	})
	if err != nil {
		log.Printf("[Warning] File watcher failed to initialize: %v (hot reload disabled)", err)
	} else {
		srv.SetWatcher(fw)
		defer func() { _ = fw.Close() }()
	}

	studioURL := fmt.Sprintf("http://localhost:%d/studio", *port)
	overlayURL := fmt.Sprintf("http://localhost:%d/overlay", *port)

	runAppUI(srv, cfgMgr, studioURL, overlayURL, *openStudio, *headlessFlag)
}

func runHeadlessLoop(srv *server.Server, cfgMgr *config.Manager, studioURL, overlayURL string, openStudio bool) {
	fmt.Println("====================================================")
	fmt.Printf("  SVGTuber %s - Vector VTuber Engine\n", version)
	fmt.Println("====================================================")
	fmt.Printf("  Avatar:      %s\n", srv.AvatarPath())
	fmt.Printf("  Avatar Dir:  %s\n", srv.AvatarDir())
	fmt.Printf("  Studio:      %s\n", studioURL)
	fmt.Printf("  OBS Overlay: %s\n", overlayURL)
	if cfgMgr != nil {
		if path, err := cfgMgr.ConfigPath(); err == nil {
			fmt.Printf("  Settings:    %s\n", path)
		}
	}
	fmt.Println("----------------------------------------------------")
	fmt.Println("  Add OBS Overlay URL as a Browser Source in OBS.")
	fmt.Println("  Press Ctrl+C to stop.")
	fmt.Println("====================================================")

	if openStudio {
		go openBrowser(studioURL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	shutdownServer(srv)
}

func shutdownServer(srv *server.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil && err != http.ErrServerClosed {
		log.Printf("Shutdown error: %v", err)
	}
}

func openBrowser(url string) {
	time.Sleep(200 * time.Millisecond)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		if _, err := exec.LookPath("wslview"); err == nil {
			cmd = exec.Command("wslview", url)
		} else if _, err := exec.LookPath("cmd.exe"); err == nil {
			cmd = exec.Command("cmd.exe", "/c", "start", "", url)
		} else {
			cmd = exec.Command("xdg-open", url)
		}
	}
	_ = cmd.Start()
}

func defaultAvatarCandidates() []string {
	var candidates []string
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates, filepath.Join(home, "Documents", "SVGTuber", "avatar.svg"))
	}
	if exe, err := os.Executable(); err == nil && exe != "" {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "avatar.svg"),
			filepath.Join(exeDir, "testdata", "test_avatar.svg"),
		)
	}
	candidates = append(candidates, "testdata/test_avatar.svg")
	return candidates
}

func currentNormalizedVersion() string {
	curVer := version
	if curVer == "" || curVer == "dev" {
		return "0.0.7"
	}
	return updater.NormalizeVersion(curVer)
}

func runCLIUpdate(apply bool) error {
	curVer := currentNormalizedVersion()
	chk := updater.NewChecker("mrpoundsign", "SVGTuber")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	rel, isNewer, err := chk.CheckLatest(ctx, curVer)
	if err != nil {
		return err
	}
	if !isNewer {
		fmt.Printf("SVGTuber is already up to date (current: %s, latest: %s).\n", curVer, rel.Version)
		return nil
	}

	fmt.Printf("Update available: %s -> %s (%s)\n", curVer, rel.Version, rel.HTMLURL)
	if !apply {
		fmt.Println("Run 'svgtuber -update' to download, verify SHA-256, and install the update.")
		return nil
	}

	exePath := updater.ResolveTargetExecutable("")
	mode := updater.DetectInstallMode(exePath)
	asset, err := updater.SelectAsset(rel, mode, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}

	destDir := filepath.Join(os.TempDir(), "svgtuber-update")
	fmt.Printf("Downloading and verifying %s (%s)...\n", asset.Name, mode)
	verifiedPath, err := chk.DownloadAndVerify(ctx, rel, asset, destDir, nil)
	if err != nil {
		return err
	}
	fmt.Printf("✓ SHA-256 verified: %s\n", verifiedPath)
	return updater.ApplyAndRestart(verifiedPath, exePath, mode, func() {
		os.Exit(0)
	})
}
