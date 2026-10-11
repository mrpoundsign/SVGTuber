/**
 * Rig Binding, Pivot Calculation, and DOM Directives Traversal
 */

import type { RigDefinition, AccessoryConfig, ParamFrame } from "../shared/types.ts";
import { evaluateCondition, parseDirectiveString, parseDuration, type DirectiveItem } from "./directives.ts";

export interface RigBinding {
  el: SVGGraphicsElement;
  id: string;
  label: string;
  cx: number;
  cy: number;
  baseTransform: string;
  directives: DirectiveItem[];
  isAccessoryBinding?: boolean;
  accId?: string;
  _currentTx?: number;
  _currentTy?: number;
  _currentRot?: number;
  _rotHistory?: number[];
  _physicsState?: {
    curTx: number;
    curTy: number;
    curRot: number;
    vx: number;
    vy: number;
    vRot: number;
  };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resolvePivot(
  pivotStr: string | undefined | null,
  bbox: BoundingBox,
  resolveTargetBBox?: (id: string) => BoundingBox | null
): { cx: number; cy: number } {
  let cx = bbox.x + bbox.width / 2;
  let cy = bbox.y + bbox.height / 2;

  if (!pivotStr) return { cx, cy };

  const pivot = pivotStr.toLowerCase().trim();
  if (pivot === "top" || pivot === "top-center" || pivot === "topcenter") {
    cy = bbox.y;
    cx = bbox.x + bbox.width / 2;
  } else if (pivot === "bottom" || pivot === "bottom-center" || pivot === "bottomcenter") {
    cy = bbox.y + bbox.height;
    cx = bbox.x + bbox.width / 2;
  } else if (pivot === "left" || pivot === "center-left" || pivot === "leftcenter") {
    cx = bbox.x;
    cy = bbox.y + bbox.height / 2;
  } else if (pivot === "right" || pivot === "center-right" || pivot === "rightcenter") {
    cx = bbox.x + bbox.width;
    cy = bbox.y + bbox.height / 2;
  } else if (pivot === "top-left" || pivot === "topleft") {
    cx = bbox.x;
    cy = bbox.y;
  } else if (pivot === "top-right" || pivot === "topright") {
    cx = bbox.x + bbox.width;
    cy = bbox.y;
  } else if (pivot === "bottom-left" || pivot === "bottomleft") {
    cx = bbox.x;
    cy = bbox.y + bbox.height;
  } else if (pivot === "bottom-right" || pivot === "bottomright") {
    cx = bbox.x + bbox.width;
    cy = bbox.y + bbox.height;
  } else if (pivot === "center" || pivot === "middle") {
    cx = bbox.x + bbox.width / 2;
    cy = bbox.y + bbox.height / 2;
  } else if (pivot.startsWith("#") && resolveTargetBBox) {
    const tb = resolveTargetBBox(pivot);
    if (tb) {
      cx = tb.x + tb.width / 2;
      cy = tb.y + tb.height / 2;
    }
  } else if (pivot.includes(",") || pivot.includes(" ")) {
    const parts = pivot.split(/[, ]+/).filter(Boolean);
    if (parts.length >= 2) {
      const px = parseFloat(parts[0]);
      const py = parseFloat(parts[1]);
      if (!isNaN(px) && !isNaN(py)) {
        cx = px;
        cy = py;
      }
    }
  }

  return { cx, cy };
}

export function computeMouthExclusivity(states: {
  hasNeutral: boolean;
  hasSmile: boolean;
  hasOpen: boolean;
  isOpen: boolean;
  isSmile: boolean;
}): { showNeutral: boolean; showSmile: boolean; showOpen: boolean } {
  if (states.isOpen) {
    return { showNeutral: false, showSmile: false, showOpen: true };
  }
  if (states.isSmile) {
    return { showNeutral: false, showSmile: true, showOpen: false };
  }
  if (states.hasNeutral) {
    return { showNeutral: true, showSmile: false, showOpen: false };
  }
  return { showNeutral: false, showSmile: false, showOpen: false };
}

export function computeEyeExclusivity(states: {
  closedL: boolean;
  closedR: boolean;
  hasIndependentEyes: boolean;
  closedCombined?: boolean;
}): {
  showClosedL: boolean;
  showOpenL: boolean;
  showClosedR: boolean;
  showOpenR: boolean;
  showClosedCombined: boolean;
  showOpenCombined: boolean;
} {
  return {
    showClosedL: states.closedL,
    showOpenL: !states.closedL,
    showClosedR: states.closedR,
    showOpenR: !states.closedR,
    showClosedCombined: Boolean(states.closedCombined && !states.hasIndependentEyes),
    showOpenCombined: Boolean(!states.closedCombined && !states.hasIndependentEyes),
  };
}

export function findAnchorTarget(
  svg: SVGSVGElement,
  targetName: string,
  bindings: RigBinding[] = []
): SVGGraphicsElement {
  if (!targetName || targetName === "root_svg") return svg as any;

  let target = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(targetName)}`);
  if (target) return target;

  target =
    svg.querySelector<SVGGraphicsElement>(`[data-name="${CSS.escape(targetName)}"]`) ||
    svg.querySelector<SVGGraphicsElement>(`[inkscape\\:label="${CSS.escape(targetName)}"]`) ||
    svg.querySelector<SVGGraphicsElement>(`[aria-label="${CSS.escape(targetName)}"]`);
  if (target) return target;

  target =
    svg.querySelector<SVGGraphicsElement>(`[id*="${CSS.escape(targetName)}"]`) ||
    svg.querySelector<SVGGraphicsElement>(`[data-name*="${CSS.escape(targetName)}"]`) ||
    svg.querySelector<SVGGraphicsElement>(`[inkscape\\:label*="${CSS.escape(targetName)}"]`);
  if (target) return target;

  const isHeadTarget = targetName.toLowerCase().includes("head");
  if (isHeadTarget) {
    for (const b of bindings) {
      if (b.isAccessoryBinding) continue;
      const lowerId = (b.id || "").toLowerCase();
      const lowerLabel = (b.label || "").toLowerCase();
      if (lowerId.includes("head") || lowerLabel.includes("head")) {
        return b.el;
      }
    }
    target =
      svg.querySelector<SVGGraphicsElement>("#layer_head") ||
      svg.querySelector<SVGGraphicsElement>("#head") ||
      svg.querySelector<SVGGraphicsElement>('[data-name*="Head" i]') ||
      svg.querySelector<SVGGraphicsElement>('[inkscape\\:label*="Head" i]') ||
      svg.querySelector<SVGGraphicsElement>('[id*="Head" i]') ||
      svg.querySelector<SVGGraphicsElement>('[id*="head" i]');
    if (target) return target;
  }

  return svg as any;
}
