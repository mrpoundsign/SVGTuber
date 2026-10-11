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

	"github.com/mrpoundsign/SVGTuber/internal/config"
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
	avatarFlag := flag.String("avatar", "", "Path to the Inkscape SVG avatar file (saved to config when specified)")
	port := flag.Int("port", 7420, "Port for the HTTP and WebSocket server")
	openStudio := flag.Bool("open-studio", false, "Automatically open the Studio control page in default browser")
	showVersion := flag.Bool("version", false, "Print version information and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("svgtuber %s (commit: %s, built: %s)\n", version, commit, date)
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
	// 4. Fallback to testdata/test_avatar.svg
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
			fallback := "testdata/test_avatar.svg"
			if _, err := os.Stat(fallback); err == nil {
				if abs, err := filepath.Abs(fallback); err == nil {
					avatarPath = abs
				} else {
					avatarPath = fallback
				}
				log.Printf("[Config] No avatar specified or found; using sample avatar: %s", avatarPath)
			} else {
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

	fmt.Println("====================================================")
	fmt.Printf("  SVGTuber %s - Vector VTuber Engine\n", version)
	fmt.Println("====================================================")
	fmt.Printf("  Avatar:      %s\n", avatarPath)
	fmt.Printf("  Avatar Dir:  %s\n", filepath.Dir(avatarPath))
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

	if *openStudio {
		go openBrowser(studioURL)
	}

	// Wait for termination signal
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	fmt.Println("\nShutting down SVGTuber...")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil && err != http.ErrServerClosed {
		log.Printf("Shutdown error: %v", err)
	}
	fmt.Println("SVGTuber stopped.")
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
		// Check for WSL or Linux desktop utilities
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
