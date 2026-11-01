/**
 * Pure state helpers and types for Studio Mode Sidebar navigation (Concept B),
 * Top-Bar Streamer Mode privacy shield, and Face Auto-Crop camera framing.
 */

export type StudioMode = "live" | "wardrobe" | "tuning";

export const VALID_STUDIO_MODES: readonly StudioMode[] = [
  "live",
  "wardrobe",
  "tuning",
];

export type TuningTab = "mouth-audio" | "eyes-head" | "life-physics";

export const VALID_TUNING_TABS: readonly TuningTab[] = [
  "mouth-audio",
  "eyes-head",
  "life-physics",
];

/**
 * Normalizes a persisted or user-supplied mode string to a valid StudioMode.
 * Legacy "automations" mode automatically maps to the unified "tuning" mode.
 * Defaults to "live" when empty or unrecognized.
 */
export function normalizeStudioMode(raw: string | null | undefined): StudioMode {
  const cleaned = (raw || "").trim().toLowerCase();
  if (cleaned === "automations") {
    return "tuning";
  }
  if ((VALID_STUDIO_MODES as readonly string[]).includes(cleaned)) {
    return cleaned as StudioMode;
  }
  return "live";
}

/**
 * Normalizes a persisted or user-supplied tuning sub-tab string.
 * Defaults to "mouth-audio" when empty or unrecognized.
 */
export function normalizeTuningTab(raw: string | null | undefined): TuningTab {
  const cleaned = (raw || "").trim().toLowerCase();
  if ((VALID_TUNING_TABS as readonly string[]).includes(cleaned)) {
    return cleaned as TuningTab;
  }
  return "mouth-audio";
}

/**
 * Parses a persisted Streamer Mode value from localStorage.
 */
export function parseStreamerMode(raw: string | null | undefined): boolean {
  const cleaned = (raw || "").trim().toLowerCase();
  return cleaned === "true" || cleaned === "1" || cleaned === "on";
}

/**
 * Formats the label, tooltip, and active state for the Top-Bar Streamer Mode toggle button.
 */
export function formatStreamerModeButtonState(enabled: boolean): {
  text: string;
  title: string;
  activeClass: boolean;
} {
  if (enabled) {
    return {
      text: "🛡️ Streamer Mode: ON",
      title:
        "Streamer Mode is ON (Webcam video, URLs, ports, webhook links, and local file paths are hidden). Click to turn OFF.",
      activeClass: true,
    };
  }
  return {
    text: "🛡️ Streamer Mode: OFF",
    title:
      "Turn ON Streamer Mode to hide your raw webcam feed, local file paths, server ports, and webhook URLs on stream.",
    activeClass: false,
  };
}

/**
 * Masks the OBS Overlay URL when Streamer Mode is active while preserving the underlying URL for clipboard copy.
 */
export function maskOverlayUrl(url: string, streamerMode: boolean): string {
  if (streamerMode) {
    return "••••••••••••••••••••••••";
  }
  return url || "http://localhost:7420/overlay";
}

/**
 * Masks sensitive local filesystem paths (containing OS usernames) when Streamer Mode is active.
 */
export function maskSensitivePath(
  pathStr: string,
  streamerMode: boolean,
  prefix = ""
): string {
  if (!pathStr) {
    return "";
  }
  if (streamerMode) {
    return `${prefix}[Path Hidden in Streamer Mode]`;
  }
  return `${prefix}${pathStr}`;
}

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface FaceCropState {
  cx: number;
  cy: number;
  scale: number;
  boxW: number;
  boxH: number;
}

