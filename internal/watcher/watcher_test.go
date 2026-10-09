package watcher

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestAvatarWatcher_Debounce(t *testing.T) {
	tempDir := t.TempDir()
	avatarFile := filepath.Join(tempDir, "test_avatar.svg")

	initialContent := []byte(`<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>`)
	if err := os.WriteFile(avatarFile, initialContent, 0644); err != nil {
		t.Fatalf("Failed to write initial avatar file: %v", err)
	}

	var triggerCount int32
	triggeredCh := make(chan struct{}, 10)

	aw, err := New(avatarFile, 50*time.Millisecond, func() {
		atomic.AddInt32(&triggerCount, 1)
		select {
		case triggeredCh <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("New watcher failed: %v", err)
	}
	defer aw.Close()

	// Rapidly write 5 updates within 20ms (less than 50ms debounce)
	for i := 0; i < 5; i++ {
		time.Sleep(5 * time.Millisecond)
		content := []byte(`<svg width="100" height="100"><circle cx="50" cy="50" r="45"/></svg>`)
		if err := os.WriteFile(avatarFile, content, 0644); err != nil {
			t.Fatalf("Failed to update avatar file: %v", err)
		}
	}

	// Wait for debounced trigger
	select {
	case <-triggeredCh:
		// Success
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Timed out waiting for debounced watcher notification")
	}

	// Wait slightly longer to confirm no trailing second trigger
	time.Sleep(100 * time.Millisecond)
	count := atomic.LoadInt32(&triggerCount)
	if count != 1 {
		t.Errorf("Expected 1 debounced trigger, got %d", count)
	}
}
