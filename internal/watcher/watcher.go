package watcher

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// AvatarWatcher monitors an SVG file for changes and triggers debounced callbacks.
type AvatarWatcher struct {
	filePath string
	absPath  string
	onChange func()
	watcher  *fsnotify.Watcher
	debounce time.Duration
	stopCh   chan struct{}
	wg       sync.WaitGroup
	mu       sync.Mutex
	timer    *time.Timer
}

// New creates and starts an AvatarWatcher for the target SVG file.
func New(filePath string, debounce time.Duration, onChange func()) (*AvatarWatcher, error) {
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return nil, fmt.Errorf("resolving absolute path for %q: %w", filePath, err)
	}

	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("creating fsnotify watcher: %w", err)
	}

	// Watch the parent directory to detect file replacements/atomic renames (e.g. from Inkscape)
	parentDir := filepath.Dir(absPath)
	if err := fw.Add(parentDir); err != nil {
		_ = fw.Close()
		return nil, fmt.Errorf("watching directory %q: %w", parentDir, err)
	}

	// Also watch the file directly if it exists
	_ = fw.Add(absPath)

	aw := &AvatarWatcher{
		filePath: filePath,
		absPath:  absPath,
		onChange: onChange,
		watcher:  fw,
		debounce: debounce,
		stopCh:   make(chan struct{}),
	}

	aw.wg.Add(1)
	go aw.loop()

	return aw, nil
}

func (aw *AvatarWatcher) loop() {
	defer aw.wg.Done()

	for {
		select {
		case <-aw.stopCh:
			return
		case event, ok := <-aw.watcher.Events:
			if !ok {
				return
			}
			eventClean := filepath.Clean(event.Name)
			if eventClean != aw.absPath {
				continue
			}

			// Respond to write, create, or rename events
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
				aw.triggerDebounced()
			}

			// If file was renamed or recreated, ensure watch on file itself is restored
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
				_ = aw.watcher.Add(aw.absPath)
			}
		case err, ok := <-aw.watcher.Errors:
			if !ok {
				return
			}
			// Log error but keep watcher loop alive
			fmt.Printf("[Watcher] File watch error: %v\n", err)
		}
	}
}

func (aw *AvatarWatcher) triggerDebounced() {
	aw.mu.Lock()
	defer aw.mu.Unlock()

	if aw.timer != nil {
		aw.timer.Stop()
	}

	aw.timer = time.AfterFunc(aw.debounce, func() {
		aw.mu.Lock()
		aw.timer = nil
		aw.mu.Unlock()

		if aw.onChange != nil {
			aw.onChange()
		}
	})
}

// Close terminates the file watcher and releases filesystem resources.
func (aw *AvatarWatcher) Close() error {
	close(aw.stopCh)
	err := aw.watcher.Close()

	aw.mu.Lock()
	if aw.timer != nil {
		aw.timer.Stop()
		aw.timer = nil
	}
	aw.mu.Unlock()

	aw.wg.Wait()
	return err
}
