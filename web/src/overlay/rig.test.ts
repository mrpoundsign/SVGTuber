import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolvePivot, computeMouthExclusivity, computeEyeExclusivity } from "./rig.ts";

describe("Rig System & Directives Logic", () => {
  const bbox = { x: 100, y: 100, width: 200, height: 100 };

  test("resolvePivot calculates cardinal pivot coordinates", () => {
    // Default center
    assert.deepEqual(resolvePivot(undefined, bbox), { cx: 200, cy: 150 });
    assert.deepEqual(resolvePivot("center", bbox), { cx: 200, cy: 150 });

    // Top
    assert.deepEqual(resolvePivot("top", bbox), { cx: 200, cy: 100 });

    // Bottom
    assert.deepEqual(resolvePivot("bottom", bbox), { cx: 200, cy: 200 });

    // Left
    assert.deepEqual(resolvePivot("left", bbox), { cx: 100, cy: 150 });

    // Right
    assert.deepEqual(resolvePivot("right", bbox), { cx: 300, cy: 150 });

    // Top-left
    assert.deepEqual(resolvePivot("top-left", bbox), { cx: 100, cy: 100 });

    // Explicit coordinate "50, 75"
    assert.deepEqual(resolvePivot("50, 75", bbox), { cx: 50, cy: 75 });
  });

  test("resolvePivot resolves target element bounding box", () => {
    const targetBBoxResolver = (id: string) => {
      if (id === "#target_pivot") {
        return { x: 10, y: 20, width: 40, height: 60 };
      }
      return null;
    };

    assert.deepEqual(
      resolvePivot("#target_pivot", bbox, targetBBoxResolver),
      { cx: 30, cy: 50 }
    );
  });

  test("computeMouthExclusivity ensures mouth states are mutually exclusive", () => {
    // Resting: only neutral is shown
    const resting = computeMouthExclusivity({
      hasNeutral: true,
      hasSmile: true,
      hasOpen: true,
      isOpen: false,
      isSmile: false,
    });
    assert.deepEqual(resting, { showNeutral: true, showSmile: false, showOpen: false });

    // Speaking: open mouth overrides smile and neutral
    const speaking = computeMouthExclusivity({
      hasNeutral: true,
      hasSmile: true,
      hasOpen: true,
      isOpen: true,
      isSmile: true,
    });
    assert.deepEqual(speaking, { showNeutral: false, showSmile: false, showOpen: true });

    // Smiling while closed: smile overrides neutral
    const smiling = computeMouthExclusivity({
      hasNeutral: true,
      hasSmile: true,
      hasOpen: true,
      isOpen: false,
      isSmile: true,
    });
    assert.deepEqual(smiling, { showNeutral: false, showSmile: true, showOpen: false });
  });

  test("computeEyeExclusivity handles independent left and right blinks", () => {
    const winkLeft = computeEyeExclusivity({
      closedL: true,
      closedR: false,
      hasIndependentEyes: true,
    });
    assert.equal(winkLeft.showClosedL, true);
    assert.equal(winkLeft.showOpenL, false);
    assert.equal(winkLeft.showClosedR, false);
    assert.equal(winkLeft.showOpenR, true);
  });
});
