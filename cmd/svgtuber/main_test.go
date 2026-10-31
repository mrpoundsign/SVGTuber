package main

import (
	"slices"
	"testing"
)

func TestDefaultAvatarCandidatesAndVersion(t *testing.T) {
	candidates := defaultAvatarCandidates()
	if !slices.Contains(candidates, "testdata/test_avatar.svg") {
		t.Errorf("expected defaultAvatarCandidates() to contain testdata/test_avatar.svg, got %v", candidates)
	}

	origVer := version
	t.Cleanup(func() { version = origVer })

	version = "dev"
	if got := currentNormalizedVersion(); got != "0.0.7" {
		t.Errorf("currentNormalizedVersion() for dev = %q, want 0.0.7", got)
	}

	version = "v0.0.9"
	if got := currentNormalizedVersion(); got != "0.0.9" {
		t.Errorf("currentNormalizedVersion() for v0.0.9 = %q, want 0.0.9", got)
	}
}
