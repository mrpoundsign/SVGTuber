package server

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
)

// ExpressionManager manages active and available expressions/props for the avatar.
type ExpressionManager struct {
	mu        sync.RWMutex
	active    map[string]bool
	available []string
	timers    map[string]*time.Timer
	onUpdate  func(active map[string]bool)
}

// NewExpressionManager creates an ExpressionManager with an optional broadcast callback.
func NewExpressionManager(onUpdate ...func(map[string]bool)) *ExpressionManager {
	var cb func(map[string]bool)
	if len(onUpdate) > 0 {
		cb = onUpdate[0]
	}
	return &ExpressionManager{
		active:    make(map[string]bool),
		available: make([]string, 0),
		timers:    make(map[string]*time.Timer),
		onUpdate:  cb,
	}
}

// SetOnUpdate sets the callback invoked whenever active expressions change.
func (em *ExpressionManager) SetOnUpdate(cb func(map[string]bool)) {
	em.mu.Lock()
	defer em.mu.Unlock()
	em.onUpdate = cb
}

// GetActive returns a copy of the current active expressions map.
func (em *ExpressionManager) GetActive() map[string]bool {
	em.mu.RLock()
	defer em.mu.RUnlock()

	out := make(map[string]bool, len(em.active))
	for k, v := range em.active {
		out[k] = v
	}
	return out
}

// GetAvailable returns the list of expressions available in the active avatar.
func (em *ExpressionManager) GetAvailable() []string {
	em.mu.RLock()
	defer em.mu.RUnlock()

	out := make([]string, len(em.available))
	copy(out, em.available)
	return out
}

// SetAvailable sets the list of available expressions.
func (em *ExpressionManager) SetAvailable(names []string) {
	em.mu.Lock()
	em.available = names
	em.mu.Unlock()
}

// Toggle flips the active state of an expression.
func (em *ExpressionManager) Toggle(name string) (bool, map[string]bool) {
	em.mu.Lock()
	clean := normalizeExpressionName(name)
	if clean == "" {
		em.mu.Unlock()
		return false, em.GetActive()
	}

	// Cancel any active auto-expiry timer
	if t, ok := em.timers[clean]; ok {
		t.Stop()
		delete(em.timers, clean)
	}

	newState := !em.active[clean]
	if newState {
		em.active[clean] = true
	} else {
		delete(em.active, clean)
	}

	activeCopy := em.snapshotActiveLocked()
	cb := em.onUpdate
	em.mu.Unlock()

	if cb != nil {
		cb(activeCopy)
	}
	return newState, activeCopy
}

// Set explicitly sets the active state of an expression.
func (em *ExpressionManager) Set(name string, state bool) map[string]bool {
	em.mu.Lock()
	clean := normalizeExpressionName(name)
	if clean == "" {
		em.mu.Unlock()
		return em.GetActive()
	}

	if t, ok := em.timers[clean]; ok {
		t.Stop()
		delete(em.timers, clean)
	}

	if state {
		em.active[clean] = true
	} else {
		delete(em.active, clean)
	}

	activeCopy := em.snapshotActiveLocked()
	cb := em.onUpdate
	em.mu.Unlock()

	if cb != nil {
		cb(activeCopy)
	}
	return activeCopy
}

// Trigger activates an expression for a specific duration, automatically turning it off.
func (em *ExpressionManager) Trigger(name string, duration time.Duration) map[string]bool {
	em.mu.Lock()
	clean := normalizeExpressionName(name)
	if clean == "" {
		em.mu.Unlock()
		return em.GetActive()
	}

	if t, ok := em.timers[clean]; ok {
		t.Stop()
		delete(em.timers, clean)
	}

	em.active[clean] = true
	activeCopy := em.snapshotActiveLocked()
	cb := em.onUpdate

	if duration > 0 {
		em.timers[clean] = time.AfterFunc(duration, func() {
			em.mu.Lock()
			delete(em.active, clean)
			delete(em.timers, clean)
			expiredCopy := em.snapshotActiveLocked()
			cbExpired := em.onUpdate
			em.mu.Unlock()

			if cbExpired != nil {
				cbExpired(expiredCopy)
			}
		})
	}
	em.mu.Unlock()

	if cb != nil {
		cb(activeCopy)
	}
	return activeCopy
}

// Reset clears all active expressions and stops running timers.
func (em *ExpressionManager) Reset() map[string]bool {
	em.mu.Lock()
	for _, t := range em.timers {
		t.Stop()
	}
	em.timers = make(map[string]*time.Timer)
	em.active = make(map[string]bool)
	activeCopy := em.snapshotActiveLocked()
	cb := em.onUpdate
	em.mu.Unlock()

	if cb != nil {
		cb(activeCopy)
	}
	return activeCopy
}

func (em *ExpressionManager) snapshotActiveLocked() map[string]bool {
	out := make(map[string]bool, len(em.active))
	for k, v := range em.active {
		out[k] = v
	}
	return out
}

var (
	isTokenRegex    = regexp.MustCompile(`\b(is[A-Z][a-zA-Z0-9_]*)\b`)
	builtInIsTokens = map[string]bool{
		"isblinkl":    true,
		"isblinkr":    true,
		"ismouthopen": true,
		"issmiling":   true,
		"isspeaking":  true,
	}
)

// ExtractExpressionsFromRig scans a RigDefinition for custom expression tokens in Show/Hide directives
// or explicit Expression directives.
func ExtractExpressionsFromRig(rigDef *rig.RigDefinition) []string {
	if rigDef == nil {
		return nil
	}

	seen := make(map[string]bool)
	var result []string

	for _, elem := range rigDef.Elements {
		for _, d := range elem.Directives {
			dType := strings.ToLower(d.Type)

			// 1. Explicit Expression directive: e.g. Expression {name: blush}
			if dType == "expression" {
				if name, ok := d.Params["name"]; ok && name != "" {
					clean := normalizeExpressionName(name)
					if clean != "" && !seen[clean] {
						seen[clean] = true
						result = append(result, clean)
					}
				}
			}

			// 2. Scan directive params (e.g. Show/Hide {when: isBlush}, Fade {param: isBlush}, etc.)
			if d.Params != nil {
				for _, key := range []string{"when", "param", "target", "source"} {
					val := d.Params[key]
					if val == "" {
						continue
					}
					matches := isTokenRegex.FindAllString(val, -1)
					for _, m := range matches {
						lower := strings.ToLower(m)
						if builtInIsTokens[lower] {
							continue
						}
						// Strip "is" prefix: "isBlush" -> "blush"
						cleanName := strings.TrimPrefix(m, "is")
						cleanName = strings.TrimPrefix(cleanName, "Is")
						cleanName = normalizeExpressionName(cleanName)
						if cleanName != "" && !seen[cleanName] {
							seen[cleanName] = true
							result = append(result, cleanName)
						}
					}
				}
			}
		}
	}

	return result
}

func normalizeExpressionName(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ToLower(s)
	return s
}
