package server

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Message represents an outgoing WebSocket payload.
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Hub maintains the set of active overlay WebSocket connections and broadcasts messages.
type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

// NewHub initializes a new WebSocket Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]struct{}),
	}
}

// Register adds a client connection to the hub.
func (h *Hub) Register(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[conn] = struct{}{}
	log.Printf("[Hub] Client connected. Total active overlays: %d", len(h.clients))
}

// Unregister removes a client connection from the hub.
func (h *Hub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[conn]; ok {
		delete(h.clients, conn)
		log.Printf("[Hub] Client disconnected. Total active overlays: %d", len(h.clients))
	}
}

// Broadcast sends a JSON message to all connected overlay clients.
func (h *Hub) Broadcast(msg Message) {
	h.BroadcastJSON(msg)
}

// BroadcastJSON sends any serializable value as JSON to all connected overlays.
func (h *Hub) BroadcastJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("[Hub] Error marshaling broadcast message: %v", err)
		return
	}

	h.mu.RLock()
	conns := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		conns = append(conns, conn)
	}
	h.mu.RUnlock()

	for _, conn := range conns {
		go func(c *websocket.Conn) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			err := c.Write(ctx, websocket.MessageText, data)
			if err != nil {
				h.Unregister(c)
				_ = c.Close(websocket.StatusGoingAway, "write error")
			}
		}(conn)
	}
}

// BroadcastReload notifies all overlays to re-fetch the avatar SVG.
func (h *Hub) BroadcastReload() {
	h.Broadcast(Message{Type: "reload"})
}

// BroadcastParams broadcasts a smoothed ParamFrame to all overlays.
func (h *Hub) BroadcastParams(params any) {
	h.BroadcastJSON(params)
}
