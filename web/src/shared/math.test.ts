import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clamp, lerp, smoothDamp } from "./math.ts";

describe("Math Utilities", () => {
  test("clamp constrains values within bounds", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
  });

  test("lerp smoothly interpolates between numbers", () => {
    assert.equal(lerp(0, 100, 0), 0);
    assert.equal(lerp(0, 100, 0.5), 50);
    assert.equal(lerp(0, 100, 1), 100);
    assert.equal(lerp(0, 100, -1), 0);
    assert.equal(lerp(0, 100, 2), 100);
  });

  test("smoothDamp converges toward target", () => {
    const vel = { value: 0 };
    let current = 0;
    const target = 10;
    const dt = 0.016;

    for (let i = 0; i < 60; i++) {
      current = smoothDamp(current, target, vel, 0.1, Infinity, dt);
    }

    assert.ok(Math.abs(current - target) < 0.1, `Expected close to 10, got ${current}`);
  });
});
