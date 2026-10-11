import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnchorCenter,
  buildAccessoryTransform,
  isAccessoryVisible,
} from "./accessories.ts";
import type { AccessoryConfig } from "../shared/types.ts";

describe("Accessory System", () => {
  test("computeAnchorCenter finds middle of bounding box", () => {
    const center = computeAnchorCenter({ x: 100, y: 200, width: 50, height: 80 });
    assert.equal(center.x, 125);
    assert.equal(center.y, 240);
  });

  test("buildAccessoryTransform produces correct CSS transform string", () => {
    const acc: AccessoryConfig = {
      id: "acc_1",
      file: "glasses.svg",
      name: "Glasses",
      target: "layer_head",
      x: 10,
      y: -5,
      scaleX: 1.2,
      scaleY: 1.2,
      rotation: 15,
      order: "front",
      enabled: true,
      expression: "",
    };
    const anchor = { x: 200, y: 150 };
    const transform = buildAccessoryTransform(acc, anchor);
    assert.equal(transform, "translate(210, 145) rotate(15) scale(1.2, 1.2)");
  });

  test("isAccessoryVisible respects enabled flag and expression triggers", () => {
    const acc: AccessoryConfig = {
      id: "acc_sweat",
      file: "sweat.svg",
      name: "Sweat",
      target: "layer_head",
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      order: "front",
      enabled: true,
      expression: "sweat",
    };

    assert.equal(isAccessoryVisible(acc, { sweat: true }), true);
    assert.equal(isAccessoryVisible(acc, { sweat: false }), false);
    assert.equal(isAccessoryVisible(acc, {}), false);

    // Disabled accessory is never visible
    const disabledAcc = { ...acc, enabled: false };
    assert.equal(isAccessoryVisible(disabledAcc, { sweat: true }), false);

    // Empty expression is always visible if enabled
    const alwaysVisibleAcc = { ...acc, expression: "" };
    assert.equal(isAccessoryVisible(alwaysVisibleAcc, {}), true);
  });
});
