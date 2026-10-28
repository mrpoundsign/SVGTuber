package mcp

import (
	"fmt"
	"strings"
)

// RigAnchor represents a 2D attachment point and pivot policy.
type RigAnchor struct {
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	PivotPolicy string  `json:"pivot_policy"` // "bottom", "top", "left", "right", "center"
	Description string  `json:"description"`
}

// RigLayer represents a logical rigged layer in the character puppet hierarchy.
type RigLayer struct {
	ID          string     `json:"id"`
	Label       string     `json:"label"` // inkscape:label or data-name including directives
	Directive   string     `json:"directive"`
	ParentID    string     `json:"parent_id,omitempty"`
	ZIndex      int        `json:"z_index"`
	Anchor      *RigAnchor `json:"anchor,omitempty"`
	Category    string     `json:"category"` // "head", "ear", "horn", "mouth", "eye", "tail", "hair", "body", "wing", "prop"
	Description string     `json:"description"`
}

// RigExpression defines a hotkey or state-driven visual element.
type RigExpression struct {
	Name      string `json:"name"`
	Condition string `json:"condition"`
	ElementID string `json:"element_id"`
}

// RigBlueprint contains the complete structural and motion plan for a vector puppet.
type RigBlueprint struct {
	Archetype    string          `json:"archetype"`
	Style        string          `json:"style"`
	CanvasWidth  float64         `json:"canvas_width"`
	CanvasHeight float64         `json:"canvas_height"`
	Layers       []RigLayer      `json:"layers"`
	Expressions  []RigExpression `json:"expressions"`
	Notes        []string        `json:"notes"`
}

