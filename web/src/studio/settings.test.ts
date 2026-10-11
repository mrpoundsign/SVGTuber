import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultSettings,
  mergeSettings,
  createDebouncedSaver,
  type SettingsPayload,
} from "./settings.ts";

describe("Settings Management", () => {
  test("createDefaultSettings provides expected tracking and audio defaults", () => {
    const defaults = createDefaultSettings();
    assert.equal(defaults.version, 1);
    assert.equal(defaults.tracking.mouthGain, 1.4);
    assert.equal(defaults.tracking.autoBlink, true);
    assert.equal(defaults.tracking.autoBlinkMode, "always");
    assert.equal(defaults.audio.mode, "hybrid");
    assert.equal(defaults.audio.micGain, 1.5);
  });

  test("mergeSettings cleanly overrides specified sub-fields", () => {
    const base = createDefaultSettings();
    const merged = mergeSettings(base, {
      tracking: {
        ...base.tracking,
        autoBlinkIntervalSec: 6.5,
        physicsAmount: 0.5,
      },
      audio: {
        ...base.audio,
        mode: "camera",
      },
    });

    assert.equal(merged.tracking.autoBlinkIntervalSec, 6.5);
    assert.equal(merged.tracking.physicsAmount, 0.5);
    // Unmodified fields preserved
    assert.equal(merged.tracking.mouthGain, 1.4);
    assert.equal(merged.audio.mode, "camera");
  });

  test("createDebouncedSaver debounces rapid updates", async () => {
    let callCount = 0;
    let lastSaved: SettingsPayload | null = null;
    const saveFn = async (s: SettingsPayload) => {
      callCount++;
      lastSaved = s;
    };

    const debouncedSave = createDebouncedSaver(saveFn, 20);
    const s1 = createDefaultSettings();
    const s2 = { ...s1, audio: { ...s1.audio, micGain: 2.0 } };
    const s3 = { ...s1, audio: { ...s1.audio, micGain: 3.0 } };

    debouncedSave(s1);
    debouncedSave(s2);
    debouncedSave(s3);

    assert.equal(callCount, 0); // Not called synchronously

    await new Promise((res) => setTimeout(res, 50));

    assert.equal(callCount, 1); // Only called once
    assert.ok(lastSaved !== null);
    assert.equal((lastSaved as SettingsPayload).audio.micGain, 3.0);
  });
});
