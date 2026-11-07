import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVersionTag,
  formatUpdateBadgeText,
  formatAssetSize,
  formatInstallModeLabel,
  computeDownloadPercent,
} from "./updater.ts";

describe("Studio Self-Updater Helpers", () => {
  test("normalizeVersionTag and formatUpdateBadgeText format version strings consistently", () => {
    assert.equal(normalizeVersionTag("0.0.9"), "v0.0.9");
    assert.equal(normalizeVersionTag("v0.0.9"), "v0.0.9");
    assert.equal(normalizeVersionTag(""), "v0.0.9");
    assert.equal(formatUpdateBadgeText("0.0.9"), "⬆ Update v0.0.9");
  });

  test("formatAssetSize formats bytes into human-readable units", () => {
    assert.equal(formatAssetSize(0), "Unknown size");
    assert.equal(formatAssetSize(undefined), "Unknown size");
    assert.equal(formatAssetSize(512), "512 B");
    assert.equal(formatAssetSize(2048), "2 KB");
    assert.equal(formatAssetSize(15 * 1024 * 1024), "15.0 MB");
  });

  test("formatInstallModeLabel maps install modes to descriptive labels", () => {
    assert.equal(
      formatInstallModeLabel("installed_windows"),
      "Windows Setup Installer (Silent Upgrade)"
    );
    assert.equal(
      formatInstallModeLabel("portable_windows"),
      "Portable Binary (Atomic Swap)"
    );
    assert.equal(
      formatInstallModeLabel("portable_unix"),
      "Portable Archive (Atomic Swap)"
    );
  });

  test("computeDownloadPercent calculates clamped percentage", () => {
    assert.equal(computeDownloadPercent(0, 1000), 0);
    assert.equal(computeDownloadPercent(250, 1000), 25);
    assert.equal(computeDownloadPercent(1500, 1000), 100);
    assert.equal(computeDownloadPercent(100, 0), 0);
  });
});