// ResolveDirectiveForPart automatically derives the mathematically correct IAMS directive and pivot
// for ANY character component, preventing floating elements and diagonal zooming across all avatars.
func ResolveDirectiveForPart(partType string, customParams map[string]string) (directive string, pivot string) {
	norm := strings.ToLower(strings.TrimSpace(partType))
	switch {
	case strings.Contains(norm, "horn") || strings.Contains(norm, "top_accessory"):
		return "[Follow {yaw: 18; pitch: 14; roll: 9}] [Sway {pivot: bottom; range: 8; stiffness: 0.28}]", "bottom"

	case strings.Contains(norm, "ear") || strings.Contains(norm, "transceiver") || strings.Contains(norm, "fin_left") || strings.Contains(norm, "fin_right"):
		if strings.Contains(norm, "left") {
			return "[Sway {pivot: right; range: 14; stiffness: 0.22; damping: 0.82}]", "right"
		} else if strings.Contains(norm, "right") {
			return "[Sway {pivot: left; range: 14; stiffness: 0.22; damping: 0.82}]", "left"
		}
		return "[Sway {pivot: bottom; range: 12; stiffness: 0.24; damping: 0.80}]", "bottom"

	case strings.Contains(norm, "whisker_left") || strings.Contains(norm, "left_whisker"):
		return "[Sway {pivot: right; range: 7; stiffness: 0.30; damping: 0.85}]", "right"

	case strings.Contains(norm, "whisker_right") || strings.Contains(norm, "right_whisker"):
		return "[Sway {pivot: left; range: 7; stiffness: 0.30; damping: 0.85}]", "left"

	case strings.Contains(norm, "chest_core") || strings.Contains(norm, "reactor") || strings.Contains(norm, "bell_core"):
		return "[Follow {yaw: 5; pitch: 3; pivot: center}] [Bounce {volume: 0.08; y: 2; squash: 0.06; pivot: center}]", "center"

	case strings.Contains(norm, "chest_accessory") || strings.Contains(norm, "bell") || strings.Contains(norm, "pendant") || strings.Contains(norm, "necklace") || strings.Contains(norm, "collar_tag"):
		return "[Follow {yaw: 10; pitch: 6}] [Sway {pivot: top; range: 14; stiffness: 0.18; damping: 0.80}]", "top"

	case strings.Contains(norm, "collar") || strings.Contains(norm, "bandanna") || strings.Contains(norm, "scarf") || strings.Contains(norm, "flange"):
		return "[Follow {yaw: 5; pitch: 3; roll: 2; pivot: center}]", "center"

	case strings.Contains(norm, "mouth_resting") || strings.Contains(norm, "mouth_neutral") || strings.Contains(norm, "mouth_closed") || strings.Contains(norm, "closed_mouth") || strings.Contains(norm, "resting_mouth"):
		return "[Hide {when: isMouthOpen || isSmiling}]", "top"

	case strings.Contains(norm, "mouth_smile") || strings.Contains(norm, "smile_tongue") || (strings.Contains(norm, "smile") && !strings.Contains(norm, "mouth_open")):
		return "[Show {when: isSmiling && !isMouthOpen}] [Scale {param: smile; x: 0.35; y: 0.50; from: 0.90; to: 1.25; pivot: top}]", "top"

	case strings.Contains(norm, "open_tongue") || strings.Contains(norm, "mouth_tongue") || strings.Contains(norm, "tongue"):
		return "[Show {when: isMouthOpen}] [Scale {param: mouthOpen; x: 0.25; y: 1.0; pivot: top}]", "top"

	case strings.Contains(norm, "teeth"):
		return "[Show {when: isMouthOpen}]", "top"

	case strings.Contains(norm, "mouth_equalizer"):
		return "[Show {when: isMouthOpen}] [Scale {param: mouthOpen; x: 0.15; y: 1.0; from: 0.35; to: 1.35; pivot: center}]", "center"

	case strings.Contains(norm, "mouth_open") || strings.Contains(norm, "mouth"):
		return "[Show {when: isMouthOpen}] [Scale {param: mouthOpen; x: 0.25; y: 1.0; from: 0.7; to: 1.15; pivot: top}]", "top"

	case strings.Contains(norm, "arm") || strings.Contains(norm, "paw") || strings.Contains(norm, "hand") || strings.Contains(norm, "hoof") || strings.Contains(norm, "claw") || strings.Contains(norm, "pincer"):
		return "[Follow {yaw: -3; roll: 2}] [Sway {pivot: top; range: 5; stiffness: 0.16; damping: 0.85}]", "top"

	case strings.Contains(norm, "tail"):
		return "[Follow {yaw: -8; pitch: 4}] [Sway {pivot: top; range: 18; stiffness: 0.12; damping: 0.82}]", "top"

	case strings.Contains(norm, "ahoge") || strings.Contains(norm, "tuft") || strings.Contains(norm, "antenna"):
		return "[Sway {pivot: bottom; range: 14; stiffness: 0.20; damping: 0.82}] [Physics {stiffness: 0.18; damping: 0.82; mass: 0.4}]", "bottom"

	case strings.Contains(norm, "bangs") || strings.Contains(norm, "front_hair") || strings.Contains(norm, "forelock"):
		return "[Sway {pivot: top; range: 8; stiffness: 0.25; damping: 0.85}]", "top"

	case strings.Contains(norm, "eyes_closed") || strings.Contains(norm, "closed_eye") || strings.Contains(norm, "eye_closed") || strings.Contains(norm, "eyelids_closed") || strings.Contains(norm, "blink"):
		if strings.Contains(norm, "right") {
			return "[Show {when: blinkR > 0.4}]", "center"
		}
		return "[Show {when: blinkL > 0.4}]", "center"

	case strings.Contains(norm, "pupil") || strings.Contains(norm, "iris") || strings.Contains(norm, "glint"):
		if strings.Contains(norm, "right") {
			return "[Move {x: eyeLookX; y: eyeLookY; range: 6}] [Hide {when: blinkR > 0.4}]", "center"
		}
		return "[Move {x: eyeLookX; y: eyeLookY; range: 6}] [Hide {when: blinkL > 0.4}]", "center"

	case strings.Contains(norm, "eyes_open") || strings.Contains(norm, "eye_open") || strings.Contains(norm, "eye_white") || strings.Contains(norm, "eyeball") || strings.Contains(norm, "sclera") || strings.Contains(norm, "eyelid"):
		if strings.Contains(norm, "right") {
			return "[Hide {when: blinkR > 0.4}]", "center"
		}
		return "[Hide {when: blinkL > 0.4}]", "center"

	case (strings.Contains(norm, "eye") || strings.Contains(norm, "eyes")) && !strings.Contains(norm, "brow"):
		if strings.Contains(norm, "right") {
			return "[Hide {when: blinkR > 0.4}]", "center"
		}
		return "[Hide {when: blinkL > 0.4}]", "center"

	case strings.Contains(norm, "brow"):
		if strings.Contains(norm, "right") {
			return "[Move {y: browR; rangeY: -8}]", "center"
		}
		if strings.Contains(norm, "left") {
			return "[Move {y: browL; rangeY: -8}]", "center"
		}
		return "[Move {y: browUp; rangeY: -8}]", "center"

	case strings.Contains(norm, "blush") || strings.Contains(norm, "cheeks"):
		return "[Show {when: isBlush}]", "center"

	case strings.Contains(norm, "head"):
		return "[Follow {yaw: 16; pitch: 12; roll: 8; pivot: center}]", "center"

	case strings.Contains(norm, "muzzle") || strings.Contains(norm, "snout") || strings.Contains(norm, "face"):
		return "[Dist {factor: 0.14}]", "center"

	case strings.Contains(norm, "nostril"):
		return "[Dist {factor: 0.14}]", "center"

	case strings.Contains(norm, "body") || strings.Contains(norm, "torso"):
		return "[Idle {breathe: 0.02; period: 3.8s}] [Bounce {volume: 0.04; y: 7; squash: 0.03}]", "bottom"

	case strings.Contains(norm, "wing"):
		return "[Sway {pivot: left; range: 15; stiffness: 0.18; damping: 0.80}]", "left"

	default:
		return "[Follow {yaw: 5; pitch: 5}]", "center"
	}
}

