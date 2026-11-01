package main

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
)

// AppLogSink writes log output to a persistent log file (and optional secondary writer)
// while tracking a thread-safe live count of log lines and the most recent log message.
type AppLogSink struct {
	mu       sync.RWMutex
	file     *os.File
	filePath string
	count    atomic.Int64
	lastLine string
	fallback io.Writer
}

// DefaultLogPath resolves the OS-specific path for svgtuber.log inside the user config directory.
func DefaultLogPath() string {
	baseDir, err := os.UserConfigDir()
	if err != nil || baseDir == "" {
		if home, hErr := os.UserHomeDir(); hErr == nil && home != "" {
			baseDir = filepath.Join(home, ".config")
		} else {
			baseDir = os.TempDir()
		}
	}
	return filepath.Join(baseDir, "com.github", "mrpoundsign.svgtuber", "svgtuber.log")
}

// NewAppLogSink opens (or creates) the log file at logPath and returns a configured AppLogSink.
func NewAppLogSink(logPath string, alsoStdout bool) *AppLogSink {
	if logPath == "" {
		logPath = DefaultLogPath()
	}
	_ = os.MkdirAll(filepath.Dir(logPath), 0o755)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)

	var fallback io.Writer
	if alsoStdout {
		fallback = os.Stderr
	}

	sink := &AppLogSink{
		file:     f,
		filePath: logPath,
		fallback: fallback,
	}
	if err == nil {
		log.SetOutput(sink)
	} else if fallback != nil {
		log.SetOutput(sink)
	}
	return sink
}

// Write implements io.Writer, counting newline-delimited log entries and capturing the latest line.
func (s *AppLogSink) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	lines := bytes.Count(p, []byte{'\n'})
	if lines == 0 {
		lines = 1
	}
	s.count.Add(int64(lines))

	trimmed := strings.TrimSpace(string(p))
	if trimmed != "" {
		if idx := strings.LastIndexByte(trimmed, '\n'); idx >= 0 {
			trimmed = strings.TrimSpace(trimmed[idx+1:])
		}
		s.mu.Lock()
		s.lastLine = trimmed
		s.mu.Unlock()
	}

	s.mu.RLock()
	f := s.file
	fb := s.fallback
	s.mu.RUnlock()

	if f != nil {
		_, _ = f.Write(p)
	}
	if fb != nil {
		_, _ = fb.Write(p)
	}
	return len(p), nil
}

// Count returns the total number of log entries written during this session.
func (s *AppLogSink) Count() int64 {
	if s == nil {
		return 0
	}
	return s.count.Load()
}

// LastLine returns the most recent non-empty log line written during this session.
func (s *AppLogSink) LastLine() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastLine
}

// FilePath returns the path to the active log file on disk.
func (s *AppLogSink) FilePath() string {
	if s == nil {
		return ""
	}
	return s.filePath
}

// Close closes the underlying log file handle if open.
func (s *AppLogSink) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	f := s.file
	s.file = nil
	s.mu.Unlock()
	if f != nil {
		return f.Close()
	}
	return nil
}
