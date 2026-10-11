/**
 * Accessory Mounting, Anchoring and Transform Logic
 */

import type { AccessoryConfig } from "../shared/types.ts";

export interface AnchorPoint {
  x: number;
  y: number;
}

export function computeAnchorCenter(
  bbox: { x: number; y: number; width: number; height: number }
): AnchorPoint {
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

export function buildAccessoryTransform(
  acc: AccessoryConfig,
  anchor: AnchorPoint
): string {
  const finalX = anchor.x + (acc.x || 0);
  const finalY = anchor.y + (acc.y || 0);
  const rot = acc.rotation || 0;
  const sx = acc.scaleX !== undefined ? acc.scaleX : 1.0;
  const sy = acc.scaleY !== undefined ? acc.scaleY : 1.0;

  return `translate(${finalX}, ${finalY}) rotate(${rot}) scale(${sx}, ${sy})`;
}

export function isAccessoryVisible(
  acc: AccessoryConfig,
  activeExpressions: Record<string, boolean> = {}
): boolean {
  if (!acc.enabled) return false;

  const trigger = (acc.expression || "").trim().toLowerCase();
  if (!trigger) return true; // Always visible

  const exprName = trigger.startsWith("is") && trigger.length > 2 ? trigger.substring(2) : trigger;
  return Boolean(activeExpressions[exprName] || activeExpressions[trigger]);
}