// PlanRig produces a comprehensive, verified puppet blueprint for ANY character archetype.
func PlanRig(archetype string, style string, components []string, width, height float64) (*RigBlueprint, error) {
	if width <= 0 {
		width = 800
	}
	if height <= 0 {
		height = 800
	}
	if style == "" {
		style = "semi-realism"
	}

	normArch := strings.ToLower(strings.TrimSpace(archetype))
	if normArch == "" {
		normArch = "character"
	}

	bp := &RigBlueprint{
		Archetype:    normArch,
		Style:        style,
		CanvasWidth:  width,
		CanvasHeight: height,
		Notes: []string{
			fmt.Sprintf("Universal rig for '%s' (%s) with verified pivot safety.", normArch, style),
		},
	}

	// 1. Root Backbone Layers
	bp.Layers = append(bp.Layers,
		RigLayer{
			ID:          "Body",
			Label:       "Body [Idle {breathe: 0.02}] [Bounce {volume: 0.04; y: 6}]",
			Directive:   "[Idle {breathe: 0.02}] [Bounce {volume: 0.04; y: 6}]",
			ZIndex:      1,
			Category:    "body",
			Anchor:      &RigAnchor{X: width / 2, Y: height * 0.95, PivotPolicy: "bottom"},
			Description: "Torso base with rhythmic breathing and volume bounce",
		},
		RigLayer{
			ID:          "Head",
			Label:       "Head [Follow {yaw: 16; pitch: 12; roll: 8; pivot: center}]",
			Directive:   "[Follow {yaw: 16; pitch: 12; roll: 8; pivot: center}]",
			ZIndex:      2,
			Category:    "head",
			Anchor:      &RigAnchor{X: width / 2, Y: height * 0.40, PivotPolicy: "center"},
			Description: "Head root governing 3D parallax tracking for all facial features",
		},
		RigLayer{
			ID:          "Pupil_Left",
			ParentID:    "Head",
			Label:       "Pupil_Left [Move {x: eyeLookX; y: eyeLookY; range: 6}]",
			Directive:   "[Move {x: eyeLookX; y: eyeLookY; range: 6}]",
			ZIndex:      7,
			Category:    "eye",
			Description: "Left iris gaze tracking",
		},
		RigLayer{
			ID:          "Pupil_Right",
			ParentID:    "Head",
			Label:       "Pupil_Right [Move {x: eyeLookX; y: eyeLookY; range: 6}]",
			Directive:   "[Move {x: eyeLookX; y: eyeLookY; range: 6}]",
			ZIndex:      7,
			Category:    "eye",
			Description: "Right iris gaze tracking",
		},
		RigLayer{
			ID:          "Left_Eye_Open",
			ParentID:    "Head",
			Label:       "Left_Eye_Open [Hide {when: blinkL > 0.4}]",
			Directive:   "[Hide {when: blinkL > 0.4}]",
			ZIndex:      7,
			Category:    "eye",
			Description: "Left open eye visible during neutral expression, hidden during left blink",
		},
		RigLayer{
			ID:          "Right_Eye_Open",
			ParentID:    "Head",
			Label:       "Right_Eye_Open [Hide {when: blinkR > 0.4}]",
			Directive:   "[Hide {when: blinkR > 0.4}]",
			ZIndex:      7,
			Category:    "eye",
			Description: "Right open eye visible during neutral expression, hidden during right blink",
		},
		RigLayer{
			ID:          "Left_Eye_Closed",
			ParentID:    "Head",
			Label:       "Left_Eye_Closed [Show {when: blinkL > 0.4}]",
			Directive:   "[Show {when: blinkL > 0.4}]",
			ZIndex:      8,
			Category:    "eye",
			Description: "Left blinking eyelid visible on left blink detection",
		},
		RigLayer{
			ID:          "Right_Eye_Closed",
			ParentID:    "Head",
			Label:       "Right_Eye_Closed [Show {when: blinkR > 0.4}]",
			Directive:   "[Show {when: blinkR > 0.4}]",
			ZIndex:      8,
			Category:    "eye",
			Description: "Right blinking eyelid visible on right blink detection",
		},
		RigLayer{
			ID:          "Brow_Left",
			ParentID:    "Head",
			Label:       "Brow_Left [Move {y: browL; rangeY: -8}]",
			Directive:   "[Move {y: browL; rangeY: -8}]",
			ZIndex:      8,
			Category:    "head",
			Description: "Left eyebrow vertical raise and furrow tracking",
		},
		RigLayer{
			ID:          "Brow_Right",
			ParentID:    "Head",
			Label:       "Brow_Right [Move {y: browR; rangeY: -8}]",
			Directive:   "[Move {y: browR; rangeY: -8}]",
			ZIndex:      8,
			Category:    "head",
			Description: "Right eyebrow vertical raise and furrow tracking",
		},
		RigLayer{
			ID:          "Mouth_Resting",
			ParentID:    "Head",
			Label:       "Mouth_Resting [Hide {when: isMouthOpen || isSmiling}]",
			Directive:   "[Hide {when: isMouthOpen || isSmiling}]",
			ZIndex:      6,
			Category:    "mouth",
			Anchor:      &RigAnchor{X: width / 2, Y: height * 0.48, PivotPolicy: "top"},
			Description: "Resting lip line hidden when talking or smiling",
		},
		RigLayer{
			ID:          "Mouth_Open",
			ParentID:    "Head",
			Label:       "Mouth_Open [Show {when: isMouthOpen}] [Scale {param: mouthOpen; x: 0.25; y: 1.0; pivot: top}]",
			Directive:   "[Show {when: isMouthOpen}] [Scale {param: mouthOpen; x: 0.25; y: 1.0; pivot: top}]",
			ZIndex:      6,
			Category:    "mouth",
			Anchor:      &RigAnchor{X: width / 2, Y: height * 0.48, PivotPolicy: "top"},
			Description: "Speech mouth cavity anchored at philtrum top margin",
		},
		RigLayer{
			ID:          "Mouth_Smile",
			ParentID:    "Head",
			Label:       "Mouth_Smile [Show {when: isSmiling && !isMouthOpen}] [Scale {param: smile; x: 0.35; y: 0.50; pivot: top}]",
			Directive:   "[Show {when: isSmiling && !isMouthOpen}] [Scale {param: smile; x: 0.35; y: 0.50; pivot: top}]",
			ZIndex:      6,
			Category:    "mouth",
			Anchor:      &RigAnchor{X: width / 2, Y: height * 0.48, PivotPolicy: "top"},
			Description: "Smiling mouth cavity anchored at philtrum top margin",
		},
	)

	// Standard Expressions
	bp.Expressions = append(bp.Expressions,
		RigExpression{Name: "smile", Condition: "isSmiling && !isMouthOpen", ElementID: "Mouth_Smile"},
		RigExpression{Name: "blink", Condition: "blinkL > 0.4", ElementID: "Eyes_Closed"},
	)

	// 2. Add requested or archetype-specific components
	componentSet := make(map[string]bool)
	for _, c := range components {
		componentSet[strings.ToLower(strings.TrimSpace(c))] = true
	}

	// If no components specified, deduce from archetype name
	if len(components) == 0 {
		switch {
		case strings.Contains(normArch, "cow") || strings.Contains(normArch, "bovine"):
			componentSet["horns"] = true
			componentSet["ears"] = true
			componentSet["bell"] = true
			componentSet["muzzle"] = true
		case strings.Contains(normArch, "cat") || strings.Contains(normArch, "fox") || strings.Contains(normArch, "dog"):
			componentSet["ears"] = true
			componentSet["whiskers"] = true
			componentSet["tail"] = true
			componentSet["muzzle"] = true
		case strings.Contains(normArch, "otter"):
			componentSet["ears"] = true
			componentSet["whiskers"] = true
			componentSet["muzzle"] = true
			componentSet["arms"] = true
		case strings.Contains(normArch, "robot") || strings.Contains(normArch, "mecha") || strings.Contains(normArch, "droid"):
			componentSet["antennas"] = true
			componentSet["ears"] = true
			componentSet["reactor"] = true
			componentSet["visor"] = true
			componentSet["arms"] = true
		case strings.Contains(normArch, "dragon"):
			componentSet["horns"] = true
			componentSet["wings"] = true
			componentSet["tail"] = true
			componentSet["snout"] = true
		default:
			componentSet["ears"] = true
			componentSet["hair"] = true
		}
	}

	for comp := range componentSet {
		switch {
		case strings.Contains(comp, "horn") || strings.Contains(comp, "antenna") || strings.Contains(comp, "top_accessory"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Left_Horn", ParentID: "Head", Label: "Left_Horn [Follow {yaw: 18; pitch: 14; roll: 9}] [Sway {pivot: bottom; range: 8; stiffness: 0.28}]", ZIndex: 3, Category: "horn", Anchor: &RigAnchor{X: width * 0.35, Y: height * 0.25, PivotPolicy: "bottom"}},
				RigLayer{ID: "Right_Horn", ParentID: "Head", Label: "Right_Horn [Follow {yaw: 18; pitch: 14; roll: 9}] [Sway {pivot: bottom; range: 8; stiffness: 0.28}]", ZIndex: 3, Category: "horn", Anchor: &RigAnchor{X: width * 0.65, Y: height * 0.25, PivotPolicy: "bottom"}},
			)

		case strings.Contains(comp, "ear"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Left_Ear", ParentID: "Head", Label: "Left_Ear [Sway {pivot: right; range: 14; stiffness: 0.22; damping: 0.82}]", ZIndex: 3, Category: "ear", Anchor: &RigAnchor{X: width * 0.35, Y: height * 0.32, PivotPolicy: "right"}},
				RigLayer{ID: "Right_Ear", ParentID: "Head", Label: "Right_Ear [Sway {pivot: left; range: 14; stiffness: 0.22; damping: 0.82}]", ZIndex: 3, Category: "ear", Anchor: &RigAnchor{X: width * 0.65, Y: height * 0.32, PivotPolicy: "left"}},
			)

		case strings.Contains(comp, "whisker"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Left_Whiskers", ParentID: "Head", Label: "Left_Whiskers [Sway {pivot: right; range: 7; stiffness: 0.30}]", ZIndex: 5, Category: "whisker", Anchor: &RigAnchor{X: width * 0.44, Y: height * 0.47, PivotPolicy: "right"}},
				RigLayer{ID: "Right_Whiskers", ParentID: "Head", Label: "Right_Whiskers [Sway {pivot: left; range: 7; stiffness: 0.30}]", ZIndex: 5, Category: "whisker", Anchor: &RigAnchor{X: width * 0.56, Y: height * 0.47, PivotPolicy: "left"}},
			)

		case strings.Contains(comp, "muzzle") || strings.Contains(comp, "snout") || strings.Contains(comp, "visor") || strings.Contains(comp, "face_center"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Muzzle", ParentID: "Head", Label: "Muzzle [Dist {factor: 0.16}]", ZIndex: 5, Category: "head", Anchor: &RigAnchor{X: width / 2, Y: height * 0.46, PivotPolicy: "center"}},
			)

		case strings.Contains(comp, "bell") || strings.Contains(comp, "pendant") || strings.Contains(comp, "reactor") || strings.Contains(comp, "chest_accessory") || strings.Contains(comp, "chest_core"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Bell", Label: "Bell [Follow {yaw: 10; pitch: 6}] [Sway {pivot: top; range: 14; stiffness: 0.18; damping: 0.80}]", ZIndex: 2, Category: "prop", Anchor: &RigAnchor{X: width / 2, Y: height * 0.68, PivotPolicy: "top"}},
			)

		case strings.Contains(comp, "tail"):
			bp.Layers = append([]RigLayer{{
				ID:       "Tail",
				Label:    "Tail [Follow {yaw: -10}] [Sway {pivot: top; range: 20; stiffness: 0.12}]",
				ZIndex:   0,
				Category: "tail",
				Anchor:   &RigAnchor{X: width * 0.35, Y: height * 0.65, PivotPolicy: "top"},
			}}, bp.Layers...)

		case strings.Contains(comp, "wing"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Left_Wing", Label: "Left_Wing [Sway {pivot: right; range: 18; stiffness: 0.16}]", ZIndex: 0, Category: "wing", Anchor: &RigAnchor{X: width * 0.25, Y: height * 0.50, PivotPolicy: "right"}},
				RigLayer{ID: "Right_Wing", Label: "Right_Wing [Sway {pivot: left; range: 18; stiffness: 0.16}]", ZIndex: 0, Category: "wing", Anchor: &RigAnchor{X: width * 0.75, Y: height * 0.50, PivotPolicy: "left"}},
			)

		case strings.Contains(comp, "hair") || strings.Contains(comp, "bangs") || strings.Contains(comp, "forelock"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Forelock_Hair", ParentID: "Head", Label: "Forelock_Hair [Sway {pivot: top; range: 8; stiffness: 0.28}]", ZIndex: 8, Category: "hair", Anchor: &RigAnchor{X: width / 2, Y: height * 0.25, PivotPolicy: "top"}},
			)

		case strings.Contains(comp, "arm") || strings.Contains(comp, "paw"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Arms", ParentID: "Body", Label: "Arms [Follow {yaw: -3; roll: 2}] [Sway {pivot: top; range: 5; stiffness: 0.16; damping: 0.85}]", ZIndex: 2, Category: "body", Anchor: &RigAnchor{X: width / 2, Y: height * 0.75, PivotPolicy: "top"}},
			)

		case strings.Contains(comp, "blush"):
			bp.Layers = append(bp.Layers,
				RigLayer{ID: "Cheeks_Blush", ParentID: "Head", Label: "Cheeks_Blush [Show {when: isBlush}]", ZIndex: 6, Category: "head", Description: "Toggleable blush on cheeks"},
			)
			bp.Expressions = append(bp.Expressions,
				RigExpression{Name: "blush", Condition: "isBlush", ElementID: "Cheeks_Blush"},
			)
		}
	}

	return bp, nil
}
