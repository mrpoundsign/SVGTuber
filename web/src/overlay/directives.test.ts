import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, parseDirectiveString, parseDuration } from "./directives.ts";

describe("Directives Condition Evaluation", () => {
  test("evaluates empty or null conditions as true", () => {
    assert.equal(evaluateCondition("", {}), true);
    assert.equal(evaluateCondition(undefined, {}), true);
  });

  test("evaluates custom active expressions", () => {
    assert.equal(evaluateCondition("blush", {}, { blush: true }), true);
    assert.equal(evaluateCondition("blush", {}, { blush: false }), false);
    assert.equal(evaluateCondition("isBlush", {}, { blush: true }), true);
    assert.equal(evaluateCondition("!blush", {}, { blush: true }), false);
    assert.equal(evaluateCondition("!blush", {}, { blush: false }), true);
  });

  test("evaluates boolean shorthand parameters", () => {
    assert.equal(evaluateCondition("isBlinkL", { isBlinkL: true }), true);
    assert.equal(evaluateCondition("isBlinkL", { isBlinkL: false }), false);
    assert.equal(evaluateCondition("isMouthOpen", { isMouthOpen: true }), true);
    assert.equal(evaluateCondition("isSpeaking", { isSpeaking: true }), true);
  });

  test("evaluates numeric comparisons", () => {
    assert.equal(evaluateCondition("mouthOpen >= 0.5", { mouthOpen: 0.8 }), true);
    assert.equal(evaluateCondition("mouthOpen >= 0.5", { mouthOpen: 0.2 }), false);
    assert.equal(evaluateCondition("headYaw > 10 || headYaw < -10", { headYaw: 15 }), true);
    assert.equal(evaluateCondition("headYaw > 10 || headYaw < -10", { headYaw: 0 }), false);
    assert.equal(evaluateCondition("browL > 0.3", { browL: 0.6 }), true);
    assert.equal(evaluateCondition("browR < -0.3", { browR: -0.5 }), true);
  });

  test("evaluates compound boolean expressions", () => {
    assert.equal(
      evaluateCondition("blush && isBlinkL", { isBlinkL: true }, { blush: true }),
      true
    );
    assert.equal(
      evaluateCondition("blush && isBlinkL", { isBlinkL: false }, { blush: true }),
      false
    );
    assert.equal(
      evaluateCondition("blush || sweat", {}, { blush: false, sweat: true }),
      true
    );
  });

  test("parseDirectiveString correctly parses standard IAMS directives", () => {
    const raw = "Follow {yaw: 0.8; pitch: 0.5} Idle {period: 2s; breathe: 0.05}";
    const directives = parseDirectiveString(raw);
    assert.equal(directives.length, 2);
    assert.equal(directives[0].type, "Follow");
    assert.equal(directives[0].params.yaw, "0.8");
    assert.equal(directives[0].params.pitch, "0.5");
    assert.equal(directives[1].type, "Idle");
    assert.equal(directives[1].params.period, "2s");
    assert.equal(directives[1].params.breathe, "0.05");
  });

  test("parseDuration correctly parses seconds and milliseconds", () => {
    assert.equal(parseDuration("500ms"), 500);
    assert.equal(parseDuration("2.5s"), 2500);
    assert.equal(parseDuration(1200), 1200);
    assert.equal(parseDuration(undefined, 3000), 3000);
  });
});
