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
	"runtime"
	"syscall"
	"time"

	"github.com/mrpoundsign/SVGTuber/internal/server"
	"github.com/mrpoundsign/SVGTuber/internal/watcher"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	avatarPath := flag.String("avatar", "testdata/test_avatar.svg", "Path to the Inkscape SVG avatar file")
	port := flag.Int("port", 7420, "Port for the HTTP and WebSocket server")
	openStudio := flag.Bool("open-studio", false, "Automatically open the Studio control page in default browser")
	showVersion := flag.Bool("version", false, "Print version information and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("svgtuber %s (commit: %s, built: %s)\n", version, commit, date)
		return
	}

	if _, err := os.Stat(*avatarPath); os.IsNotExist(err) {
		log.Fatalf("Avatar SVG file does not exist: %s", *avatarPath)
	}

	hub := server.NewHub()
	srv := server.New(*port, *avatarPath, hub)

	if err := srv.Start(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}

	// Initialize file watcher for live reload
	fw, err := watcher.New(*avatarPath, 100*time.Millisecond, func() {
		log.Printf("[Watcher] Avatar %s updated on disk. Broadcasting reload to overlays.", *avatarPath)
		hub.BroadcastReload()
	})
	if err != nil {
		log.Printf("[Warning] File watcher failed to initialize: %v (hot reload disabled)", err)
	} else {
		defer fw.Close()
	}

	studioURL := fmt.Sprintf("http://localhost:%d/studio", *port)
	overlayURL := fmt.Sprintf("http://localhost:%d/overlay", *port)

	fmt.Println("====================================================")
	fmt.Printf("  SVGTuber %s - Vector VTuber Engine\n", version)
	fmt.Println("====================================================")
	fmt.Printf("  Avatar:      %s\n", *avatarPath)
	fmt.Printf("  Studio:      %s\n", studioURL)
	fmt.Printf("  OBS Overlay: %s\n", overlayURL)
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
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
