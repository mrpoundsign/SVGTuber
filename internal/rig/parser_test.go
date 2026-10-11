package rig

import (
	"os"
	"testing"
)

func TestParseDirectives(t *testing.T) {
	tests := []struct {
		name     string
		label    string
		expected []Directive
	}{
		{
			name:  "Follow directive with pivot",
			label: "Head Group [Follow {yaw: 15; pitch: 10; roll: 5; pivot: center}]",
			expected: []Directive{
				{
					Type: "Follow",
					Params: map[string]string{
						"yaw":   "15",
						"pitch": "10",
						"roll":  "5",
						"pivot": "center",
					},
				},
			},
		},
		{
			name:  "Show with conditional expression",
			label: "Closed Eyes [Show {when: blinkL > 0.45 && blinkR > 0.45}]",
			expected: []Directive{
				{
					Type: "Show",
					Params: map[string]string{
						"when": "blinkL > 0.45 && blinkR > 0.45",
					},
				},
			},
		},
		{
			name:  "Multiple directives on single element",
			label: "Mouth Group [Show {when: mouthOpen > 0.2}; Scale {y: mouthOpen; from: 0.3; to: 1.2; pivot: top}]",
			expected: []Directive{
				{
					Type: "Show",
					Params: map[string]string{
						"when": "mouthOpen > 0.2",
					},
				},
				{
					Type: "Scale",
					Params: map[string]string{
						"y":     "mouthOpen",
						"from":  "0.3",
						"to":    "1.2",
						"pivot": "top",
					},
				},
			},
		},
		{
			name:  "Physics and Sway directives",
			label: "Front Bangs [Dist {factor: 0.15}] [Sway {pivot: top; range: 8; stiffness: 0.12}] [Physics {stiffness: 0.16; damping: 0.82; mass: 0.5}]",
			expected: []Directive{
				{
					Type: "Dist",
					Params: map[string]string{
						"factor": "0.15",
					},
				},
				{
					Type: "Sway",
					Params: map[string]string{
						"pivot":     "top",
						"range":     "8",
						"stiffness": "0.12",
					},
				},
				{
					Type: "Physics",
					Params: map[string]string{
						"stiffness": "0.16",
						"damping":   "0.82",
						"mass":      "0.5",
					},
				},
			},
		},
		{
			name:     "Label with no directives",
			label:    "Plain Layer 1",
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseDirectives(tt.label)
			if len(got) != len(tt.expected) {
				t.Fatalf("Expected %d directives, got %d", len(tt.expected), len(got))
			}
			for i, exp := range tt.expected {
				if got[i].Type != exp.Type {
					t.Errorf("[%d] Expected type %s, got %s", i, exp.Type, got[i].Type)
				}
				for k, v := range exp.Params {
					if got[i].Params[k] != v {
						t.Errorf("[%d] Expected param %s=%q, got %q", i, k, v, got[i].Params[k])
					}
				}
			}
		})
	}
}

func TestParseSVG(t *testing.T) {
	svg := `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <g id="layer_head" inkscape:label="Head [Follow {yaw: 12; pitch: 8}]" transform="translate(0, 50)">
    <circle cx="50" cy="50" r="40"/>
  </g>
  <g id="eye_closed" inkscape:label="Eyes Closed [Show {when: blinkL > 0.5}]">
    <path d="M 10 20 L 30 20"/>
  </g>
  <g id="bg_layer" inkscape:label="Static Background">
    <rect width="100" height="100"/>
  </g>
</svg>`

	rigDef, err := ParseSVG([]byte(svg))
	if err != nil {
		t.Fatalf("ParseSVG returned unexpected error: %v", err)
	}

	if len(rigDef.Elements) != 2 {
		t.Fatalf("Expected 2 rigged elements, got %d", len(rigDef.Elements))
	}

	elem0 := rigDef.Elements[0]
	if elem0.ID != "layer_head" || len(elem0.Directives) != 1 || elem0.Directives[0].Type != "Follow" {
		t.Errorf("Unexpected element 0: %+v", elem0)
	}
	if elem0.Transform != "translate(0, 50)" {
		t.Errorf("Expected element 0 transform 'translate(0, 50)', got %q", elem0.Transform)
	}

	elem1 := rigDef.Elements[1]
	if elem1.ID != "eye_closed" || len(elem1.Directives) != 1 || elem1.Directives[0].Type != "Show" {
		t.Errorf("Unexpected element 1: %+v", elem1)
	}
	if elem1.Transform != "" {
		t.Errorf("Expected element 1 transform empty, got %q", elem1.Transform)
	}
}

func TestParseSVG_TestAvatarFile(t *testing.T) {
	data, err := os.ReadFile("../../testdata/test_avatar.svg")
	if err != nil {
		t.Fatalf("Failed to read test_avatar.svg: %v", err)
	}

	rigDef, err := ParseSVG(data)
	if err != nil {
		t.Fatalf("ParseSVG returned error: %v", err)
	}

	// Should have detected: layer_body, layer_head, eyes_open, pupil_left, pupil_right, eyes_closed, mouth_neutral, mouth_open, hair_front
	if len(rigDef.Elements) < 8 {
		t.Errorf("Expected at least 8 rigged elements in test_avatar.svg, got %d", len(rigDef.Elements))
	}

	foundTypes := make(map[string]bool)
	for _, el := range rigDef.Elements {
		for _, d := range el.Directives {
			foundTypes[d.Type] = true
		}
	}

	expectedTypes := []string{"Idle", "Follow", "Hide", "Show", "Move", "Scale", "Dist"}
	for _, exp := range expectedTypes {
		if !foundTypes[exp] {
			t.Errorf("Expected directive type %s to be parsed from test_avatar.svg", exp)
		}
	}
}

func TestParseSVG_VectorcraftFile(t *testing.T) {
	data, err := os.ReadFile("../../testdata/test_avatar_vectorcraft.svg")
	if err != nil {
		t.Fatalf("Failed to read test_avatar_vectorcraft.svg: %v", err)
	}

	rigDef, err := ParseSVG(data)
	if err != nil {
		t.Fatalf("ParseSVG returned error: %v", err)
	}

	if len(rigDef.Elements) < 8 {
		t.Errorf("Expected at least 8 rigged elements in test_avatar_vectorcraft.svg, got %d", len(rigDef.Elements))
	}

	foundTypes := make(map[string]bool)
	for _, el := range rigDef.Elements {
		for _, d := range el.Directives {
			foundTypes[d.Type] = true
		}
	}

	expectedTypes := []string{"Idle", "Follow", "Hide", "Show", "Move", "Scale", "Dist"}
	for _, exp := range expectedTypes {
		if !foundTypes[exp] {
			t.Errorf("Expected directive type %s to be parsed from test_avatar_vectorcraft.svg", exp)
		}
	}
}
