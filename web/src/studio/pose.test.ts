import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractEulerAngles } from "./pose.ts";

describe("Pose & Euler Angle Extraction", () => {
  test("returns zero angles for null, undefined, or empty matrix", () => {
    assert.deepEqual(extractEulerAngles(null), { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 });
    assert.deepEqual(extractEulerAngles([]), { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 });
  });

  test("extracts identity matrix as zero rotation", () => {
    // 4x4 identity matrix (column-major)
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
    const angles = extractEulerAngles(identity);
    assert.equal(Math.round(angles.yaw), 0);
    assert.equal(Math.round(angles.pitch), 0);
    assert.equal(Math.round(angles.roll), 0);
  });

  test("extracts translation components from matrix", () => {
    const mat = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      12.5, -4.2, 55.0, 1
    ];
    const angles = extractEulerAngles(mat);
    assert.equal(angles.x, 12.5);
    assert.equal(angles.y, -4.2);
    assert.equal(angles.z, 55.0);
  });
});
