package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestAppLogSinkCountsAndWritesToFile(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "svgtuber.log")
	sink := NewAppLogSink(logPath, false)
	t.Cleanup(func() { _ = sink.Close() })

	if sink.Count() != 0 {
		t.Fatalf("expected initial count 0, got %d", sink.Count())
	}

	_, _ = sink.Write([]byte("[Server] Loaded rig with 12 elements.\n"))
	_, _ = sink.Write([]byte("[Watcher] Avatar updated on disk.\n"))

	if sink.Count() != 2 {
		t.Errorf("expected log count 2, got %d", sink.Count())
	}
	if sink.LastLine() != "[Watcher] Avatar updated on disk." {
		t.Errorf("unexpected LastLine: %q", sink.LastLine())
	}

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	if !strings.Contains(string(data), "Loaded rig with 12 elements") {
		t.Errorf("expected log file to contain written log lines, got %q", string(data))
	}
}

func TestDefaultAvatarCandidatesAndVersion(t *testing.T) {
	candidates := defaultAvatarCandidates()
	if !slices.Contains(candidates, "testdata/test_avatar.svg") {
		t.Errorf("expected defaultAvatarCandidates() to contain testdata/test_avatar.svg, got %v", candidates)
	}

	origVer := version
	t.Cleanup(func() { version = origVer })

	version = "dev"
	if got := currentNormalizedVersion(); got != "0.0.8" {
		t.Errorf("currentNormalizedVersion() for dev = %q, want 0.0.8", got)
	}

	version = "v0.0.9"
	if got := currentNormalizedVersion(); got != "0.0.9" {
		t.Errorf("currentNormalizedVersion() for v0.0.9 = %q, want 0.0.9", got)
	}
}

func TestFormatBannerLines_StreamerModeRedactsURLsAndPaths(t *testing.T) {
	avatarPath := `C:\Users\streamer\Documents\SVGTuber\avatar.svg`
	avatarDir := `C:\Users\streamer\Documents\SVGTuber`
	studioURL := "http://localhost:7420/studio"
	overlayURL := "http://localhost:7420/overlay"
	configPath := `C:\Users\streamer\AppData\Roaming\com.github\mrpoundsign.svgtuber\settings.json`

	normal := strings.Join(formatBannerBannerLines("v0.0.7", avatarPath, avatarDir, studioURL, overlayURL, configPath, false), "\n")
	if !strings.Contains(normal, studioURL) || !strings.Contains(normal, overlayURL) || !strings.Contains(normal, avatarDir) {
		t.Errorf("expected normal banner to include URLs and paths, got:\n%s", normal)
	}

	shielded := strings.Join(formatBannerBannerLines("v0.0.7", avatarPath, avatarDir, studioURL, overlayURL, configPath, true), "\n")
	if strings.Contains(shielded, studioURL) || strings.Contains(shielded, overlayURL) || strings.Contains(shielded, avatarDir) || strings.Contains(shielded, configPath) {
		t.Errorf("expected streamerMode banner to hide all URLs and local paths, got:\n%s", shielded)
	}
	if !strings.Contains(shielded, "avatar.svg") || !strings.Contains(shielded, "[STREAMER MODE: ON") {
		t.Errorf("expected streamerMode banner to show filename and streamer mode notice, got:\n%s", shielded)
	}
}

