import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_STUDIO_MODES,
  VALID_TUNING_TABS,
  normalizeStudioMode,
  normalizeTuningTab,
  parseStreamerMode,
  formatStreamerModeButtonState,
  maskOverlayUrl,
  maskSensitivePath,
  computeFaceCropTransform,
} from "./studio-modes.ts";

describe("Studio Mode Sidebar & Streamer Mode Helpers", () => {
  test("normalizeStudioMode validates known modes, maps legacy automations to tuning, and defaults to live", () => {
    for (const mode of VALID_STUDIO_MODES) {
      assert.equal(normalizeStudioMode(mode), mode);
      assert.equal(normalizeStudioMode(`  ${mode.toUpperCase()} `), mode);
    }
    assert.equal(normalizeStudioMode("automations"), "tuning");
    assert.equal(normalizeStudioMode(" AUTOMATIONS "), "tuning");
    assert.equal(normalizeStudioMode(""), "live");
    assert.equal(normalizeStudioMode(null), "live");
    assert.equal(normalizeStudioMode(undefined), "live");
    assert.equal(normalizeStudioMode("unknown_tab"), "live");
  });

  test("normalizeTuningTab validates tuning sub-tabs and defaults to mouth-audio", () => {
    for (const tab of VALID_TUNING_TABS) {
      assert.equal(normalizeTuningTab(tab), tab);
      assert.equal(normalizeTuningTab(` ${tab.toUpperCase()} `), tab);
    }
    assert.equal(normalizeTuningTab(""), "mouth-audio");
    assert.equal(normalizeTuningTab(null), "mouth-audio");
    assert.equal(normalizeTuningTab("unknown"), "mouth-audio");
  });

  test("parseStreamerMode parses persisted boolean strings", () => {
    assert.equal(parseStreamerMode("true"), true);
    assert.equal(parseStreamerMode("TRUE"), true);
    assert.equal(parseStreamerMode("1"), true);
    assert.equal(parseStreamerMode("on"), true);
    assert.equal(parseStreamerMode("false"), false);
    assert.equal(parseStreamerMode("0"), false);
    assert.equal(parseStreamerMode(null), false);
    assert.equal(parseStreamerMode(undefined), false);
  });

  test("formatStreamerModeButtonState returns appropriate UI labels and state", () => {
    const offState = formatStreamerModeButtonState(false);
    assert.equal(offState.text, "🛡️ Streamer Mode: OFF");
    assert.equal(offState.activeClass, false);
    assert.ok(offState.title.includes("Turn ON Streamer Mode"));

    const onState = formatStreamerModeButtonState(true);
    assert.equal(onState.text, "🛡️ Streamer Mode: ON");
    assert.equal(onState.activeClass, true);
    assert.ok(onState.title.includes("Streamer Mode is ON"));
  });

  test("maskOverlayUrl masks URL only when streamerMode is true", () => {
    const rawUrl = "http://localhost:7420/overlay";
    assert.equal(maskOverlayUrl(rawUrl, false), rawUrl);
    assert.equal(maskOverlayUrl(rawUrl, true), "••••••••••••••••••••••••");
  });

  test("maskSensitivePath hides local OS file paths when streamerMode is true", () => {
    const winPath = "C:\\Users\\streamer\\Documents\\SVGTuber\\avatars";
    assert.equal(maskSensitivePath(winPath, false, "📁 "), `📁 ${winPath}`);
    assert.equal(
      maskSensitivePath(winPath, true, "📁 "),
      "📁 [Path Hidden in Streamer Mode]"
    );
    assert.equal(maskSensitivePath("", true, "📁 "), "");
  });

  test("computeFaceCropTransform zooms and centers onto detected face landmarks across full vertical range", () => {
    const emptyRes = computeFaceCropTransform(null);
    assert.equal(emptyRes.state.scale, 1.0);
    assert.ok(emptyRes.cssTransform.includes("scale(-1, 1)"));

    const sampleFace = [
      { x: 0.4, y: 0.35 },
      { x: 0.6, y: 0.65 },
    ];
    const cropped = computeFaceCropTransform(sampleFace, null, 1.0);
    assert.ok(cropped.state.scale > 1.5, `Expected zoom > 1.5, got ${cropped.state.scale}`);
    assert.ok(Math.abs(cropped.state.cx - 0.5) < 0.001);
    assert.ok(Math.abs(cropped.state.cy - 0.5) < 0.001);
    assert.ok(cropped.cssTransform.startsWith("scale(-"));

    // Verify face near top of frame (cy = 0.15) produces positive tyPct (+35%) to pull face down into center
    const highFace = [
      { x: 0.4, y: 0.05 },
      { x: 0.6, y: 0.25 },
    ];
    const highCropped = computeFaceCropTransform(highFace, null, 1.0);
    assert.ok(Math.abs(highCropped.state.cy - 0.15) < 0.001);
    assert.ok(
      highCropped.cssTransform.includes("35%)"),
      `Expected +35% vertical translation for high face, got ${highCropped.cssTransform}`
    );

    // Verify face near bottom of frame (cy = 0.85) produces negative tyPct (-35%) to pull face up into center
    const lowFace = [
      { x: 0.4, y: 0.75 },
      { x: 0.6, y: 0.95 },
    ];
    const lowCropped = computeFaceCropTransform(lowFace, null, 1.0);
    assert.ok(Math.abs(lowCropped.state.cy - 0.85) < 0.001);
    assert.ok(
      lowCropped.cssTransform.includes("-35%)"),
      `Expected -35% vertical translation for low face, got ${lowCropped.cssTransform}`
    );
  });
});
