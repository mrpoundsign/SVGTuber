# Changelog

All notable user-facing changes to **SVGTuber** are documented in this file.

---

## [v0.0.8] — 2026-10-31

### 🖥️ Desktop Control Window & Live Connection Monitor
- **Native Desktop Companion Window**: Launching `svgtuber` now opens a compact desktop control window (with no background terminal pop-up on Windows) featuring one-click **Open Studio Control Page**, **Copy OBS Overlay URL**, **Open Overlay**, configurable **Server Port**, and **Avatar Workspace** controls.
- **Live Connected Studios & Overlays**: Real-time indicators show the exact number of connected Studio tabs (`🟢 Connected Studios`) and external OBS/browser overlays (`🟢 Connected Overlays`).
- **Persistent Activity Log (`svgtuber.log`)**: Tracks live server log entry counts and latest events in real time with one-click **Open Log File** and **Open Log Folder** buttons.
- **Built-In Verified Self-Updater**: Check GitHub Releases and apply SHA-256 verified updates directly from the desktop window, Web Studio header, or CLI (`svgtuber -update`).

### 🎛️ Focused 3-Mode Web Studio & Face Auto-Zoom
- **Three Zero-Scroll Studio Workspaces**:
  - **🎥 Live Stage (Stream)**: Side-by-side Face Tracker and Live Avatar Stage above a full-width Expressions (`1`–`9`) & Equipped Accessories deck.
  - **🎀 Wardrobe & Props**: Live Avatar Stage paired directly with the Accessories & Props Closet and interactive Dressing Room.
  - **🎛️ Calibration & Life**: Always-visible Face Tracker, Live Avatar Stage, compact Live Telemetry Gauges, and tabbed calibration controls (**👄 Mouth & Audio**, **👀 Eyes & Head**, **✨ Idle Life & Physics**).
- **Camera Face Auto-Zoom (`🔍 Auto-Zoom: ON/OFF`)**: Automatically centers and zooms the webcam and 478-point MediaPipe landmark mesh onto your detected face across the full vertical and horizontal range.

### 🛡️ Streamer Mode Privacy Shield
- **One-Click Stream Privacy (`🛡️ Streamer Mode`)**: Synchronized across both the Desktop Control Window and Web Studio—hides raw webcam video (keeping the 478-point face mesh visible) and redacts OBS URLs, server ports, and local file paths when sharing your screen on stream.

