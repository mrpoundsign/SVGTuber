package watcher

import (
	"fmt"
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

	var triggerCount atomic.Int32
	triggeredCh := make(chan struct{}, 10)

	debounceTime := 150 * time.Millisecond
	aw, err := New(avatarFile, debounceTime, func() {
		triggerCount.Add(1)
		select {
		case triggeredCh <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("New watcher failed: %v", err)
	}
	defer func() { _ = aw.Close() }()

	// Rapidly write 5 updates within ~10ms (well within 150ms debounce)
	for i := range 5 {
		content := []byte(fmt.Sprintf(`<svg width="100" height="100"><circle cx="50" cy="50" r="%d"/></svg>`, 41+i))
		if err := os.WriteFile(avatarFile, content, 0644); err != nil {
			t.Fatalf("Failed to update avatar file: %v", err)
		}
		time.Sleep(2 * time.Millisecond)
	}

	// Wait for debounced trigger
	select {
	case <-triggeredCh:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("Timed out waiting for debounced watcher notification")
	}

	// Wait slightly longer to confirm no trailing second trigger
	time.Sleep(200 * time.Millisecond)
	count := triggerCount.Load()
	if count != 1 {
		t.Errorf("Expected 1 debounced trigger, got %d", count)
	}
}

func TestAvatarWatcher_SwitchFile(t *testing.T) {
	tempDir := t.TempDir()
	file1 := filepath.Join(tempDir, "avatar1.svg")
	file2 := filepath.Join(tempDir, "avatar2.svg")

	_ = os.WriteFile(file1, []byte(`<svg>1</svg>`), 0644)
	_ = os.WriteFile(file2, []byte(`<svg>2</svg>`), 0644)

	triggeredCh := make(chan struct{}, 10)
	aw, err := New(file1, 50*time.Millisecond, func() {
		select {
		case triggeredCh <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("New watcher failed: %v", err)
	}
	defer func() { _ = aw.Close() }()

	// Switch to file2
	if err := aw.SwitchFile(file2); err != nil {
		t.Fatalf("SwitchFile failed: %v", err)
	}

	time.Sleep(20 * time.Millisecond)
	// Modify file2
	_ = os.WriteFile(file2, []byte(`<svg>2-updated</svg>`), 0644)

	select {
	case <-triggeredCh:
		// Success!
	case <-time.After(600 * time.Millisecond):
		t.Fatal("Timed out waiting for trigger after SwitchFile")
	}
}
