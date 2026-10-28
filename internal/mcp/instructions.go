package mcp

import "fmt"

// ServerInstructions is delivered automatically to MCP clients during the `initialize` handshake.
const ServerInstructions = `# SVGTuber MCP — Usage Guide & Universal Layer Naming Convention

## 1. Recommended 5-Step Workflow
1. **Plan (` + "`svgtuber_plan_rig`" + `)**: Generate a structural layer blueprint and coordinate budget for your avatar archetype.
2. **Draw & Name Layers**: Author your vector paths (e.g., in Vectorcraft or Inkscape) using the **Universal Layer Naming Convention** below so ` + "`svgtuber_auto_rig`" + ` can automatically structure the scene graph and apply physics.
3. **Clean IDs (` + "`svgtuber_clean_svg`" + `)**: Normalize any mangled exported XML IDs (such as ` + "`Mouth_Open__Show__...`" + `) into clean base IDs.
4. **Auto-Rig (` + "`svgtuber_auto_rig`" + `)**: Automatically organize flat sibling paths into a nested ` + "`<g>`" + ` hierarchy (` + "`Head_Group`" + `, ` + "`Body_Group`" + `, ` + "`Neck_Group`" + `, independent ` + "`Eye_Open_Left_Group`" + ` / ` + "`Eye_Open_Right_Group`" + `, independent ` + "`Brow_Left_Group`" + ` / ` + "`Brow_Right_Group`" + `, etc.) and attach verified IAMS directives.
5. **Validate & Preview (` + "`svgtuber_validate_rig`" + ` & ` + "`svgtuber_generate_studio_widget`" + `)**: Lint the SVG for detachment hazards, visual joint seams, out-of-bounds markings, and missing L/R eye blink and eyebrow states, then generate an interactive 60fps HTML Studio Widget.

## 2. Universal Archetype-Agnostic Layer Naming Convention
Use these universal prefixes (or their supported organic/mechanical aliases) when naming vector objects:
- **Body & Markings**: ` + "`Body`" + ` (or ` + "`Torso`" + `), ` + "`Body_Spot_*`" + `, ` + "`Body_Armor_*`" + `, ` + "`Body_Vents`" + `
- **Neck & Accordion Rings**: ` + "`Neck`" + `, ` + "`Neck_Spine_Core`" + `, ` + "`Neck_Pistons`" + `, ` + "`Neck_Ring_1`" + ` .. ` + "`Neck_Ring_5`" + ` (graduated flex from head to collar)
- **Collar / Neck Trim**: ` + "`Collar`" + ` (or ` + "`Bandanna_Collar`" + `, ` + "`Scarf`" + `, ` + "`Neck_Flange`" + `)
- **Chest Centerpiece**: ` + "`Chest_Accessory`" + ` (or ` + "`Chest_Core_*`" + `, ` + "`Reactor_*`" + `, ` + "`Bell_*`" + `, ` + "`Pendant_*`" + `)
- **Arms & Forelimbs**: ` + "`Arm_Left`" + `, ` + "`Arm_Right`" + ` (plus optional ` + "`Arm_Left_Ring_1..6`" + `, ` + "`Arm_Right_Ring_1..6`" + `)
- **Hands / Tips**: ` + "`Hand_Left`" + `, ` + "`Hand_Right`" + ` (or ` + "`Claw_Left/Right`" + `, ` + "`Pincer_Left/Right`" + `, ` + "`Paw_Left/Right`" + `, ` + "`Hoof_Left/Right`" + `)
- **Tail / Rear Conduit**: ` + "`Tail`" + ` (or ` + "`Tail_Cable_*`" + `, ` + "`Tail_Tip_*`" + `)
- **Head & Face Container**: ` + "`Head`" + ` (or ` + "`Head_Base`" + `), ` + "`Head_Inner_Panel`" + `, ` + "`Head_Spot_Left`" + `, ` + "`Head_Spot_Right`" + `
- **Side Head Attachments**: ` + "`Ear_Left`" + `, ` + "`Ear_Right`" + ` (or ` + "`Left_Ear_*`" + `, ` + "`Right_Ear_*`" + `, ` + "`Ear_Pod_*`" + `, ` + "`Fin_Left/Right`" + `)
- **Top Head Attachments**: ` + "`Top_Accessory_Left`" + `, ` + "`Top_Accessory_Right`" + ` (or ` + "`Antenna_Left/Right`" + `, ` + "`Left_Horn_*`" + `, ` + "`Right_Horn_*`" + `, ` + "`Hair_Tuft_*`" + `, ` + "`Ahoge`" + `)
- **Center Face / Visor / Snout**: ` + "`Face_Center`" + ` (or ` + "`Visor_*`" + `, ` + "`Muzzle_*`" + `, ` + "`Snout_*`" + `, ` + "`Nose_*`" + `)
- **Independent Left & Right Open Eyes**: ` + "`Eye_Open_Left`" + `, ` + "`Eye_Open_Right`" + ` (or ` + "`Left_Eye_White`" + `, ` + "`Right_Eye_White`" + `)
- **Pupils & Irises**: ` + "`Pupil_Left`" + `, ` + "`Pupil_Right`" + ` (plus ` + "`Pupil_Left_Core`" + `, ` + "`Pupil_Left_Glint`" + `, ` + "`Iris_Left/Right`" + `)
- **Independent Left & Right Closed Eyelids**: ` + "`Eye_Closed_Left`" + `, ` + "`Eye_Closed_Right`" + ` (or ` + "`Left_Eye_Closed`" + `, ` + "`Right_Eye_Closed`" + `)
- **Independent Left & Right Eyebrows / Shutters**: ` + "`Brow_Left`" + `, ` + "`Brow_Right`" + ` (or compound ` + "`Brows_Shutter`" + `, which ` + "`svgtuber_auto_rig`" + ` splits into ` + "`Brow_Left`" + ` and ` + "`Brow_Right`" + `)
- **Cheeks & Whiskers**: ` + "`Cheeks_Blush_Left`" + `, ` + "`Cheeks_Blush_Right`" + `, ` + "`Whisker_Left_*`" + `, ` + "`Whisker_Right_*`" + `
- **Mouth States**: ` + "`Mouth_Resting`" + `, ` + "`Mouth_Smile`" + `, ` + "`Mouth_Open`" + `, ` + "`Mouth_Tongue`" + ` (or ` + "`Open_Tongue`" + `, ` + "`Mouth_Equalizer`" + `)

## 3. Critical Geometry Rules
- **Both Left & Right Eyes & Brows Required**: Always create separate Left and Right open eyes (` + "`Eye_Open_Left`" + `, ` + "`Eye_Open_Right`" + `), closed eyelids (` + "`Eye_Closed_Left`" + `, ` + "`Eye_Closed_Right`" + `), and eyebrows (` + "`Brow_Left`" + `, ` + "`Brow_Right`" + `) so independent winking (` + "`blinkL`" + ` / ` + "`blinkR`" + `) and independent eyebrow expression (` + "`browL`" + ` / ` + "`browR`" + `) work.
- **No Floating Heads**: Ensure ` + "`Body`" + ` or ` + "`Neck`" + ` overlaps behind the lower chin of ` + "`Head`" + ` by at least 15–20px so upward head pitch never exposes a gap.
- **Open Shoulder Seams**: On attached ` + "`Arm_Left`" + ` and ` + "`Arm_Right`" + ` paths, leave the top shoulder edge open (` + "`closed: false`" + ` / omit trailing ` + "`Z`" + `) so no dark stroke line cuts across the shoulder joint.
- **In-Bounds Markings**: Keep all ` + "`Body_Spot_*`" + `, ` + "`Head_Spot_*`" + `, and facial features strictly inside their parent ` + "`Body`" + ` or ` + "`Head`" + ` polygon contour.`

