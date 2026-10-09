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

type client struct {
	conn *websocket.Conn
	send chan []byte
	once sync.Once
}

func (c *client) closeSend() {
	c.once.Do(func() {
		close(c.send)
	})
}

// Hub maintains the set of active overlay WebSocket connections and broadcasts messages.
type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]*client
}

// NewHub initializes a new WebSocket Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]*client),
	}
}

// Register adds a client connection to the hub and starts its dedicated write pump.
func (h *Hub) Register(conn *websocket.Conn) {
	c := &client{
		conn: conn,
		send: make(chan []byte, 16),
	}

	h.mu.Lock()
	h.clients[conn] = c
	count := len(h.clients)
	h.mu.Unlock()

	log.Printf("[Hub] Client connected. Total active overlays: %d", count)

	go func() {
		defer func() {
			h.Unregister(conn)
			_ = conn.Close(websocket.StatusGoingAway, "")
		}()

		for msg := range c.send {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		}
	}()
}

// Unregister removes a client connection from the hub.
func (h *Hub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c, ok := h.clients[conn]; ok {
		delete(h.clients, conn)
		c.closeSend()
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
	defer h.mu.RUnlock()

	for _, c := range h.clients {
		select {
		case c.send <- data:
		default:
			// Buffer full: drop frame to preserve low-latency real-time stream
		}
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
