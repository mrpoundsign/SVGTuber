# SVGTuber Agent Guidelines

## 1. Core Architecture Principles

1. **Browser Renders the SVG**:
   - The Go backend does **not** rasterize SVGs on the CPU. The client overlay running in OBS CEF renders the vector DOM directly with GPU acceleration.
   - Go is the communication and computation coordinator (hot reload, tracking filtering, calibration, rig parsing).
2. **Pure Go / Zero-CGO**:
   - The Go server must compile cleanly with `CGO_ENABLED=0` across Windows, Linux, and macOS.
   - Do not introduce native C/C++ computer vision or image libraries into the Go backend.
3. **Tracking in Browser / MediaPipe**:
   - Real-time webcam tracking runs in the Studio web page via WebAssembly / WebGL, streaming normalized landmark frames to Go over WebSockets.
4. **IAMS Rig Directive Convention**:
   - Rigging syntax on Inkscape elements follows the `Directive {k: v; ...}` syntax in `inkscape:label`.

---

## 2. Planning Workflow (`planning/`)

- `planning/` is a separate, local-only Git repository (git-ignored by the main SVGTuber repo).
- Never push `planning/` or configure an external remote for it unless explicitly requested by the user.
- Commit to `planning/` after meaningful PRD, architectural, or task updates.

---

## 3. Shell Execution Rule

- **Append `; exit $?` to all `run_command` invocations under WSL** to prevent lingering non-interactive subshell deadlocks.

---

## 4. Verification & Testing

- Always run `go test ./...` and `go vet ./...` before finalizing changes.
- **Do not build the binary**: The user handles all binary building (`go build`, creating `.exe` files, etc.). Do not build binaries or overwrite executables in `build/`.
- **Never modify user config files**: Never modify or overwrite the user's configuration files (`config.json`, `svgtuber.json`, etc.).