// NamingConventionsDoc is exposed via the `svgtuber://guides/naming-conventions` MCP resource.
const NamingConventionsDoc = ServerInstructions + `

## 4. Material-Aware Physics Modes
` + "`svgtuber_auto_rig`" + ` automatically adapts physics when mechanical keywords (` + "`Visor`" + `, ` + "`Ear_Pod`" + `, ` + "`Reactor`" + `, ` + "`Chest_Core`" + `, ` + "`Antenna`" + `, ` + "`Equalizer`" + `) are present:
- **Spring Antennas (` + "`Antenna_*`" + ` / ` + "`*_Coil`" + `)**: High-flex whippy sway (` + "`range: 13; stiffness: 0.18; damping: 0.80`" + `).
- **Rigid Side Pods (` + "`Ear_Pod_*`" + `)**: Tight mechanical tolerance (` + "`range: 3.5; stiffness: 0.35; damping: 0.90`" + `).
- **Recessed Chest Core (` + "`Reactor_*`" + ` / ` + "`Chest_Core_*`" + `)**: Centered pivot (` + "`pivot: center`" + `) with speech-driven energy pulse (` + "`[Bounce]`" + `) instead of pendulum swing.
- **LED Equalizer Mouth (` + "`Mouth_Equalizer`" + ` or ` + "`Mouth_Open`" + ` inside a ` + "`Visor`" + `)**: Center-symmetric vertical scaling (` + "`pivot: center`" + `).`

