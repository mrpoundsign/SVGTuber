package mcp

import (
	"errors"
	"fmt"
	"strings"
)

// VectorcraftAction represents a single atomic call to the Vectorcraft MCP server.
type VectorcraftAction struct {
	Step        int            `json:"step"`
	Tool        string         `json:"tool"`
	Explanation string         `json:"explanation"`
	Arguments   map[string]any `json:"arguments"`
}

// VectorcraftRecipe is an ordered execution plan for creating a rigged character in Vectorcraft.
type VectorcraftRecipe struct {
	Archetype  string              `json:"archetype"`
	TotalSteps int                 `json:"total_steps"`
	Actions    []VectorcraftAction `json:"actions"`
	SetupNotes []string            `json:"setup_notes"`
}

// GenerateVectorcraftRecipe builds an executable Vectorcraft action list from ANY RigBlueprint.
func GenerateVectorcraftRecipe(bp *RigBlueprint) (*VectorcraftRecipe, error) {
	if bp == nil {
		return nil, errors.New("blueprint cannot be nil")
	}

	w := bp.CanvasWidth
	h := bp.CanvasHeight
	if w <= 0 {
		w = 800
	}
	if h <= 0 {
		h = 800
	}

	recipe := &VectorcraftRecipe{
		Archetype: bp.Archetype,
		SetupNotes: []string{
			fmt.Sprintf("Artboard set to %.0fx%.0f pt for archetype '%s'.", w, h, bp.Archetype),
			"Directives are attached to group data-name attributes.",
			"Stacking order strictly maintained to prevent render clipping.",
			"Pivots calibrated to prevent floating ears/whiskers and diagonal mouth zooming.",
		},
	}

	step := 1
	addAction := func(tool, explanation string, args map[string]any) {
		recipe.Actions = append(recipe.Actions, VectorcraftAction{
			Step:        step,
			Tool:        tool,
			Explanation: explanation,
			Arguments:   args,
		})
		step++
	}

	// 1. Setup Artboard / Reset Selection
	addAction("command_run", "Deselect all elements to start fresh artboard structure", map[string]any{
		"id": "selectallnone",
	})

	// 2. Iterate dynamically over blueprint layers in Z-order
	for _, layer := range bp.Layers {
		cat := layer.Category
		if cat == "" {
			cat = inferCategory(layer.ID)
		}

		anchorX := w / 2
		anchorY := h / 2
		if layer.Anchor != nil {
			anchorX = layer.Anchor.X
			anchorY = layer.Anchor.Y
		}

		switch cat {
		case "tail":
			addAction("draw_path", fmt.Sprintf("Draw %s base geometry for %s", layer.ID, bp.Archetype), map[string]any{
				"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX, anchorY,
					anchorX-50, anchorY-10, anchorX-110, anchorY+20, anchorX-150, anchorY+65,
					anchorX-190, anchorY+110, anchorX-170, anchorY+190, anchorX-150, anchorY+200),
			})
			addAction("set_paint", fmt.Sprintf("Paint %s with base coat and contour stroke", layer.ID), map[string]any{
				"fill":         "#724b2d",
				"stroke":       "#2b170a",
				"stroke_width": 2.8,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "body":
			addAction("draw_shape", fmt.Sprintf("Draw %s torso mass", layer.ID), map[string]any{
				"shape":  "rect",
				"x":      w * 0.22,
				"y":      h * 0.54,
				"width":  w * 0.56,
				"height": h * 0.44,
				"rx":     50,
				"ry":     50,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s torso tones", layer.ID), map[string]any{
				"fill":         "#283545",
				"stroke":       "#141c26",
				"stroke_width": 3.0,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s idle breathe & bounce directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "arm":
			isLeft := strings.Contains(strings.ToLower(layer.ID), "left")
			var sleeveD string
			if isLeft {
				sleeveD = fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX, anchorY, anchorX-45, anchorY+60, anchorX-50, anchorY+165, anchorX, anchorY+195,
					anchorX+30, anchorY+215, anchorX+70, anchorY+200, anchorX+100, anchorY+160)
			} else {
				sleeveD = fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX, anchorY, anchorX+45, anchorY+60, anchorX+50, anchorY+165, anchorX, anchorY+195,
					anchorX-30, anchorY+215, anchorX-70, anchorY+200, anchorX-100, anchorY+160)
			}
			addAction("draw_path", fmt.Sprintf("Draw %s sleeve and paw resting on chest", layer.ID), map[string]any{
				"d": sleeveD,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s garment tones and paw pads", layer.ID), map[string]any{
				"fill":         "#283545",
				"stroke":       "#141c26",
				"stroke_width": 2.8,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s follow & sway directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "head":
			addAction("draw_shape", fmt.Sprintf("Draw %s cranium base", layer.ID), map[string]any{
				"shape": "ellipse",
				"cx":    anchorX,
				"cy":    anchorY,
				"rx":    w * 0.23,
				"ry":    h * 0.18,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s base coat tones", layer.ID), map[string]any{
				"fill":         "#724b2d",
				"stroke":       "#2b170a",
				"stroke_width": 3.0,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s 3D head follow & tilt directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "ear":
			isLeft := strings.Contains(strings.ToLower(layer.ID), "left")
			var d string
			if isLeft {
				d = fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX, anchorY+15, anchorX-35, anchorY+10, anchorX-45, anchorY-25, anchorX-23, anchorY-47)
			} else {
				d = fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX, anchorY+15, anchorX+35, anchorY+10, anchorX+45, anchorY-25, anchorX+23, anchorY-47)
			}
			addAction("draw_path", fmt.Sprintf("Draw %s anchored to skull margin", layer.ID), map[string]any{
				"d": d,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s with dark shading", layer.ID), map[string]any{
				"fill":         "#56351d",
				"stroke":       "#2b170a",
				"stroke_width": 2.5,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s sway directive with calibrated pivot", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "muzzle":
			addAction("draw_shape", fmt.Sprintf("Draw %s snout parallax cluster", layer.ID), map[string]any{
				"shape": "ellipse",
				"cx":    anchorX,
				"cy":    anchorY,
				"rx":    w * 0.11,
				"ry":    h * 0.05,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s coloration", layer.ID), map[string]any{
				"fill":         "#dfcebc",
				"stroke":       "#38200f",
				"stroke_width": 2.0,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s 3D parallax dist directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "whisker_left":
			addAction("draw_path", "Draw left tactile whisker vibrissae", map[string]any{
				"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f",
					anchorX, anchorY-10, anchorX-57, anchorY-17, anchorX-122, anchorY-23, anchorX-187, anchorY-13),
			})
			addAction("set_paint", "Paint crisp whisker strokes", map[string]any{
				"fill":         "none",
				"stroke":       "#f8fafc",
				"stroke_width": 1.8,
			})
			addAction("command_run", "Assign IAMS left whisker sway directive strictly with pivot: right", map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "whisker_right":
			addAction("draw_path", "Draw right tactile whisker vibrissae", map[string]any{
				"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f",
					anchorX, anchorY-10, anchorX+57, anchorY-17, anchorX+122, anchorY-23, anchorX+187, anchorY-13),
			})
			addAction("set_paint", "Paint crisp whisker strokes", map[string]any{
				"fill":         "none",
				"stroke":       "#f8fafc",
				"stroke_width": 1.8,
			})
			addAction("command_run", "Assign IAMS right whisker sway directive strictly with pivot: left", map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "mouth":
			lowerID := strings.ToLower(layer.ID)
			switch {
			case strings.Contains(lowerID, "open"):
				addAction("draw_path", fmt.Sprintf("Draw %s oral speech cavity", layer.ID), map[string]any{
					"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
						anchorX-26, anchorY, anchorX-26, anchorY, anchorX-14, anchorY+44, anchorX, anchorY+44,
						anchorX+14, anchorY+44, anchorX+26, anchorY, anchorX+26, anchorY),
				})
				addAction("set_paint", "Paint deep oral cavity", map[string]any{
					"fill":         "#380c10",
					"stroke":       "#24140a",
					"stroke_width": 2.2,
				})
			case strings.Contains(lowerID, "smile"):
				addAction("draw_path", fmt.Sprintf("Draw %s cheerful smiling mouth", layer.ID), map[string]any{
					"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
						anchorX-42, anchorY, anchorX-25, anchorY+36, anchorX+25, anchorY+36, anchorX+42, anchorY,
						anchorX+28, anchorY+6, anchorX-28, anchorY+6, anchorX-42, anchorY),
				})
				addAction("set_paint", "Paint warm smiling oral cavity with cute teeth", map[string]any{
					"fill":         "#4a121a",
					"stroke":       "#24140a",
					"stroke_width": 2.8,
				})
			default:
				addAction("draw_path", fmt.Sprintf("Draw %s resting lip line", layer.ID), map[string]any{
					"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f",
						anchorX-32, anchorY+6, anchorX-18, anchorY+12, anchorX, anchorY, anchorX+32, anchorY+6),
				})
				addAction("set_paint", "Paint lip contour", map[string]any{
					"fill":         "none",
					"stroke":       "#24140a",
					"stroke_width": 2.8,
				})
			}
			addAction("command_run", fmt.Sprintf("Assign IAMS %s directive with pivot: top", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "eye":
			addAction("draw_shape", fmt.Sprintf("Draw %s tracking element", layer.ID), map[string]any{
				"shape": "circle",
				"cx":    anchorX,
				"cy":    anchorY,
				"r":     12,
			})
			addAction("set_paint", fmt.Sprintf("Paint %s pupil/iris", layer.ID), map[string]any{
				"fill":   "#1e1b18",
				"stroke": "none",
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s gaze tracking directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		case "hair":
			addAction("draw_path", fmt.Sprintf("Draw %s hair tuft / ahoge", layer.ID), map[string]any{
				"d": fmt.Sprintf("M %.0f %.0f C %.0f %.0f %.0f %.0f %.0f %.0f Z",
					anchorX-8, anchorY, anchorX-12, anchorY-35, anchorX+8, anchorY-60, anchorX+25, anchorY-75),
			})
			addAction("set_paint", fmt.Sprintf("Paint %s strands", layer.ID), map[string]any{
				"fill":         "#724b2d",
				"stroke":       "#2b170a",
				"stroke_width": 2.5,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s physics sway directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})

		default:
			// Generic element
			addAction("draw_shape", fmt.Sprintf("Draw %s shape", layer.ID), map[string]any{
				"shape":  "rect",
				"x":      anchorX - 20,
				"y":      anchorY - 20,
				"width":  40,
				"height": 40,
			})
			addAction("command_run", fmt.Sprintf("Assign IAMS %s directive", layer.ID), map[string]any{
				"id":    "set_object_name",
				"value": layer.Label,
			})
		}
	}

	// Final verification render
	addAction("render_preview", "Generate visual preview of rigged avatar on artboard", map[string]any{
		"format": "png",
	})

	recipe.TotalSteps = len(recipe.Actions)
	return recipe, nil
}

func inferCategory(id string) string {
	lower := strings.ToLower(id)
	switch {
	case strings.Contains(lower, "tail"):
		return "tail"
	case strings.Contains(lower, "arm") || strings.Contains(lower, "paw") || strings.Contains(lower, "hand"):
		return "arm"
	case strings.Contains(lower, "body") || strings.Contains(lower, "torso"):
		return "body"
	case strings.Contains(lower, "head") || strings.Contains(lower, "face"):
		return "head"
	case strings.Contains(lower, "ear"):
		return "ear"
	case strings.Contains(lower, "muzzle") || strings.Contains(lower, "snout"):
		return "muzzle"
	case strings.Contains(lower, "whisker") && strings.Contains(lower, "left"):
		return "whisker_left"
	case strings.Contains(lower, "whisker") && strings.Contains(lower, "right"):
		return "whisker_right"
	case strings.Contains(lower, "mouth"):
		return "mouth"
	case strings.Contains(lower, "pupil") || strings.Contains(lower, "eye"):
		return "eye"
	case strings.Contains(lower, "hair") || strings.Contains(lower, "ahoge") || strings.Contains(lower, "bangs"):
		return "hair"
	default:
		return "misc"
	}
}
