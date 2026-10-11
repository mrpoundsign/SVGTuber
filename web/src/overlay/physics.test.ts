import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createPhysicsOscillatorState,
  stepOscillator,
  calculateVoiceBounce,
} from "./physics.ts";

describe("Physics & Dynamics", () => {
  test("stepOscillator smoothly tracks target angle/displacement", () => {
    const state = createPhysicsOscillatorState(0);
    const target = 15;

    for (let i = 0; i < 120; i++) {
      stepOscillator(state, target, 0.15, 0.82, 0.5, 1.0);
    }

    assert.ok(
      Math.abs(state.current - target) < 0.1,
      `Expected oscillator to converge to ${target}, got ${state.current}`
    );
  });

  test("calculateVoiceBounce returns zero offset when not speaking", () => {
    const res = calculateVoiceBounce(1000, 0, false, 1.0);
    assert.equal(res.offsetY, 0);
    assert.equal(res.scaleX, 1.0);
    assert.equal(res.scaleY, 1.0);
  });

  test("calculateVoiceBounce computes vertical bob and squash when speaking", () => {
    // at a sine peak
    const res = calculateVoiceBounce(100, 0.5, true, 1.0, { height: 10, squash: 0.1, speed: 15 });
    assert.ok(res.offsetY <= 0, `Expected negative Y bob, got ${res.offsetY}`);
    assert.ok(res.scaleY >= 1.0, `Expected scaleY stretch >= 1, got ${res.scaleY}`);
    assert.ok(res.scaleX <= 1.0, `Expected scaleX squash <= 1, got ${res.scaleX}`);
  });

  test("calculateVoiceBounce respects zero bounce multiplier", () => {
    const res = calculateVoiceBounce(1000, 0.8, true, 0.0);
    assert.equal(res.offsetY, 0);
    assert.equal(res.scaleX, 1.0);
    assert.equal(res.scaleY, 1.0);
  });
});
