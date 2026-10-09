# SVGTuber

**Real-Time Vector VTuber Engine for Inkscape & OBS Studio**

SVGTuber brings multi-layer vector avatars created in **Inkscape** directly into **OBS Studio** with live webcam face tracking and instantaneous hot-reloading.

Unlike traditional PNGTuber tools that swap static bitmaps, SVGTuber preserves native SVG resolution at any scale, rendering directly in OBS's hardware-accelerated Browser Source.

---

## ✨ Features (Milestone 1)

- **Pure Go Core:** Single zero-dependency binary (`CGO_ENABLED=0`) with embedded web interfaces.
- **OBS Browser Source Ready:** Transparent overlay (`/overlay`) rendering SVGs inline in the DOM.
- **Instant Hot-Reloading:** Uses `fsnotify` with atomic write detection—saving changes in Inkscape updates your avatar on stream instantly.
- **Studio Dashboard:** Web-based control panel (`/studio`) to preview artwork and copy OBS links.

---

## 🚀 Quick Start

### 1. Build & Run
```bash
# Build using the build script:
./build.sh build       # builds build/svgtuber (Linux)
./build.sh windows     # builds build/svgtuber.exe (Windows)

# Run with the sample avatar
./build/svgtuber -avatar testdata/test_avatar.svg
```

### 2. Add to OBS Studio
1. In OBS, add a new **Browser Source**.
2. Set the URL to: `http://localhost:7420/overlay`
3. Set your desired dimensions (e.g. `1080 x 1080` or `1920 x 1080`).
4. Ensure *Shutdown source when not visible* is unchecked for instant scene switches.

---

## 🛠️ CLI Options

| Flag | Default | Description |
|---|---|---|
| `-avatar` | `testdata/test_avatar.svg` | Path to the Inkscape SVG avatar file |
| `-port` | `7420` | HTTP & WebSocket server port |
| `-open-studio` | `false` | Automatically launch Studio in default web browser |
| `-version` | `false` | Print version and build info |

---

## 🗺️ Roadmap & Milestones

See [planning/roadmap.md](planning/roadmap.md) for architecture and roadmap details:
1. **Milestone 1: Server Skeleton & OBS Overlay Core** (Current)
2. **Milestone 2: Web Studio & MediaPipe Face Tracking** (Webcam blendshapes + One-Euro filter)
3. **Milestone 3: Rig Label Directives & Live Vector Animation** (IAMS-style Inkscape labels)
4. **Milestone 4: Audio Lip-Sync & Hybrid Mode** (Mic volume talking triggers)
5. **Milestone 5: Stream Controls, Packaging & Release** (Hotkeys, GoReleaser, docs)

---

## 📄 License

MIT &copy; 2026 mrpoundsign
