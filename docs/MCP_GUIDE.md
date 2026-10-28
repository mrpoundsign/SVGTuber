# SVGTuber MCP Server & AI Rigging Guide (`svgtuber -mcp`)

SVGTuber includes a built-in **Model Context Protocol (MCP)** server (`svgtuber -mcp`) that enables AI coding/design agents (such as Antigravity, Claude Desktop, Cursor, and Windsurf) and vector illustration tools (such as **Vectorcraft** and **Inkscape**) to plan, structure, rig, validate, preview, and live-control vector VTuber puppets.

---

## 1. Quick Setup (`-mcp`)

The MCP server is compiled directly into the main `svgtuber` binary and communicates over standard input/output (`stdio`) using JSON-RPC 2.0. All diagnostic logs are routed to `stderr` so `stdout` remains strictly reserved for protocol messages.

Add `svgtuber` with the `-mcp` flag to your MCP client configuration:

### Windows (`mcp_config.json` / `claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "svgtuber": {
      "command": "C:\\path\\to\\SVGTuber\\build\\svgtuber.exe",
      "args": ["-mcp"]
    }
  }
}
```

### Linux / macOS
```json
{
  "mcpServers": {
    "svgtuber": {
      "command": "/path/to/SVGTuber/build/svgtuber",
      "args": ["-mcp"]
    }
  }
}
```

---

## 2. Automatic Handshake Instructions & Built-in Resources

When an MCP host connects to `svgtuber -mcp`:
1. **`initialize` Handshake (`InitializeResult.instructions`)**: The server automatically returns the 5-step rigging workflow, the **Universal Layer Naming Convention**, and the 4 core geometric rules in the handshake payload so the AI agent knows how to name and structure layers before calling its first tool.
2. **MCP Resources (`resources/list` & `resources/read`)**: Agents and users can query two built-in markdown resources at any time:
   - `svgtuber://guides/naming-conventions` — Canonical archetype-agnostic layer naming table, organic/mechanical aliases, and material-aware physics rules.
   - `svgtuber://guides/workflow` — Step-by-step guide for pairing Vectorcraft or Inkscape with the SVGTuber MCP tools.

---

## 3. End-to-End 5-Step Avatar Workflow

Whether creating an organic animal (otter, cow, dragon), a humanoid character, or a mechanical robot, follow this 5-step pipeline:

### Step 1: Plan the Rig (`svgtuber_plan_rig`)
Generate a verified layer blueprint, Z-order hierarchy, and anchor coordinate budget for the target archetype:
```json
{
  "name": "svgtuber_plan_rig",
  "arguments": {
    "archetype": "robot",
    "style": "semi-realism",
    "components": ["antennas", "ears", "reactor", "visor", "arms", "tail", "blush"],
    "canvas_width": 800,
    "canvas_height": 800
  }
}
```

