package server

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/coder/websocket"
	"github.com/mrpoundsign/SVGTuber/web"
)

// Server coordinates the HTTP file server and WebSocket endpoints.
type Server struct {
	port       int
	avatarPath string
	hub        *Hub
	httpServer *http.Server
	listener   net.Listener
}

// New constructs an unstarted Server instance.
func New(port int, avatarPath string, hub *Hub) *Server {
	return &Server{
		port:       port,
		avatarPath: avatarPath,
		hub:        hub,
	}
}

// Start binds the port and starts listening for HTTP and WebSocket requests.
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Root redirects to /studio/
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/studio/", http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})

	// Sub-filesystems for embedded web assets
	overlayFS, err := fs.Sub(web.StaticFS, "overlay")
	if err != nil {
		return fmt.Errorf("loading overlay static assets: %w", err)
	}
	studioFS, err := fs.Sub(web.StaticFS, "studio")
	if err != nil {
		return fmt.Errorf("loading studio static assets: %w", err)
	}

	mux.Handle("/overlay/", http.StripPrefix("/overlay/", http.FileServer(http.FS(overlayFS))))
	mux.Handle("/studio/", http.StripPrefix("/studio/", http.FileServer(http.FS(studioFS))))

	// Direct endpoint for OBS browser source: /overlay (without trailing slash)
	mux.HandleFunc("/overlay", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/overlay/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/studio", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/studio/", http.StatusMovedPermanently)
	})

	// Avatar SVG endpoint
	mux.HandleFunc("/avatar.svg", s.handleAvatarSVG)

	// Overlay WebSocket endpoint
	mux.HandleFunc("/ws/overlay", s.handleOverlayWS)

	addr := fmt.Sprintf(":%d", s.port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	s.listener = ln

	s.httpServer = &http.Server{
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := s.httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[Server] HTTP server error: %v", err)
		}
	}()

	return nil
}

// Addr returns the listener address if started, or configured port.
func (s *Server) Addr() string {
	if s.listener != nil {
		return s.listener.Addr().String()
	}
	return fmt.Sprintf(":%d", s.port)
}

func (s *Server) handleAvatarSVG(w http.ResponseWriter, r *http.Request) {
	absPath, err := filepath.Abs(s.avatarPath)
	if err != nil {
		http.Error(w, "Invalid avatar path", http.StatusBadRequest)
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to open avatar SVG: %v", err), http.StatusNotFound)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	_, _ = io.Copy(w, f)
}

func (s *Server) handleOverlayWS(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow connections from OBS CEF browser source
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("[Server] WebSocket accept error: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	s.hub.Register(conn)
	defer s.hub.Unregister(conn)

	// Keep connection open and read messages until closed
	ctx := r.Context()
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			// Disconnect or error
			break
		}
	}
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}
