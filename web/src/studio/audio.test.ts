import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateRMS, stepAudioVolume, evaluateSpeechGate } from "./audio.ts";

describe("Audio Processing & Speech Gate", () => {
  test("calculateRMS returns zero for empty or silent buffer", () => {
    assert.equal(calculateRMS([]), 0);
    assert.equal(calculateRMS(new Float32Array([0, 0, 0, 0])), 0);
  });

  test("calculateRMS computes correct root mean square for signal", () => {
    // Constant value signal of 0.5: RMS = sqrt(0.5^2) = 0.5
    const constantSignal = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    assert.equal(calculateRMS(constantSignal), 0.5);

    // Bipolar square wave of +1 and -1: RMS = sqrt((1 + 1) / 2) = 1.0
    const squareWave = new Float32Array([1.0, -1.0, 1.0, -1.0]);
    assert.equal(calculateRMS(squareWave), 1.0);
  });

  test("stepAudioVolume attacks immediately on higher volume", () => {
    const current = 0.1;
    const newRms = 0.8;
    const result = stepAudioVolume(current, newRms);
    assert.equal(result, 0.8);
  });

  test("stepAudioVolume decays smoothly on lower volume", () => {
    const current = 0.8;
    const newRms = 0.0;
    const decay = 0.2;
    const result = stepAudioVolume(current, newRms, decay);
    // 0.8 * (1 - 0.2) + 0 = 0.64
    assert.ok(Math.abs(result - 0.64) < 1e-6);
  });

  test("evaluateSpeechGate compares amplified volume against threshold", () => {
    // 0.02 * 1.5 = 0.03 < 0.04 (quiet, not speaking)
    assert.equal(evaluateSpeechGate(0.02, 1.5, 0.04), false);

    // 0.05 * 1.5 = 0.075 >= 0.04 (speaking)
    assert.equal(evaluateSpeechGate(0.05, 1.5, 0.04), true);
  });
});