/**
 * Computes a smoothed face bounding box center, dimensions, and zoom factor
 * from normalized MediaPipe face landmarks (`[0, 1]` in intrinsic video space).
 *
 * Why `object-fit: cover` broke vertical tracking previously:
 * When a 4:3 (640x480) `<video>` was stretched across an ultra-wide container
 * with `object-fit: cover`, the browser cropped ~60% of the top and bottom of
 * the video *before* CSS transforms were applied! Moving your head up or down
 * pushed your face into the browser's `object-fit: cover` clip region, where
 * no CSS `translate()` could ever bring it back into view.
 *
 * Instead, we render the video/canvas in an explicit camera-aspect stage inside
 * a portrait-proportioned face viewport, and translate by `(0.5 - cx, 0.5 - cy)`
 * of the uncropped intrinsic frame.
 */
export function computeFaceCropTransform(
  landmarks: readonly NormalizedLandmark[] | null | undefined,
  prev: FaceCropState | null = null,
  smoothing = 0.28
): { state: FaceCropState; cssTransform: string } {
  const defaultState: FaceCropState = {
    cx: 0.5,
    cy: 0.5,
    scale: 1.0,
    boxW: 0.4,
    boxH: 0.5,
  };
  if (!landmarks || landmarks.length === 0) {
    const base = prev
      ? {
          cx: prev.cx + (0.5 - prev.cx) * smoothing,
          cy: prev.cy + (0.5 - prev.cy) * smoothing,
          scale: prev.scale + (1.0 - prev.scale) * smoothing,
          boxW: prev.boxW + (0.4 - prev.boxW) * smoothing,
          boxH: prev.boxH + (0.5 - prev.boxH) * smoothing,
        }
      : defaultState;
    return {
      state: base,
      cssTransform: formatMirroredCropCss(base),
    };
  }

  let minX = 1.0;
  let maxX = 0.0;
  let minY = 1.0;
  let maxY = 0.0;

  for (let i = 0; i < landmarks.length; i++) {
    const pt = landmarks[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  // Allow tracking across virtually the entire sensor frame [0.05, 0.95]
  const rawCx = Math.max(0.05, Math.min(0.95, (minX + maxX) * 0.5));
  const rawCy = Math.max(0.05, Math.min(0.95, (minY + maxY) * 0.5));
  const rawBoxW = Math.max(0.08, Math.min(1.0, maxX - minX));
  const rawBoxH = Math.max(0.1, Math.min(1.0, maxY - minY));
  const boxSpan = Math.max(rawBoxW, rawBoxH, 0.12);

  // Target face to fill ~68% of the portrait viewport, clamped to [1.2x, 2.8x]
  const rawScale = Math.max(1.2, Math.min(2.8, 0.68 / boxSpan));

  const alpha = Math.max(0.01, Math.min(1.0, smoothing));
  const next: FaceCropState = prev
    ? {
        cx: prev.cx + (rawCx - prev.cx) * alpha,
        cy: prev.cy + (rawCy - prev.cy) * alpha,
        scale: prev.scale + (rawScale - prev.scale) * alpha,
        boxW: prev.boxW + (rawBoxW - prev.boxW) * alpha,
        boxH: prev.boxH + (rawBoxH - prev.boxH) * alpha,
      }
    : {
        cx: rawCx,
        cy: rawCy,
        scale: rawScale,
        boxW: rawBoxW,
        boxH: rawBoxH,
      };

  return {
    state: next,
    cssTransform: formatMirroredCropCss(next),
  };
}

function formatMirroredCropCss(state: FaceCropState): string {
  // Video & canvas have transform-origin: center center and are mirrored horizontally (scaleX(-s)).
  // In scale(-s, s) local space:
  // - local +X points LEFT on screen, so shifting point cx to center (0.5) requires tx = (0.5 - cx) * 100%
  // - local +Y points DOWN on screen, so shifting point cy to center (0.5) requires ty = (0.5 - cy) * 100%
  const txPct = (0.5 - state.cx) * 100;
  const tyPct = (0.5 - state.cy) * 100;
  const s = Number(state.scale.toFixed(3));
  const tx = Number(txPct.toFixed(2));
  const ty = Number(tyPct.toFixed(2));
  return `scale(${-s}, ${s}) translate(${tx}%, ${ty}%)`;
}
