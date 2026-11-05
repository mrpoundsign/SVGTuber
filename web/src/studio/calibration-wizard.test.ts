import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeNeutralStep,
  analyzeBeepBlinkStep,
  analyzeHeadTurnStep,
  analyzeVoiceAndSmileStep,
  evaluateCalibrationSubstepActivity,
  fuseBlinkScoreClient,
  remapBlinkClient,
  type CalibrationSample,
} from "./calibration-wizard.ts";

function makeSample(overrides: Partial<CalibrationSample> = {}): CalibrationSample {
  return {
    timestamp: 1000,
    present: true,
    yaw: 0,
    pitch: 0,
    roll: 0,
    x: 0,
    y: 0,
    z: 0,
    blendshapes: {},
    audioVolume: 0.01,
    ...overrides,
  };
}

describe("Guided Calibration Wizard Analyzers", () => {
  test("analyzeNeutralStep captures glasses open-eye floor, prism gaze offset, and mic noise gate", () => {
    const samples: CalibrationSample[] = [
      makeSample({
        timestamp: 100,
        yaw: -5.2,
        pitch: 8.4,
        blendshapes: {
          eyeBlinkLeft: 0.24,
          eyeBlinkRight: 0.19,
          eyeLookOutLeft: 0.12,
          eyeLookInRight: 0.12,
          jawOpen: 0.04,
        },
        audioVolume: 0.02,
      }),
      makeSample({
        timestamp: 200,
        yaw: -5.0,
        pitch: 8.2,
        blendshapes: {
          eyeBlinkLeft: 0.25,
          eyeBlinkRight: 0.20,
          eyeLookOutLeft: 0.12,
          eyeLookInRight: 0.12,
          jawOpen: 0.05,
        },
        audioVolume: 0.03,
      }),
      makeSample({
        timestamp: 300,
        yaw: -5.1,
        pitch: 8.3,
        blendshapes: {
          eyeBlinkLeft: 0.23,
          eyeBlinkRight: 0.18,
          eyeLookOutLeft: 0.12,
          eyeLookInRight: 0.12,
          jawOpen: 0.04,
        },
        audioVolume: 0.025,
      }),
    ];

    const res = analyzeNeutralStep(samples);
    assert.equal(res.neutralYaw, -5.1);
    assert.equal(res.neutralPitch, 8.3);
    assert.ok(res.blinkOpenL >= 0.23 && res.blinkOpenL <= 0.25);
    assert.ok(res.blinkOpenR >= 0.18 && res.blinkOpenR <= 0.20);
    assert.equal(res.neutralEyeX, 0.12);
    assert.ok(res.noiseGate >= 0.035 && res.noiseGate <= 0.05);
  });

  test("analyzeBeepBlinkStep detects compressed glasses blinks inside beep windows and enables GlareAssist", () => {
    const beepTimestamps = [1000, 2300, 3600];
    const samples: CalibrationSample[] = [
      // Resting frames between beeps
      makeSample({ timestamp: 500, blendshapes: { eyeBlinkLeft: 0.24, eyeBlinkRight: 0.20 } }),
      // Beep 1 reaction (t=1250): Left eye has lens glare (reaches only 0.42), Right eye reaches 0.56
      makeSample({ timestamp: 1250, blendshapes: { eyeBlinkLeft: 0.42, eyeBlinkRight: 0.56 } }),
      makeSample({ timestamp: 1800, blendshapes: { eyeBlinkLeft: 0.23, eyeBlinkRight: 0.19 } }),
      // Beep 2 reaction (t=2550)
      makeSample({ timestamp: 2550, blendshapes: { eyeBlinkLeft: 0.44, eyeBlinkRight: 0.58 } }),
      makeSample({ timestamp: 3100, blendshapes: { eyeBlinkLeft: 0.24, eyeBlinkRight: 0.20 } }),
      // Beep 3 reaction (t=3850)
      makeSample({ timestamp: 3850, blendshapes: { eyeBlinkLeft: 0.43, eyeBlinkRight: 0.57 } }),
    ];

    const res = analyzeBeepBlinkStep(samples, beepTimestamps, 0.24, 0.20);
    assert.equal(res.blinkClosedL, 0.43);
    assert.equal(res.blinkClosedR, 0.57);
    assert.equal(res.glareAssist, true);

    // Verify remapping stretches the compressed [0.24..0.43] range to [0..1]
    assert.equal(remapBlinkClient(0.24, 0.24, res.blinkClosedL), 0);
    assert.equal(remapBlinkClient(0.43, 0.24, res.blinkClosedL), 1);
  });

  test("analyzeHeadTurnStep detects early headphone/frame occlusion yaw cutoff", () => {
    const samples: CalibrationSample[] = [
      makeSample({ yaw: 0, pitch: 0, blendshapes: { eyeBlinkLeft: 0.20, eyeBlinkRight: 0.20 } }),
      makeSample({ yaw: 14, pitch: 4, blendshapes: { eyeBlinkLeft: 0.22, eyeBlinkRight: 0.20 } }),
      // At +19 deg yaw, thick glasses rim occludes the far (Left) eye (0.50) while Right eye is open (0.20)
      makeSample({ yaw: 19, pitch: 8, blendshapes: { eyeBlinkLeft: 0.50, eyeBlinkRight: 0.20 } }),
      makeSample({ yaw: -18, pitch: -9, blendshapes: { eyeBlinkLeft: 0.20, eyeBlinkRight: 0.22 } }),
    ];

    const res = analyzeHeadTurnStep(samples, 0, 0, 0.20, 0.20, 0.55, 0.55);
    assert.equal(res.earlyOcclusionDetected, true);
    assert.equal(res.blinkMaxHeadYaw, 17); // 19 - 2 deg safety margin
  });

  test("analyzeVoiceAndSmileStep balances boom-mic smile occlusion and tunes micGain", () => {
    const samples: CalibrationSample[] = [
      // Boom mic blocks right mouth corner (0.18) while left mouth corner smiles clearly (0.68)
      makeSample({
        blendshapes: { mouthSmileLeft: 0.68, mouthSmileRight: 0.18, jawOpen: 0.42 },
        audioVolume: 0.32,
        audioPitchHz: 142.5,
      }),
      makeSample({
        blendshapes: { mouthSmileLeft: 0.70, mouthSmileRight: 0.20, jawOpen: 0.45 },
        audioVolume: 0.35,
        audioPitchHz: 146.5,
      }),
    ];

    const res = analyzeVoiceAndSmileStep(samples, 0.04, 0.02, 0.04);
    assert.equal(res.smileWeightL, 0.75);
    assert.equal(res.smileWeightR, 0.25);
    assert.ok(res.micGain >= 1.5 && res.micGain <= 2.2);
    assert.ok(res.mouthGain >= 1.5 && res.mouthGain <= 2.2);
    assert.equal(res.neutralPitchHz, 144.5);
  });

  test("fuseBlinkScoreClient rescues glare-suppressed blendshapes using 3D landmark EAR", () => {
    assert.ok(fuseBlinkScoreClient(0.15, 0.85) >= 0.75);
    assert.equal(fuseBlinkScoreClient(0.50, undefined), 0.50);
  });

  test("analyzeBeepBlinkStep calibrates Left/Right solo winks and suppresses opposite-eye squint crosstalk", () => {
    const beepTimestamps = [700, 1950];
    const winkTimestamps = [3400, 5000];
    const samples: CalibrationSample[] = [
      // Bilateral blink 1 & 2 (both reach ~0.52)
      makeSample({ timestamp: 1000, blendshapes: { eyeBlinkLeft: 0.52, eyeBlinkRight: 0.52 } }),
      makeSample({ timestamp: 2250, blendshapes: { eyeBlinkLeft: 0.52, eyeBlinkRight: 0.52 } }),
      // Left wink at t=3800: Left eye closes to 0.46, open Right eye squints sympathetically to 0.30
      makeSample({ timestamp: 3800, blendshapes: { eyeBlinkLeft: 0.46, eyeBlinkRight: 0.30 } }),
      // Right wink at t=5400: Right eye closes to 0.48, open Left eye squints sympathetically to 0.32
      makeSample({ timestamp: 5400, blendshapes: { eyeBlinkLeft: 0.32, eyeBlinkRight: 0.48 } }),
    ];

    const res = analyzeBeepBlinkStep(samples, beepTimestamps, 0.20, 0.20, winkTimestamps);
    // Both eyes demonstrated independent solo winks -> glareAssist disabled so open eye never couples closed
    assert.equal(res.glareAssist, false);
    // Closed ceilings adapt to softer solo wink so winks reach ~1.0
    assert.ok(res.blinkClosedL <= 0.46 && res.blinkClosedL >= 0.43);
    assert.ok(res.blinkClosedR <= 0.48 && res.blinkClosedR >= 0.45);
    // Thresholds sit cleanly above the open eye's sympathetic squint (crosstalk)
    const remappedCrossL = remapBlinkClient(0.32, 0.20, res.blinkClosedL);
    const remappedCrossR = remapBlinkClient(0.30, 0.20, res.blinkClosedR);
    assert.ok(res.blinkThresholdL > remappedCrossL);
    assert.ok(res.blinkThresholdR > remappedCrossR);
  });

  test("evaluateCalibrationSubstepActivity detects blinks, winks, directional head turns, smiles, and vowels", () => {
    const neutral = {
      neutralYaw: 0,
      neutralPitch: 0,
      blinkOpenL: 0.12,
      blinkOpenR: 0.12,
      neutralSquintL: 0.04,
      neutralSquintR: 0.04,
      neutralSmile: 0.03,
      neutralMouth: 0.02,
      noiseGate: 0.03,
    };

    // Resting sample does not falsely trigger active steps
    const resting = makeSample({
      yaw: 0.5,
      pitch: -0.4,
      blendshapes: { eyeBlinkLeft: 0.12, eyeBlinkRight: 0.12, mouthSmileLeft: 0.03, mouthSmileRight: 0.03 },
      audioVolume: 0.01,
    });
    assert.equal(evaluateCalibrationSubstepActivity("step1_neutral", resting, neutral).active, true);
    assert.equal(evaluateCalibrationSubstepActivity("step2a_blink", resting, neutral).active, false);
    assert.equal(evaluateCalibrationSubstepActivity("step2b_wink_l", resting, neutral).active, false);
    assert.equal(evaluateCalibrationSubstepActivity("step3a_left", resting, neutral).active, false);
    assert.equal(evaluateCalibrationSubstepActivity("step4a_smile", resting, neutral).active, false);
    assert.equal(evaluateCalibrationSubstepActivity("step4b_vowel_a", resting, neutral).active, false);

    // Left wink triggers step2b_wink_l
    const leftWink = makeSample({
      blendshapes: { eyeBlinkLeft: 0.24, eyeBlinkRight: 0.12 },
    });
    assert.equal(evaluateCalibrationSubstepActivity("step2b_wink_l", leftWink, neutral).active, true);

    // Head turn left (-8 deg yaw) triggers step3a_left, and opposite (+8 deg yaw) triggers step3b_right
    const turnLeft = makeSample({ yaw: -8.0 });
    const turnRight = makeSample({ yaw: 8.0 });
    assert.equal(evaluateCalibrationSubstepActivity("step3a_left", turnLeft, neutral).active, true);
    assert.equal(evaluateCalibrationSubstepActivity("step3b_right", turnLeft, neutral, -1).active, false);
    assert.equal(evaluateCalibrationSubstepActivity("step3b_right", turnRight, neutral, -1).active, true);

    // Smile triggers step4a_smile
    const smiling = makeSample({
      blendshapes: { mouthSmileLeft: 0.35, mouthSmileRight: 0.35 },
    });
    assert.equal(evaluateCalibrationSubstepActivity("step4a_smile", smiling, neutral).active, true);

    // Voiced vowel triggers step4b_vowel_a
    const speaking = makeSample({ audioVolume: 0.15 });
    assert.equal(evaluateCalibrationSubstepActivity("step4b_vowel_a", speaking, neutral).active, true);

    // Extreme head turns left/right or down that exceed webcam FOV (present: false) still register as active in Step 3
    const extremeDropout = makeSample({ present: false, yaw: 0, pitch: 0 });
    assert.equal(evaluateCalibrationSubstepActivity("step3a_left", extremeDropout, neutral).active, true);
    assert.equal(evaluateCalibrationSubstepActivity("step3b_right", extremeDropout, neutral, -1).active, true);
    assert.equal(evaluateCalibrationSubstepActivity("step3d_down", extremeDropout, neutral, -1).active, true);

    // Downward head tilt (+pitch / -y shift) triggers step3d_down even if prevTurnSign was noisy (+1)
    const tiltDown = makeSample({ pitch: 6.5, y: -2.5 });
    assert.equal(evaluateCalibrationSubstepActivity("step3d_down", tiltDown, neutral, 1).active, true);
  });

  test("analyzeHeadTurnStep preserves extreme turn peaks and detects occlusion when tracking drops out", () => {
    const samples: CalibrationSample[] = [
      makeSample({ present: true, yaw: 0, pitch: 0 }),
      makeSample({ present: true, yaw: -16, pitch: 0 }),
      // User turns head further left past camera tracking limit -> present: false
      makeSample({ present: false, yaw: 0, pitch: 0 }),
      makeSample({ present: true, yaw: 15, pitch: 0 }),
      makeSample({ present: false, yaw: 0, pitch: 0 }),
      // User tilts head down toward keyboard -> present: false after +8 deg pitch
      makeSample({ present: true, yaw: 0, pitch: 8 }),
      makeSample({ present: false, yaw: 0, pitch: 0 }),
    ];

    const res = analyzeHeadTurnStep(samples, 0, 0, 0.12, 0.12, 0.55, 0.55);
    assert.equal(res.earlyOcclusionDetected, true);
    assert.ok(res.blinkMaxHeadYaw <= 16 && res.blinkMaxHeadYaw >= 12);
    assert.ok(res.yawMultiplier >= 0.95 && res.yawMultiplier <= 1.15);
    assert.ok(res.pitchMultiplier >= 0.95 && res.pitchMultiplier <= 1.15);
  });

  test("analyzeNeutralStep uses 90th percentile + safety margin for neutralFrown to prevent resting false-positives", () => {
    const samples: CalibrationSample[] = [
      makeSample({
        timestamp: 100,
        blendshapes: { geoFrownLeft: 0.18, geoFrownRight: 0.18, mouthShrugLower: 0.20 },
      }),
      makeSample({
        timestamp: 200,
        blendshapes: { geoFrownLeft: 0.22, geoFrownRight: 0.22, mouthShrugLower: 0.24 },
      }),
      makeSample({
        timestamp: 300,
        blendshapes: { geoFrownLeft: 0.28, geoFrownRight: 0.28, mouthShrugLower: 0.30 },
      }),
    ];

    const res = analyzeNeutralStep(samples);
    // p90 of raw frown (~0.22) + margin should sit safely above the median sample (0.176)
    assert.ok(res.neutralFrown >= 0.24 && res.neutralFrown <= 0.32);
  });
});
