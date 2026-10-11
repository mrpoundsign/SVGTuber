import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  shouldIgnoreHotkey,
  resolveHotkeyIndex,
  toggleLocalExpression,
} from "./expressions.ts";

describe("Studio Expressions & Hotkeys", () => {
  test("shouldIgnoreHotkey ignores input, textarea, and select elements", () => {
    assert.equal(shouldIgnoreHotkey("INPUT"), true);
    assert.equal(shouldIgnoreHotkey("textarea"), true);
    assert.equal(shouldIgnoreHotkey("Select"), true);
    assert.equal(shouldIgnoreHotkey("DIV"), false);
    assert.equal(shouldIgnoreHotkey("BUTTON"), false);
    assert.equal(shouldIgnoreHotkey(null), false);
  });

  test("resolveHotkeyIndex maps keys 1-9 to expression array index", () => {
    const list = ["blush", "cry", "angry", "sparkle"];
    assert.equal(resolveHotkeyIndex("1", list), "blush");
    assert.equal(resolveHotkeyIndex("2", list), "cry");
    assert.equal(resolveHotkeyIndex("4", list), "sparkle");
    assert.equal(resolveHotkeyIndex("5", list), null); // Out of bounds
    assert.equal(resolveHotkeyIndex("a", list), null); // Non-digit
  });

  test("toggleLocalExpression flips boolean active state", () => {
    const initial = { blush: false, tears: true };
    const step1 = toggleLocalExpression(initial, "blush");
    assert.equal(step1.blush, true);
    assert.equal(step1.tears, true);

    const step2 = toggleLocalExpression(step1, "tears");
    assert.equal(step2.tears, false);
  });
});
