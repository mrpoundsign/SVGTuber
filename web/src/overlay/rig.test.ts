import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePivot,
  computeMouthExclusivity,
  computeEyeExclusivity,
  compute25DPerspective,
  formatPivotScaleSkewTransform,
} from "./rig.ts";

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

  test("compute25DPerspective foreshortens head and scales near/far features asymmetrically", () => {
    // Disabled (amount = 0 and no explicit params): returns identity
    const off = compute25DPerspective({
      headYaw: 25,
      headPitch: 15,
      sideOffset: 0.6,
      amount: 0,
    });
    assert.equal(off.sx, 1);
    assert.equal(off.sy, 1);
    assert.equal(off.skewX, 0);
    assert.equal(off.skewY, 0);

    // Head root foreshortening at +25 deg yaw and +15 deg pitch (level center pivot, no forehead-overhang skewX)
    const head = compute25DPerspective({
      headYaw: 25,
      headPitch: 15,
      partRole: "head_root",
      isHeadRoot: true,
      amount: 1.0,
    });
    assert.ok(head.sx < 1.0 && head.sx > 0.90, `expected head.sx foreshortened, got ${head.sx}`);
    assert.ok(head.sy < 1.0 && head.sy > 0.92, `expected head.sy foreshortened, got ${head.sy}`);
    assert.equal(head.skewX, 0, `expected zero skewX on head_root to avoid downward forehead overhang, got ${head.skewX}`);
    assert.ok(head.skewY < 0, `expected negative diagonal skewY, got ${head.skewY}`);
    assert.ok(head.extraTx < 0, `expected negative extraTx to keep head centered over neck, got ${head.extraTx}`);
    assert.equal(head.extraTy, 0, `expected zero extraTy so head_root does not oppose upward pitch, got ${head.extraTy}`);

    // Attached ear/horn has zero extraTx/extraTy so its skull attachment pivot never detaches,
    // stays level on pure yaw (pitch = 0), and counter-tilts via skewY on pitch
    const farEarLevel = compute25DPerspective({
      headYaw: 25,
      headPitch: 0,
      sideOffset: 0.9,
      partRole: "ear_or_horn",
      amount: 1.0,
    });
    assert.equal(farEarLevel.extraTx, 0);
    assert.equal(farEarLevel.extraTy, 0);
    assert.equal(farEarLevel.skewY, 0);
    assert.ok(farEarLevel.sx < 0.92, `expected farEarLevel.sx < 0.92, got ${farEarLevel.sx}`);

    const farEarPitchUp = compute25DPerspective({
      headYaw: 25,
      headPitch: -15,
      sideOffset: 0.9,
      partRole: "ear_or_horn",
      amount: 1.0,
    });
    assert.ok(farEarPitchUp.skewY > 0, `expected positive skewY on right ear when pitching up (-15 deg), got ${farEarPitchUp.skewY}`);

    // Snout / mouth panel (face_dist) foreshortens without flapping (skewX = 0) or seesaw tilting (skewY = 0)
    // and lifts subtly along the jaw curve on pure yaw
    const snoutTurn = compute25DPerspective({
      headYaw: 25,
      headPitch: 0,
      partRole: "face_dist",
      distFactor: 0.14,
      amount: 1.0,
    });
    assert.equal(snoutTurn.skewX, 0);
    assert.equal(snoutTurn.skewY, 0);
    assert.ok(snoutTurn.sx < 1.0 && snoutTurn.sx > 0.90, `expected snoutTurn.sx foreshortened, got ${snoutTurn.sx}`);
    assert.ok(snoutTurn.extraTy < 0, `expected slight upward jaw-curve lift on pure yaw, got ${snoutTurn.extraTy}`);

    // Turning right (+25 deg): right-on-screen eye (sideOffset = +0.6) compresses more than left-on-screen (sideOffset = -0.6)
    const farEye = compute25DPerspective({
      headYaw: 25,
      headPitch: 0,
      sideOffset: 0.6,
      partRole: "face_feature",
      amount: 1.0,
    });
    const nearEye = compute25DPerspective({
      headYaw: 25,
      headPitch: 0,
      sideOffset: -0.6,
      partRole: "face_feature",
      amount: 1.0,
    });
    assert.ok(farEye.sx < 0.94, `expected farEye.sx < 0.94, got ${farEye.sx}`);
    assert.ok(nearEye.sx > farEye.sx, `expected nearEye.sx (${nearEye.sx}) > farEye.sx (${farEye.sx})`);
    assert.ok(farEye.extraTx > 0, `expected facial feature to wrap right with yaw, got ${farEye.extraTx}`);
    assert.equal(farEye.skewY, 0, `expected zero vertical seesaw skewY on pure horizontal yaw, got ${farEye.skewY}`);
  });

  test("formatPivotScaleSkewTransform wraps skew and scale in a single pivot block", () => {
    assert.equal(formatPivotScaleSkewTransform(1, 1, 0, 0, 130, 110), "");
    assert.equal(
      formatPivotScaleSkewTransform(0.92, 1.0, 4.5, -2.0, 130, 110),
      "translate(130.00, 110.00) skewX(4.50) skewY(-2.00) scale(0.9200, 1.0000) translate(-130.00, -110.00)"
    );
  });
});