### 📦 Windows Setup Installer (`SVGTuber-Setup.exe`) & Stream Deck Plugin
- **Guided Windows Setup Wizard (`SVGTuber-Setup.exe`)**: Installs `svgtuber.exe`, creates Start Menu & Desktop shortcuts, registers `svgtuber` in your user `PATH`, creates a starter `Documents\SVGTuber\` workspace, and supports Repair and clean Uninstall.
- **Elgato Stream Deck Plugin Version Detection**: Detects the installed version of `com.github.mrpoundsign.svgtuber.sdPlugin` and dynamically offers to **Install**, **Update**, or **Reinstall** from the desktop window.

---

## [v0.0.7] — 2026-10-28

### 🤖 AI Rigging Assistant & MCP Mode (`svgtuber -mcp`)
- **One-Binary MCP Support**: Launch SVGTuber directly as an AI rigging assistant for Claude Desktop, Cursor, or Antigravity using `svgtuber -mcp` (matching the ArtCraft toolset convention).
- **One-Click Auto-Rigging**: Automatically rig entire SVG characters—including head turns, neck follow, eye blinking, pupil tracking, independent eyebrows, ear/horn sway, and talking mouths—in a single command (`svgtuber_auto_rig`).
- **Interactive Studio Preview Widget**: Generate a standalone, zero-scroll HTML Studio Widget (`svgtuber_generate_studio_widget`) to test every slider (Head Yaw/Pitch/Roll, Mouth Open, Smile, Eye Gaze, Left/Right Blink, Left/Right Eyebrow) and expression button right in your browser before going live on stream.
- **Built-in Rig Health Checker**: Automatically catch and repair common SVG rigging issues like detached limbs, missing pivot points, or Illustrator/Vectorcraft CSS quirks (`svgtuber_validate_rig` and `svgtuber_clean_svg`).
- **Built-in Rigging Guides**: AI assistants connected to `svgtuber -mcp` automatically receive the Universal Layer Naming Convention and step-by-step rigging instructions on startup, and you can read the full guide in [`docs/MCP_GUIDE.md`](docs/MCP_GUIDE.md).

### 🤨 Independent Left & Right Eyebrow Tracking (`browL` & `browR`)
- **Expressive Eyebrows on Stream**: Raise one eyebrow, raise both in surprise, or furrow your brows! SVGTuber now tracks your **Left** and **Right** eyebrows independently (`browL` and `browR`) across the Studio tracker and OBS overlay.
- **Live Studio Eyebrow Meters & Sensitivity Slider**: Added live **Brow Left** and **Brow Right** meters under *Facial Blendshapes* and a new **Eyebrow Range** sensitivity slider (`0.0x`–`3.0x`) under *Eyes & Head Pose* in the Studio dashboard.
- **Neutral Pose Calibration**: Clicking **Set Neutral Pose** now calibrates your resting eyebrow position alongside your head angle, mouth, and smile.

### 🎨 New Ready-to-Use Sample Avatars
- **Cow Avatar (`testdata/cow_avatar.svg`)**: Expressive chibi cow character with ear and horn sway, ringing cowbell physics, independent winking and eyebrow movement, and a chewing cud expression.
- **Retro TV Robot Avatar (`testdata/robot_avatar.svg`)**: CRT-screen robot with glowing cyan eyes, bobbing spring antenna, independent eyebrows, and a `100% NOT AI` badge.
- **Triangle Mecha Robot Avatar (`testdata/triangle_robot_avatar.svg`)**: Sleek inverted-triangle synth-bot with dual glowing antennae, hydraulic neck pistons, and independent LED eyes and brows.

---

## [v0.0.6] — 2026-10-12

### 🔒 Multi-Tab Session Lock & Jitter Prevention
- **Eliminated Multi-Tab Jitter**: Opening multiple Studio tabs at once no longer causes competing camera streams to vibrate your avatar. SVGTuber automatically locks tracking to a single active tab.
- **Take Over Tracking Button**: Secondary Studio tabs display a clear banner with a one-click **Take Over Tracking** button to switch control seamlessly.

### 📷 Camera & Avatar Switcher Improvements
- **Automatic Camera Shutdown in Audio-Only Mode**: Switching to **Audio Only** mode immediately turns off your webcam and releases camera hardware for privacy and lower CPU usage.
- **Cleaner Avatar Dropdown**: Accessory SVG files inside `accessories/` are automatically hidden from the main Avatar Switcher list.

---

## [v0.0.5] — 2026-10-12

### 👁️ Independent Eye Blinking, Winking & Gaze Polish
- **Left & Right Eye Threshold Sliders**: Tune left and right eye blink sensitivity independently in Studio, with a **Blink Sync Delay** slider (`0–150ms`) for natural bilateral blinks and clean intentional winks.
- **Wink-is-Blink Accessibility Toggle**: Optional **Mirror Eyes** toggle so winking either eye triggers a clean full blink on both eyes.
- **Natural Mirrored Pupil Gaze**: Looking left or right moves your avatar's pupils in the matching screen direction like a natural mirror.

---

## [v0.0.4] — 2026-10-11

### 🪞 Modular Accessories Closet & Interactive Dressing Room
- **Attach Props to Any Avatar**: Drop standalone SVG props (like `sunglasses.svg`, `cat_ears.svg`, or `sweat_drop.svg`) into an `accessories/` folder and equip them on any avatar without editing the main character file.
- **Live Dressing Room Mirror**: Position, scale, stretch, rotate, and layer accessories in front of or behind your avatar with a live zoomed mirror, pixel nudge D-pad, and Rest Pose toggle.
- **Per-Avatar Accessory Presets**: Equipped accessories and their exact placements are saved automatically per avatar.

---

## [v0.0.3] — 2026-10-10

### ✨ Expressive Directives, Hair Physics & Autonomous Life
- **Spring & Pendulum Hair Physics (`[Sway]`, `[Physics]`, `[Chain]`)**: Lifelike secondary motion and multi-segment chain whip for hair bangs, ponytails, animal ears, ribbons, and tails.
- **Voice-Reactive Bounce (`[Bounce]`)**: Energetic audio-driven hop and squash-and-stretch when speaking.
- **Autonomous Idle Life**: Configurable **Auto-Blink**, **Auto-Gaze** (subtle pupil micro-glances), and **Auto-Tilt** (gentle breathing sway) keep your avatar alive even when the camera is off.
- **Studio Hotkeys (`1`–`9`) & Stream Deck Webhooks**: Toggle custom expressions (`isBlush`, `isSweat`, etc.) with number keys or HTTP webhook URLs.
