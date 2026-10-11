# SVGTuber Feature Backlog & Ideas

This document tracks upcoming feature candidates, architectural ideas, and enhancement requests for SVGTuber.

---

## 🚀 Recently Completed Features

The following features from the initial roadmap have been fully implemented and verified:

- [x] **👁️ Autonomous Auto-Blink**:
  - Periodic realistic blinks with natural random variance (`1.5s`–`8.0s`).
  - Smooth sinusoidal blink curve (140ms).
  - Mode selection (`Always Active`, `Only When Face Lost`, `Only When Tracked`).
- [x] **🎯 Rotate Rig Directive (`[Rotate]`)**:
  - Continuous rotation around local element pivots based on tracking blendshapes or head pose.
  - Supports `range` or explicit `from`/`to` angles (e.g. expressive eyebrows, tilting ears, hats).
- [x] **🌫️ Opacity / Fade Rig Directive (`[Fade]`, `[Opacity]`)**:
  - Smooth temporal easing (lerp) across frames with customizable `duration` (e.g. `duration: 350ms`).
  - Seamlessly handles stylesheet classes (`display: none`) in Inkscape, Adobe Illustrator, and Vectorcraft SVGs.
- [x] **🎵 Voice Bounce (`[Bounce]`)**:
  - Real-time RMS audio volume reactive vertical hopping and squash-and-stretch for classic PNGTuber liveliness.
  - Tunable `height`, `speed`, `squash`, and noise gate.
- [x] **👁️ Eye Saccades (Auto-Gaze Wander)**:
  - Subtle, lifelike micro-darts and glances for eye pupil coordinates to prevent a "dead stare" look.
  - Tunable range multiplier in Studio dashboard.
- [x] **🧘 Autonomous Posture Tilt & Head Sway (Auto-Tilt)**:
  - Soothing low-frequency breathing posture sway combined with occasional natural micro-tilts.
  - Tunable amount multiplier and operating modes.
- [x] **🍃 Spring & Sway Physics (`[Physics]` / `[Sway]`)**:
  - Secondary motion and inertia damping on hair clumps, animal ears, antennas, ribbons, and accessories.
  - Physical pendulum harmonic sway driven by head roll (tilt), turning inertia, and subtle breeze flutter.
  - Damped harmonic oscillator filter with tunable `stiffness`, `damping`, `mass`, and `pivot`.
  - Live Studio toggle and multiplier slider (`0.0x`–`2.5x`) under **Automations & Life**.
- [x] **🛡️ Strict Camera-Off Face-Lost Handling**:
  - Continuous 60 FPS face-lost streaming when camera is off so background automations keep the avatar alive.
  - Instant gauge reset to neutral on tracking loss.
- [x] **⌨️ Studio Hotkeys (`1`–`9`) & Stream Deck HTTP API**:
  - Instant expression toggling via number keys `1`–`9` in Studio.
  - Complete REST/Webhook API (`/api/expressions/toggle`, `/trigger`, `/set`, `/reset`, `/calibrate`, `/avatar/swap`).
- [x] **🔗 Multi-Segment Chain Rigging (`[Chain]`)**:
  - Hierarchical parent-child rotation and whip propagation across SVG elements.
  - Supports nested SVG groups (automatic parent discovery) and flat sibling layers (forward-kinematics orbit).
  - Tunable `factor`, `lag` (delay frames), `stiffness`, `damping`, and `whip`.
- [x] **📖 OBS Streamer Setup Guide (`docs/OBS_QUICKSTART.md`)**:
  - Step-by-step OBS Browser Source setup, 60 FPS vector configuration, and transparency tips.
  - Important checkbox gotchas ("Shutdown source when not visible" & "Refresh browser when scene becomes active").
  - Hardware acceleration instructions, audio modes (Hybrid vs PNGTuber), and Stream Deck integration.
- [x] **🎀 Modular Accessory & Prop Attachment System**:
  - Load external accessory SVG files (`sunglasses.svg`, `cat_ears.svg`, `sweat_drop.svg`, custom SVGs) stored in `accessories/` folders.
  - Mount/pin accessories to target avatar anchor nodes (`#layer_head`, `#head`, `#root_svg`) with front/back Z-order.
  - Interactive transform tuning in Studio: live position (`x`, `y`), scale/stretch (`scaleX`, `scaleY`), rotation angle, and layer ordering.
  - Automatically inherits parent motion, head tracking, sway, and bounce, and parses inner rig directives (e.g. cat ear sway).
  - Live synchronization across OBS Overlay and Studio via WebSocket and REST API.

---

## 📋 Active Backlog & Next Milestones

### 1. 💧 Procedural & Loop Animation Directives (`[Drip]`, `[Pulse]`, `[Float]`)
- **Status:** Planned
- **Estimated Effort:** ~3 hours
- **Concept:**
  - Continuous or triggered procedural animations evaluated at 60 FPS:
    - `[Drip {distance: 35; duration: 1.2s; loop: true; fade: true}]`: Sweat drips sliding down temple/forehead, tears streaming, anime drool.
    - `[Pulse {scale: 0.85 to 1.15; period: 600ms; pivot: center}]`: Throbbing anger veins, pulsing blush, panic marks.
    - `[Float {distance: -40; drift: 10; duration: 1.8s; loop: true}]`: Steam puffs drifting up, floating hearts, sparkles.

---

### 2. 🌐 OS Global Hotkeys (Zero-CGO Pure Go)
- **Status:** Planned
- **Estimated Effort:** ~2–3 hours
- **Concept:**
  - Global hotkeys across Windows and Linux (e.g. `F13`–`F24`, `Numpad 1`–`9`, `Ctrl+Shift+E`) so streamers can toggle expressions, calibrate, or equip accessories while tabbed into fullscreen games or drawing applications.
  - Windows: pure Go `syscall.NewLazyDLL("user32.dll").NewProc("RegisterHotKey")` with a message pump.
  - Linux: X11 / XDG GlobalShortcuts DBus portal.

---

### 3. 🖱️ Global / Window Mouse Look-At
- **Status:** Planned
- **Estimated Effort:** ~4–5 hours
- **Concept:**
  - Enables the avatar's gaze (and subtle head angle) to follow the user's mouse cursor across the screen.
  - Popular for gaming streams, speedruns, and digital art streams.
  - Directive syntax: `Pupils [Move {x: mouseX; y: mouseY; range: 8}]`.


