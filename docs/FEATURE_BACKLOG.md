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
- [x] **📖 OBS Streamer Setup Guide (`docs/OBS_QUICKSTART.md`)**:
  - Step-by-step OBS Browser Source setup, 60 FPS vector configuration, and transparency tips.
  - Important checkbox gotchas ("Shutdown source when not visible" & "Refresh browser when scene becomes active").
  - Hardware acceleration instructions, audio modes (Hybrid vs PNGTuber), and Stream Deck integration.

---

## 📋 Active Backlog & Next Milestones

### 1. 🔗 Multi-Segment Chain Rigging
- **Status:** Next priority candidate
- **Estimated Effort:** ~3–4 hours
- **Concept:**
  - Allows segmented appendages (such as ponytails, braid chains, cat/fox tails, or scarves) to curve and whip naturally.
  - Resolves parent-child hierarchies across SVG group IDs and propagates cumulative rotation and lag down the chain.
- **Directive Idea:**
  ```ini
  Tail Segment 1 [Follow {yaw: 5; pitch: 4; pivot: top}]
  Tail Segment 2 [Chain {parent: #segment_1; factor: 0.75; lag: 3}]
  Tail Segment 3 [Chain {parent: #segment_2; factor: 0.90; lag: 5}]
  ```

---

### 2. 🔗 Multi-Segment Chain Rigging
- **Status:** Planned
- **Estimated Effort:** ~3–4 hours
- **Concept:**
  - Allows segmented appendages (such as ponytails, braid chains, cat/fox tails, or scarves) to curve and whip naturally.
  - Resolves parent-child hierarchies across SVG group IDs and propagates cumulative rotation and lag down the chain.
- **Directive Idea:**
  ```ini
  Tail Segment 1 [Follow {yaw: 5; pitch: 4; pivot: top}]
  Tail Segment 2 [Chain {parent: #segment_1; factor: 0.75; lag: 3}]
  Tail Segment 3 [Chain {parent: #segment_2; factor: 0.90; lag: 5}]
  ```

---

### 3. 🖱️ Global / Window Mouse Look-At
- **Status:** Planned
- **Estimated Effort:** ~4–5 hours
- **Concept:**
  - Enables the avatar's gaze (and subtle head angle) to follow the user's mouse cursor across the screen.
  - Especially popular for gaming streams, speedruns, and digital art streams.
- **Implementation Strategy:**
  - Studio can capture mouse coordinates within the window via `mousemove`.
  - Optional OS-level global cursor polling in pure Go (or a lightweight tray hook) streaming normalized screen `(x, y)` to the overlay.
  - Directive syntax:
    ```ini
    Pupils [Move {x: mouseX; y: mouseY; range: 8}]
    ```

---

### 4. 🎛️ Custom Keybinding Manager in Studio
- **Status:** Under Consideration
- **Estimated Effort:** ~1–2 hours
- **Concept:**
  - While keys `1`–`9` are already mapped to expressions, allow streamers to customize their hotkeys (e.g. mapping `C` or `Space` to calibrate, or custom modifier keys `Ctrl+Shift+E`).
  - Saved in the user's OS `settings.json`.

