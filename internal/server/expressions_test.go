package server

import (
	"os"
	"testing"
	"time"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
)

func TestExpressionManager_ToggleAndSet(t *testing.T) {
	var lastUpdate map[string]bool
	em := NewExpressionManager(func(active map[string]bool) {
		lastUpdate = active
	})

	// Initial
	if len(em.GetActive()) != 0 {
		t.Fatalf("Expected empty active map initially")
	}

	// Toggle blush on
	newState, active := em.Toggle("Blush")
	if !newState || !active["blush"] {
		t.Errorf("Expected blush to be active after toggle, got %v", newState)
	}
	if !lastUpdate["blush"] {
		t.Errorf("Expected onUpdate callback to receive blush=true")
	}

	// Toggle blush off
	newState, active = em.Toggle("blush")
	if newState || active["blush"] {
		t.Errorf("Expected blush to be inactive after second toggle")
	}

	// Explicit Set
	em.Set("tears", true)
	if !em.GetActive()["tears"] {
		t.Errorf("Expected tears to be set to true")
	}

	em.Set("tears", false)
	if em.GetActive()["tears"] {
		t.Errorf("Expected tears to be set to false")
	}
}

func TestExpressionManager_TriggerDuration(t *testing.T) {
	em := NewExpressionManager()

	// Trigger angry for 50ms
	em.Trigger("angry", 50*time.Millisecond)
	if !em.GetActive()["angry"] {
		t.Fatalf("Expected angry to be active immediately after Trigger")
	}

	// Wait for expiry
	time.Sleep(75 * time.Millisecond)
	if em.GetActive()["angry"] {
		t.Errorf("Expected angry to be inactive after duration expired")
	}
}

func TestExpressionManager_Reset(t *testing.T) {
	em := NewExpressionManager()
	em.Set("blush", true)
	em.Set("sunglasses", true)

	if len(em.GetActive()) != 2 {
		t.Fatalf("Expected 2 active expressions")
	}

	em.Reset()
	if len(em.GetActive()) != 0 {
		t.Errorf("Expected 0 active expressions after Reset, got %v", em.GetActive())
	}
}

func TestExtractExpressionsFromRig(t *testing.T) {
	rigDef := &rig.RigDefinition{
		Version: "1.0",
		Elements: []rig.RigElement{
			{
				ID: "head",
				Directives: []rig.Directive{
					{Type: "Follow", Params: map[string]string{"yaw": "10"}},
				},
			},
			{
				ID: "eyes_open",
				Directives: []rig.Directive{
					{Type: "Hide", Params: map[string]string{"when": "isBlinkL || isBlinkR"}},
				},
			},
			{
				ID: "mouth_open",
				Directives: []rig.Directive{
					{Type: "Show", Params: map[string]string{"when": "isMouthOpen || isSmiling"}},
				},
			},
			{
				ID: "blush_layer",
				Directives: []rig.Directive{
					{Type: "Show", Params: map[string]string{"when": "isBlush"}},
				},
			},
			{
				ID: "crying_tears",
				Directives: []rig.Directive{
					{Type: "Show", Params: map[string]string{"when": "isTears && !isAngry"}},
				},
			},
			{
				ID: "shades",
				Directives: []rig.Directive{
					{Type: "Expression", Params: map[string]string{"name": "sunglasses"}},
				},
			},
		},
	}

	discovered := ExtractExpressionsFromRig(rigDef)

	expected := map[string]bool{
		"blush":      true,
		"tears":      true,
		"angry":      true,
		"sunglasses": true,
	}

	if len(discovered) != len(expected) {
		t.Fatalf("Expected %d expressions, got %d: %v", len(expected), len(discovered), discovered)
	}

	for _, name := range discovered {
		if !expected[name] {
			t.Errorf("Unexpected discovered expression: %s", name)
		}
	}
}

func TestExtractExpressionsFromRig_TestAvatar(t *testing.T) {
	data, err := os.ReadFile("../../testdata/test_avatar.svg")
	if err != nil {
		t.Fatalf("Failed to read test_avatar.svg: %v", err)
	}
	rigDef, err := rig.ParseSVG(data)
	if err != nil {
		t.Fatalf("Failed to parse test_avatar.svg: %v", err)
	}

	discovered := ExtractExpressionsFromRig(rigDef)
	expected := map[string]bool{
		"blush": true,
	}

	if len(discovered) != len(expected) {
		t.Fatalf("Expected %d expressions, got %d: %v", len(expected), len(discovered), discovered)
	}
	for _, name := range discovered {
		if !expected[name] {
			t.Errorf("Unexpected expression in test avatar: %s", name)
		}
	}
}

func TestExtractExpressionsFromRig_Vectorcraft(t *testing.T) {
	data, err := os.ReadFile("../../testdata/test_avatar_vectorcraft.svg")
	if err != nil {
		t.Fatalf("Failed to read test_avatar_vectorcraft.svg: %v", err)
	}
	rigDef, err := rig.ParseSVG(data)
	if err != nil {
		t.Fatalf("Failed to parse test_avatar_vectorcraft.svg: %v", err)
	}

	discovered := ExtractExpressionsFromRig(rigDef)
	expected := map[string]bool{
		"blush": true,
	}

	if len(discovered) != len(expected) {
		t.Fatalf("Expected %d expressions, got %d: %v", len(expected), len(discovered), discovered)
	}
	for _, name := range discovered {
		if !expected[name] {
			t.Errorf("Unexpected expression in vectorcraft test avatar: %s", name)
		}
	}
}

func TestExtractExpressionsFromRig_SweatAccessory(t *testing.T) {
	data, err := os.ReadFile("../../testdata/accessories/sweat_drop.svg")
	if err != nil {
		t.Fatalf("Failed to read sweat_drop.svg: %v", err)
	}
	rigDef, err := rig.ParseSVG(data)
	if err != nil {
		t.Fatalf("Failed to parse sweat_drop.svg: %v", err)
	}

	discovered := ExtractExpressionsFromRig(rigDef)
	if len(discovered) != 1 || discovered[0] != "sweat" {
		t.Fatalf("Expected [sweat] expression in sweat accessory, got %v", discovered)
	}
}


