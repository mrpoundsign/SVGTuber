# OBS Studio Setup & Streaming Guide

This guide walks you through setting up SVGTuber as a transparent, GPU-accelerated Browser Source in OBS Studio, configuring audio and lip-sync, and optimizing performance.

---

## 🚀 Quick Setup (3 Minutes)

### 1. Add Browser Source to OBS
1. Open OBS Studio.
2. In the **Sources** dock of your active scene, click **`+`** and choose **Browser**.
3. Name it `SVGTuber Avatar` (or your character's name) and click **OK**.

### 2. Configure Source Properties
Set the following properties in the Browser Source window:

| Property | Value | Why |
|---|---|---|
| **URL** | `http://localhost:7420/overlay` | SVGTuber OBS overlay endpoint |
| **Width** | `1920` (or `1080`) | Match your canvas or desired avatar bounding box |
| **Height** | `1080` (or `1080`) | Match your canvas or desired avatar bounding box |
| **Custom Frame Rate** | ☑️ Checked (`60` FPS) | Ensures smooth 60 FPS vector animation |
| **Control audio via OBS** | ⬜ Unchecked | Audio is captured via Studio Web Audio |
| **Custom CSS** | Leave default (`rgba(0,0,0,0)`) | Transparent canvas background |
| **Shutdown source when not visible** | ❌ **UNCHECK** | Prevents WebSocket disconnects when toggling scene sources |
| **Refresh browser when scene becomes active** | ❌ **UNCHECK** | Prevents flickering and reloading when switching scenes |

> [!IMPORTANT]
> **Keep both "Shutdown source when not visible" and "Refresh browser when scene becomes active" UNCHECKED.**
> When unchecked, OBS keeps the avatar connection alive silently in the background, allowing instant zero-latency scene transitions.

---

## ⚡ Performance & Hardware Acceleration

SVGTuber renders directly inside the OBS Chromium Embedded Framework (CEF) with full GPU acceleration. Unlike heavy 3D VTuber applications (Unity, VTube Studio, Warudo), vector DOM rendering consumes negligible CPU (<1%).

To ensure GPU acceleration is enabled in OBS:
1. Open OBS Studio **Settings** (`File -> Settings` or bottom-right button).
2. Go to **Advanced** on the left menu.
3. Under the **Sources** section, verify that **Enable Browser Source Hardware Acceleration** is **checked**.
4. Restart OBS if prompted.

---

## 🎨 Transparency & Positioning Tips

- **True Alpha Transparency**: SVGTuber outputs pure transparent backgrounds. You **never** need to add a Chroma Key or Color Key filter.
- **Resizing & Positioning**:
  - Drag the red bounding box handles to resize the avatar without losing quality—vector graphics scale infinitely crisp at any resolution (even 4K/8K).
  - Press `Ctrl + F` (Windows/Linux) or `Cmd + F` (macOS) to center and fit the avatar to your canvas.
  - Hold `Alt` and drag bounding box edges to crop the source boundaries tightly around your avatar.

---

## 🎙️ Audio Lip-Sync & Streamer Modes

SVGTuber supports three operation modes configured in the Studio dashboard (`http://localhost:7420/studio`):

### 1. Hybrid Mode (Recommended for Webcam Streamers)
- **Webcam** tracks 3D head rotation (`yaw`, `pitch`, `roll`), eye gaze, blinks, and subtle brow movements.
- **Microphone** drives mouth opening volume and energetic voice hopping with squash-and-stretch (`[Bounce]`).
- **Advantage**: Perfect lip-sync timing without webcam mouth latency or lighting artifacts.

### 2. Audio-Only / PNGTuber Mode (No Webcam Required)
- Toggle the camera off in Studio.
- Microphone audio triggers talking mouth states and voice hopping.
- Built-in autonomous life features keep your character moving naturally:
  - **Auto-Blink**: Realistic natural blinks with random intervals (`1.5s`–`8.0s`).
  - **Auto-Gaze**: Subtle micro-dart saccades preventing a static stare.
  - **Auto-Tilt**: Gentle breathing posture sway and occasional natural head tilts.

### 3. Noise Gate & Mic Tuning
In the Studio **Audio Calibration & Lip-Sync** card:
- **Mic Gain**: Multiplier for quiet microphones.
- **Noise Gate**: Adjust the yellow gate marker on the live VU meter just above background room noise and mechanical keyboard clicks so keystrokes don't trigger talking mouth states.
- **Voice Bounce**: Adjust the bounce height multiplier (`0.0x` = stationary, `1.0x` = standard, `2.0x` = high energy).

---

## 🎮 Stream Deck & Hotkeys

- **In-Studio Hotkeys**: While the Studio browser tab is open, press number keys **`1` through `9`** to toggle expressions (e.g. blush, sweat, tears).
- **Elgato Stream Deck / Touch Portal**:
  1. In the Studio **Expressions & Hotkeys** card, click the 📋 **Copy URL** icon next to any expression.
  2. In the Stream Deck software, add an **HTTP Request** or **Website** button.
  3. Set the method to `POST` and paste the URL:
     ```text
     POST http://localhost:7420/api/expressions/toggle?name=blush
     ```
  4. See the [Stream Deck API Reference](../README.md#stream-deck--touch-portal-integration) for additional actions like outfit swapping and instant calibration.

---

## 🔄 Live Art & Rig Editing Mid-Stream

SVGTuber includes continuous `fsnotify` file watching:
- You can keep OBS live, open your avatar SVG in **Inkscape** or **Adobe Illustrator**, modify artwork or tune rig directive parameters (e.g. adjust `[Physics {stiffness: ...}]`), and save (`Ctrl + S`).
- The OBS overlay hot-reloads the updated vector DOM immediately without flashing white, losing your pose, or interrupting your broadcast.

---

## ❓ Frequently Asked Questions

### The avatar doesn't appear in OBS (blank / transparent)
1. Check that the SVGTuber server is running in terminal.
2. Test opening `http://localhost:7420/overlay` directly in your normal web browser (Chrome/Edge/Firefox). If it displays there, right-click the OBS Browser Source and choose **Refresh**.
3. Verify that the URL is spelled correctly: `http://localhost:7420/overlay`.

### The avatar is cut off or zoomed in
- In OBS, right-click the browser source -> **Transform** -> **Fit to screen** (`Ctrl + F`).
- In Inkscape, ensure your artwork fits inside the document page boundary and that your SVG `<svg>` root has a valid `viewBox="0 0 W H"` attribute.

### How do I run multiple avatars or instances?
- You can specify a different port when launching:
  ```bash
  ./build/svgtuber -port 7421 -avatar path/to/second_avatar.svg
  ```
  Then in OBS, add a browser source pointing to `http://localhost:7421/overlay`.
