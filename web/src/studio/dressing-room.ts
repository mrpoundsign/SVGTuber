/**
 * Dressing Room Nudge & Fitting Mirror Mathematics
 */

import type { AccessoryConfig } from "../shared/types.ts";

export function nudgePosition(
  x: number,
  y: number,
  dx: number,
  dy: number,
  step: number = 1
): { x: number; y: number } {
  return {
    x: Math.round((x + dx * step) * 100) / 100,
    y: Math.round((y + dy * step) * 100) / 100,
  };
}

export function nudgeRotation(currentRot: number, deltaRot: number): number {
  let rot = (currentRot + deltaRot) % 360;
  if (rot > 180) rot -= 360;
  if (rot < -180) rot += 360;
  return rot;
}

export function computeLinkedScale(
  newScale: number,
  isLinked: boolean,
  axis: "x" | "y",
  currentSX: number,
  currentSY: number
): { scaleX: number; scaleY: number } {
  if (isLinked) {
    return { scaleX: newScale, scaleY: newScale };
  }
  return {
    scaleX: axis === "x" ? newScale : currentSX,
    scaleY: axis === "y" ? newScale : currentSY,
  };
}

export function formatFittingMirrorUrl(isFrozen: boolean): string {
  const freezeParam = isFrozen ? "&freeze=1" : "";
  return `/overlay?t=${Date.now()}${freezeParam}`;
}
