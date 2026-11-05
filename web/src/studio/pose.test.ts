import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractEulerAngles,
  estimatePoseFromLandmarks,
  computeEyeAspectRatios,
  computeMouthGeometry,
  evaluateOpticalTongue,
  type Landmark3D,
} from "./pose.ts";

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

  test("computes 3D mouth corner droop for frown detection and optical tongue evaluation", () => {
    const landmarks: Landmark3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[33] = { x: 0.35, y: 0.40, z: 0 };
    landmarks[263] = { x: 0.65, y: 0.40, z: 0 };
    landmarks[13] = { x: 0.50, y: 0.69, z: 0 };
    landmarks[14] = { x: 0.50, y: 0.71, z: 0 };
    // Frowning mouth corners pulled down relative to lip center (y = 0.708 vs 0.700, width = 0.20 -> drop = 0.04)
    landmarks[61] = { x: 0.40, y: 0.710, z: 0 };
    landmarks[291] = { x: 0.60, y: 0.710, z: 0 };

    const geo = computeMouthGeometry(landmarks);
    assert.ok(geo);
    assert.ok(geo.geoFrownLeft > 0.35);
    assert.ok(geo.geoFrownRight > 0.35);

    // Dark oral cavity (normal open mouth) -> 0 tongue
    assert.equal(
      evaluateOpticalTongue({ r: 35, g: 25, b: 25 }, { r: 190, g: 150, b: 130 }, 0.20, 0.35),
      0
    );
    // Bright pink protruding tongue -> > 0.50 tongue score
    const tongueScore = evaluateOpticalTongue(
      { r: 215, g: 110, b: 120 },
      { r: 190, g: 155, b: 135 },
      0.20,
      0.35
    );
    assert.ok(tongueScore > 0.50);
  });

  test("estimates fallback head yaw and pitch from 3D landmarks when matrix is unavailable", () => {
    assert.equal(estimatePoseFromLandmarks(null), null);
    const landmarks: Landmark3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[33] = { x: 0.40, y: 0.40, z: 0 };
    landmarks[263] = { x: 0.60, y: 0.40, z: 0 };
    landmarks[10] = { x: 0.50, y: 0.25, z: 0 };
    landmarks[152] = { x: 0.50, y: 0.75, z: 0 };
    // Nose shifted toward left eye (user's left) and downward toward chin
    landmarks[1] = { x: 0.56, y: 0.62, z: 0 };

    const est = estimatePoseFromLandmarks(landmarks);
    assert.ok(est);
    assert.ok(est.yaw < -10);
    assert.ok(est.pitch > 10);
  });
});