// WorkflowDoc is exposed via the `svgtuber://guides/workflow` MCP resource.
const WorkflowDoc = ServerInstructions + `

## 4. Complete Tool Reference
- ` + "`svgtuber_plan_rig`" + `: Args ` + "`{archetype, style?, components?, canvas_width?, canvas_height?}`" + `. Generates the layer blueprint and coordinate anchors.
- ` + "`svgtuber_inspect_rig`" + `: Args ` + "`{svg_path}`" + `. Returns rigged layer count, directives, expressions, and unrigged anatomical candidates.
- ` + "`svgtuber_clean_svg`" + `: Args ` + "`{svg_path, output_path?}`" + `. Strips mangled ` + "`__Show__...`" + ` suffixes from XML IDs while keeping directives in ` + "`data-name`" + `.
- ` + "`svgtuber_auto_rig`" + `: Args ` + "`{svg_path, output_path?, overwrite_existing?}`" + `. Converts flat sibling shapes into a nested ` + "`<g>`" + ` scene graph and applies verified IAMS directives.
- ` + "`svgtuber_apply_directives`" + `: Args ` + "`{svg_path, tags: [{id, directive}], output_path?}`" + `. Surgically overrides directives on specific element IDs.
- ` + "`svgtuber_derive_directive`" + `: Args ` + "`{part_type}`" + `. Returns the recommended directive and pivot policy for a single part.
- ` + "`svgtuber_validate_rig`" + `: Args ` + "`{svg_path}`" + `. Lints for ` + "`transform-box: fill-box`" + `, flat leaf ` + "`Head`" + `, missing pivots, missing Left/Right eye blink pairs, floating heads, out-of-bounds markings, and closed shoulder seam strokes.
- ` + "`svgtuber_simulate_motion`" + `: Args ` + "`{svg_path, yaw?, pitch?, roll?, mouth_open?}`" + `. Simulates forward kinematics stability.
- ` + "`svgtuber_generate_studio_widget`" + `: Args ` + "`{svg_path, title?, output_path?}`" + `. Generates a standalone 60fps interactive HTML Studio Widget with hover tracking, voice simulation, and independent ` + "`Blink Left`" + ` / ` + "`Blink Right`" + ` sliders.
- ` + "`svgtuber_control_rig`" + `: Args ` + "`{expression, active, server_url?}`" + `. Toggles hotkey expressions on a live SVGTuber server.`

// GetResourceDefinitions returns the list of built-in documentation resources exposed by the MCP server.
func GetResourceDefinitions() []Resource {
	return []Resource{
		{
			URI:         "svgtuber://guides/naming-conventions",
			Name:        "SVGTuber Universal Layer Naming Conventions & Geometry Rules",
			Description: "Canonical archetype-agnostic layer names (organic, humanoid, and mechanical/robot aliases), z-order hierarchy, and geometric validation rules.",
			MimeType:    "text/markdown",
		},
		{
			URI:         "svgtuber://guides/workflow",
			Name:        "SVGTuber 5-Step Avatar Creation & Rigging Workflow",
			Description: "End-to-end guide and complete tool reference for planning, drawing, cleaning, auto-rigging, validating, and previewing SVG VTuber puppets.",
			MimeType:    "text/markdown",
		},
	}
}

// ReadResourceByURI returns the contents of a built-in MCP resource.
func ReadResourceByURI(uri string) (*ReadResourceResult, error) {
	switch uri {
	case "svgtuber://guides/naming-conventions":
		return &ReadResourceResult{
			Contents: []ResourceContents{
				{
					URI:      uri,
					MimeType: "text/markdown",
					Text:     NamingConventionsDoc,
				},
			},
		}, nil
	case "svgtuber://guides/workflow":
		return &ReadResourceResult{
			Contents: []ResourceContents{
				{
					URI:      uri,
					MimeType: "text/markdown",
					Text:     WorkflowDoc,
				},
			},
		}, nil
	default:
		return nil, fmt.Errorf("unknown resource URI: %s", uri)
	}
}
