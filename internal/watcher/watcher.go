package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// AvatarWatcher monitors an SVG file for changes and triggers debounced callbacks.
type AvatarWatcher struct {
	filePath    string
	absPath     string
	onChange    func()
	watcher     *fsnotify.Watcher
	debounce    time.Duration
	stopCh      chan struct{}
	wg          sync.WaitGroup
	mu          sync.Mutex
	timer       *time.Timer
	lastModTime time.Time
	lastSize    int64
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

	var initialMod time.Time
	var initialSize int64
	if fi, err := os.Stat(absPath); err == nil {
		initialMod = fi.ModTime()
		initialSize = fi.Size()
	}

	aw := &AvatarWatcher{
		filePath:    filePath,
		absPath:     absPath,
		onChange:    onChange,
		watcher:     fw,
		debounce:    debounce,
		stopCh:      make(chan struct{}),
		lastModTime: initialMod,
		lastSize:    initialSize,
	}

	aw.wg.Add(1)
	go aw.loop()

	return aw, nil
}

func (aw *AvatarWatcher) loop() {
	defer aw.wg.Done()

	// 1-second polling ticker as a fallback for WSL where Windows apps modifying /mnt/c
	// do not always propagate inotify filesystem events to Linux.
	pollTicker := time.NewTicker(1 * time.Second)
	defer pollTicker.Stop()

	for {
		select {
		case <-aw.stopCh:
			return
		case <-pollTicker.C:
			aw.mu.Lock()
			currentAbs := aw.absPath
			aw.mu.Unlock()

			fi, err := os.Stat(currentAbs)
			if err == nil {
				aw.mu.Lock()
				modChanged := !fi.ModTime().Equal(aw.lastModTime)
				sizeChanged := fi.Size() != aw.lastSize
				if modChanged || sizeChanged {
					aw.lastModTime = fi.ModTime()
					aw.lastSize = fi.Size()
					aw.mu.Unlock()
					aw.triggerDebounced()
				} else {
					aw.mu.Unlock()
				}
			}
		case event, ok := <-aw.watcher.Events:
			if !ok {
				return
			}
			aw.mu.Lock()
			currentAbs := aw.absPath
			aw.mu.Unlock()

			eventClean := filepath.Clean(event.Name)
			if eventClean != currentAbs {
				continue
			}

			// Update cached stat
			if fi, err := os.Stat(currentAbs); err == nil {
				aw.mu.Lock()
				aw.lastModTime = fi.ModTime()
				aw.lastSize = fi.Size()
				aw.mu.Unlock()
			}

			// Respond to write, create, or rename events
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
				aw.triggerDebounced()
			}

			// If file was renamed or recreated, ensure watch on file itself is restored
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
				_ = aw.watcher.Add(currentAbs)
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

// SwitchFile redirects the watcher to monitor a different avatar SVG file.
func (aw *AvatarWatcher) SwitchFile(newFilePath string) error {
	absPath, err := filepath.Abs(newFilePath)
	if err != nil {
		return fmt.Errorf("resolving absolute path for %q: %w", newFilePath, err)
	}

	aw.mu.Lock()
	defer aw.mu.Unlock()

	oldDir := filepath.Dir(aw.absPath)
	newDir := filepath.Dir(absPath)
	if oldDir != newDir {
		_ = aw.watcher.Remove(oldDir)
		_ = aw.watcher.Add(newDir)
	}
	_ = aw.watcher.Remove(aw.absPath)
	_ = aw.watcher.Add(absPath)

	aw.filePath = newFilePath
	aw.absPath = absPath

	if fi, err := os.Stat(absPath); err == nil {
		aw.lastModTime = fi.ModTime()
		aw.lastSize = fi.Size()
	}

	return nil
}

func (aw *AvatarWatcher) triggerDebounced() {
	aw.mu.Lock()
	defer aw.mu.Unlock()

	if aw.timer != nil {
		aw.timer.Stop()
		aw.timer.Reset(aw.debounce)
		return
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
