import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractEulerAngles, computeEyeAspectRatios, type Landmark3D } from "./pose.ts";

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

  test("computes 3D landmark Eye Aspect Ratio (EAR) for open and closed eyes", () => {
    assert.equal(computeEyeAspectRatios(null), null);
    assert.equal(computeEyeAspectRatios([]), null);

    const landmarks: Landmark3D[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
    // Left eye wide open (width = 0.10, vertical height = 0.030 -> EAR = 0.30 -> closure = 0)
    landmarks[263] = { x: 0.60, y: 0.40, z: 0 };
    landmarks[362] = { x: 0.70, y: 0.40, z: 0 };
    landmarks[386] = { x: 0.64, y: 0.385, z: 0 };
    landmarks[374] = { x: 0.64, y: 0.415, z: 0 };
    landmarks[385] = { x: 0.66, y: 0.385, z: 0 };
    landmarks[380] = { x: 0.66, y: 0.415, z: 0 };

    // Right eye closed (width = 0.10, vertical height = 0.010 -> EAR = 0.10 -> closure = 1)
    landmarks[33] = { x: 0.30, y: 0.40, z: 0 };
    landmarks[133] = { x: 0.40, y: 0.40, z: 0 };
    landmarks[159] = { x: 0.34, y: 0.395, z: 0 };
    landmarks[145] = { x: 0.34, y: 0.405, z: 0 };
    landmarks[158] = { x: 0.36, y: 0.395, z: 0 };
    landmarks[153] = { x: 0.36, y: 0.405, z: 0 };

    const ear = computeEyeAspectRatios(landmarks);
    assert.ok(ear);
    assert.equal(ear.earBlinkLeft, 0);
    assert.equal(ear.earBlinkRight, 1);
  });
});