### Step 2: Author Vector Shapes with Universal Layer Names
Draw your paths in **Vectorcraft** (using `command_batch` with `draw_path` / `draw_shape`) or **Inkscape** on an `800 x 800` canvas, naming each element according to the [Universal Layer Naming Convention](#4-universal-archetype-agnostic-layer-naming-convention). Export the artwork to `.svg`.

### Step 3: Clean Exported XML IDs (`svgtuber_clean_svg`)
Vector editors often mangle IDs when exporting (e.g., turning `Mouth_Open [Show ...]` into `id="Mouth_Open__Show__..."` or appending duplicate suffixes). Normalize them in one call:
```json
{
  "name": "svgtuber_clean_svg",
  "arguments": {
    "svg_path": "testdata/my_avatar.svg",
    "output_path": "testdata/my_avatar.svg"
  }
}
```

### Step 4: Auto-Structure Scene Graph & Apply Directives (`svgtuber_auto_rig`)
`svgtuber_auto_rig` detects flat sibling leaf shapes (`<path>`, `<rect>`, `<circle>`, `<ellipse>`) exported from Vectorcraft/Illustrator, reorganizes them into a nested `<g>` hierarchy so turning the head carries all facial features together, and applies verified IAMS directives and pivot anchors:
```json
{
  "name": "svgtuber_auto_rig",
  "arguments": {
    "svg_path": "testdata/my_avatar.svg",
    "output_path": "testdata/my_avatar.svg",
    "overwrite_existing": true
  }
}
```

### Step 5: Validate & Generate Studio Widget (`svgtuber_validate_rig` & `svgtuber_generate_studio_widget`)
Lint the rigged SVG for structural, CSS, and geometric issues, then generate a standalone 60fps interactive HTML Studio Widget:
```json
{
  "name": "svgtuber_validate_rig",
  "arguments": {
    "svg_path": "testdata/my_avatar.svg"
  }
}
```
```json
{
  "name": "svgtuber_generate_studio_widget",
  "arguments": {
    "svg_path": "testdata/my_avatar.svg",
    "title": "My Custom VTuber",
    "output_path": "my_avatar_studio_widget.html"
  }
}
```

---

## 4. Universal Archetype-Agnostic Layer Naming Convention

`svgtuber_auto_rig` groups flat vector paths into a proper back-to-front `<g>` scene graph based on their element IDs. You can use either the **Universal Layer Prefix** or any of its **Supported Aliases** (case-insensitive):

| Universal Layer Prefix | Organic / Mechanical Aliases | Generated `<g>` Group | Automatic IAMS Directives & Physics |
| :--- | :--- | :--- | :--- |
| **`Tail`** | `Tail_Cable_*`, `Tail_Tip_*`, `Tail_Plug_*` | `Tail_Group` | `[Follow {yaw: -8; pitch: 4}] [Sway {pivot: top; range: 18; stiffness: 0.12; damping: 0.82}]` |
| **`Neck`** | `Neck_Spine_Core`, `Neck_Pistons` | `Neck_Group` | Base container inside `Body_Group` behind the chin |
| **`Neck_Ring_1` .. `5`** | `Neck_Highlight_1` .. `5` | `Neck_Ring_1..5_Group` | Graduated accordion flex from head (`yaw: 13; pitch: 10`) down to collar (`yaw: 3; pitch: 2`) |
| **`Body`** | `Torso`, `Chest`, `Body_Spot_*`, `Body_Armor_*`, `Body_Vents` | `Body_Group` | `[Idle {breathe: 0.02; period: 3.8s; pivot: bottom}] [Bounce {volume: 0.04; y: 6; squash: 0.02; pivot: bottom}]` |
| **`Arm_Left` / `Arm_Right`** | `Arm_Left_Ring_1..6`, `Arm_Right_Ring_1..6` | `Arm_Left_Group`, `Arm_Right_Group` | Subtle shoulder counter-sway (`[Follow {yaw: -2; roll: 1.5; pivot: top}] [Sway {pivot: top; range: 3}]`) |
| **`Hand_Left` / `Hand_Right`** | `Paw_Left/Right`, `Hoof_Left/Right`, `Claw_Left/Right`, `Pincer_Left/Right` | Inside `Arm_Left/Right_Group` | Moves cohesively with parent arm |
| **`Collar`** | `Bandanna_Collar`, `Scarf`, `Neck_Flange` | `Collar_Group` | `[Follow {yaw: 5; pitch: 3; roll: 2; pivot: center}]` |
| **`Chest_Accessory`** | `Bell_*`, `Pendant_*`, `Chest_Core_*`, `Reactor_*`, `Bell_Core_*` | `Chest_Accessory_Group` | **Organic**: Pendulum `[Sway {pivot: top; range: 15}]`<br>**Mechanical (`Core`/`Reactor`)**: `[Follow {pivot: center}] [Bounce {pivot: center}]` |
| **`Head`** | `Head_Base`, `Head_Inner_Panel`, `Head_Spot_Left/Right` | `Head_Group` | `[Follow {yaw: 16; pitch: 12; roll: 8; pivot: center}]` (parent of all head/face groups) |
| **`Ear_Left` / `Ear_Right`** | `Left_Ear_*`, `Right_Ear_*`, `Ear_Pod_*`, `Fin_Left/Right` | `Ear_Left_Group`, `Ear_Right_Group` | **Organic**: `[Sway {pivot: right/left; range: 11; stiffness: 0.22}]`<br>**Mechanical (`Ear_Pod`)**: Rigid `[Sway {range: 3.5; stiffness: 0.35}]` |
| **`Top_Accessory_Left/Right`** | `Antenna_Left/Right`, `Left_Horn_*`, `Right_Horn_*`, `Hair_Tuft_*`, `Ahoge` | `Top_Accessory_Left_Group`, `Top_Accessory_Right_Group` | **Organic (`Horn`)**: `[Sway {pivot: bottom; range: 5; stiffness: 0.30}]`<br>**Mechanical (`Antenna`)**: Whippy `[Sway {pivot: bottom; range: 13; stiffness: 0.18}]` |
| **`Face_Center`** | `Muzzle_*`, `Snout_*`, `Nose_*`, `Nostril_*`, `Visor_*` | `Face_Center_Group` / `Head_Base_Group` | `[Dist {factor: 0.14}]` (Note: `Visor_*` is placed inside `Head_Base_Group` behind eyes so eyes render on top of the screen) |
| **`Eye_Open_Left` / `Right`** | `Left_Eye_White`, `Right_Eye_White` | `Eye_Open_Left_Group`, `Eye_Open_Right_Group` | Independent winking: `[Hide {when: blinkL > 0.4}]` and `[Hide {when: blinkR > 0.4}]` |
| **`Pupil_Left` / `Pupil_Right`** | `Iris_Left/Right`, `Pupil_Left/Right_Core`, `Pupil_Left/Right_Glint` | `Pupil_Left_Group`, `Pupil_Right_Group` | Nested inside `Eye_Open_Left/Right_Group` with `[Move {x: eyeX; y: eyeY; range: 6}]` |
| **`Eye_Closed_Left` / `Right`** | `Left_Eye_Closed`, `Right_Eye_Closed` | `Eye_Closed_Left_Group`, `Eye_Closed_Right_Group` | Independent closed eyelids: `[Show {when: blinkL > 0.4}]` and `[Show {when: blinkR > 0.4}]` |
| **`Brow_Left` / `Brow_Right`** | `Left_Brow`, `Right_Brow`, `Brows_Shutter` | `Brow_Left_Group`, `Brow_Right_Group` | Independent eyebrows: `[Move {y: browL; rangeY: -8}] [Rotate {param: browL; range: -6; pivot: center}]` and `[Move {y: browR; rangeY: -8}] [Rotate {param: browR; range: 6; pivot: center}]` |
| **`Cheeks`** | `Cheeks_Blush_Left/Right`, `Blush_*`, `Whisker_Left/Right_*` | `Cheeks_Group`, `Whisker_Left/Right_Group` | `Cheeks_Group`: `[Show {when: isBlush}]`<br>`Whiskers`: `[Sway {pivot: right/left; range: 7}]` |
| **`Mouth_Resting`** | `Mouth_Neutral`, `Mouth_Closed` | `Mouth_Resting_Group` | `[Hide {when: isMouthOpen \|\| isSmiling}]` |
| **`Mouth_Smile`** | `Smile_Tongue` | `Mouth_Smile_Group` | `[Show {when: isSmiling && !isMouthOpen}] [Scale {param: smile; x: 0.25; y: 0.35; pivot: top}]` |
| **`Mouth_Open`** | `Mouth_Tongue`, `Open_Tongue`, `Mouth_Equalizer` | `Mouth_Open_Group` | **Organic**: `[Scale {param: mouthOpen; pivot: top}]`<br>**Mechanical (`Visor`/`Equalizer`)**: `[Scale {param: mouthOpen; pivot: center}]` |

---

## 5. Complete MCP Tool Reference

### `svgtuber_plan_rig`
Generates a complete structural layer blueprint, Z-order sequence, and coordinate anchors for any character archetype.
- **Arguments**:
  - `archetype` (`string`, required): e.g. `"cow"`, `"otter"`, `"robot"`, `"dragon"`, `"cat"`, `"humanoid"`
  - `style` (`string`, optional): `"semi-realism"` (default), `"anime"`, `"chibi"`
  - `components` (`string[]`, optional): e.g. `["antennas", "ears", "reactor", "visor", "arms", "tail", "blush"]`
  - `canvas_width` / `canvas_height` (`number`, optional): Defaults to `800` × `800`

### `svgtuber_inspect_rig`
Provides a compact, token-efficient summary of an existing SVG file: viewBox, total elements, rigged layer count, parsed IAMS directives, discovered custom expressions (`isBlush`, `isAngry`, etc.), and unrigged anatomical candidates.
- **Arguments**:
  - `svg_path` (`string`, required): Path to the `.svg` file

### `svgtuber_clean_svg`
Normalizes mangled XML element IDs exported by Illustrator or Vectorcraft into clean semantic base IDs while preserving all IAMS directives in `data-name` and `inkscape:label`.
- **Arguments**:
  - `svg_path` (`string`, required): Source `.svg` path
  - `output_path` (`string`, optional): Destination path (defaults to overwriting `svg_path`)

### `svgtuber_auto_rig`
Automatically converts flat sibling vector shapes into a nested `<g>` hierarchy and applies verified IAMS directives and pivot policies in a single pass.
- **Arguments**:
  - `svg_path` (`string`, required): Target `.svg` path
  - `output_path` (`string`, optional): Destination path (defaults to overwriting `svg_path`)
  - `overwrite_existing` (`boolean`, optional): Re-rig already-tagged elements (default: `false`)

### `svgtuber_apply_directives`
Surgically applies or overrides custom IAMS directives on specific SVG elements by ID without altering path geometry.
- **Arguments**:
  - `svg_path` (`string`, required): Target `.svg` path
  - `tags` (`array`, required): Array of `{"id": "Element_ID", "directive": "[Sway {pivot: bottom; range: 10}]"}`
  - `output_path` (`string`, optional): Destination path

### `svgtuber_derive_directive`
Returns the recommended IAMS directive string and pivot anchor for a single part type.
- **Arguments**:
  - `part_type` (`string`, required): e.g. `"horn"`, `"antenna"`, `"ear"`, `"whisker_left"`, `"mouth_open"`, `"mouth_equalizer"`, `"chest_core"`, `"bell"`, `"tail"`, `"arm"`

### `svgtuber_validate_rig`
Runs 9 structural, directive, CSS, and geometric checks on an SVG avatar file and returns a structured report (`is_valid`, `issues`, `summary`):
1. **Dangerous CSS (`transform-box: fill-box`)**: Flags `ERROR` if present, as it overrides SVG viewBox user coordinates in OBS CEF and causes scaled elements to fly diagonally.
2. **Flat Leaf `Head` Hazard**: Flags `ERROR` if `Head` is a self-closing leaf shape instead of a parent `<g>` group.
3. **Missing Pivot Anchors**: Flags `WARNING` on any `[Sway]`, `[Rotate]`, `[Physics]`, or `[Scale]` directive missing an explicit `pivot` parameter.
4. **Mouth Bottom-Pivot Check**: Flags `WARNING` if a mouth scales from `pivot: bottom` (which expands upward into the nose instead of dropping the jaw).
5. **Whisker Root Pivot Check**: Ensures left whiskers use `pivot: right` and right whiskers use `pivot: left`.
6. **Independent Left & Right Eye Blink Completeness**: Ensures **both** Left (`blinkL` / `isBlinkL`) and Right (`blinkR` / `isBlinkR`) open (`[Hide]`) and closed (`[Show]`) eye bindings exist.
7. **Floating Head / Neck Overlap Check**: Warns if `Body` starts below the bottom of `Head` without a connecting `Neck` or vertical overlap behind the chin.
8. **Out-of-Bounds Markings Check**: Warns if `Body_Spot_*` or `Head_Spot_*` paths protrude outside their parent `Body` or `Head` bounding box.
9. **Closed Shoulder Joint Seam Check**: Warns if attached `Arm_Left` or `Arm_Right` paths are closed (`Z`) with a visible stroke across the interior shoulder seam.

### `svgtuber_simulate_motion`
Simulates forward kinematics across `yaw`, `pitch`, `roll`, and `mouth_open` inputs to verify transform stability.
- **Arguments**:
  - `svg_path` (`string`, required)
  - `yaw`, `pitch`, `roll`, `mouth_open` (`number`)

### `svgtuber_generate_studio_widget`
Generates a standalone, zero-scroll HTML Studio Widget embedding the SVG with 60fps spring physics, mouse-hover head tracking, voice simulation, independent `Blink Left` and `Blink Right` sliders, and expression toggle buttons.
- **Arguments**:
  - `svg_path` (`string`, required)
  - `title` (`string`, optional)
  - `output_path` (`string`, optional)

### `svgtuber_control_rig`
Triggers or toggles an expression on a live running SVGTuber instance over HTTP (`http://localhost:7420`).
- **Arguments**:
  - `expression` (`string`, required): e.g. `"blush"`, `"smile"`
  - `active` (`boolean`, required): `true` or `false`
  - `server_url` (`string`, optional): Defaults to `"http://localhost:7420"`
