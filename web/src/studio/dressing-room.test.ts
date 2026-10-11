import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nudgePosition,
  nudgeRotation,
  computeLinkedScale,
  formatFittingMirrorUrl,
} from "./dressing-room.ts";

describe("Dressing Room Modal Logic", () => {
  test("nudgePosition shifts coordinates by delta * step", () => {
    // Step 1: Up (dy = -1)
    assert.deepEqual(nudgePosition(10, 20, 0, -1, 1), { x: 10, y: 19 });
    // Step 5: Right (dx = +1)
    assert.deepEqual(nudgePosition(10, 20, 1, 0, 5), { x: 15, y: 20 });
    // Step 10: Down-Left (dx = -1, dy = 1)
    assert.deepEqual(nudgePosition(10, 20, -1, 1, 10), { x: 0, y: 30 });
  });

  test("nudgeRotation wraps within [-180, 180] degrees", () => {
    assert.equal(nudgeRotation(0, 45), 45);
    assert.equal(nudgeRotation(170, 20), -170); // 190 -> -170
    assert.equal(nudgeRotation(-170, -20), 170); // -190 -> 170
  });

  test("computeLinkedScale links scaleX and scaleY when linked", () => {
    const linked = computeLinkedScale(1.5, true, "x", 1.0, 1.0);
    assert.deepEqual(linked, { scaleX: 1.5, scaleY: 1.5 });

    const unlinkedX = computeLinkedScale(2.0, false, "x", 1.0, 1.0);
    assert.deepEqual(unlinkedX, { scaleX: 2.0, scaleY: 1.0 });

    const unlinkedY = computeLinkedScale(0.8, false, "y", 1.0, 1.0);
    assert.deepEqual(unlinkedY, { scaleX: 1.0, scaleY: 0.8 });
  });

  test("formatFittingMirrorUrl adds freeze query param when frozen", () => {
    const frozenUrl = formatFittingMirrorUrl(true);
    assert.ok(frozenUrl.includes("freeze=1"));

    const liveUrl = formatFittingMirrorUrl(false);
    assert.ok(!liveUrl.includes("freeze=1"));
  });
});
