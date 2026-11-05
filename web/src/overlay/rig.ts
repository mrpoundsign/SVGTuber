/**
 * Rig Binding, Pivot Calculation, and DOM Directives Traversal
 */

import type { RigDefinition, AccessoryConfig, ParamFrame } from "../shared/types.ts";
import { evaluateCondition, parseDirectiveString, parseDuration, type DirectiveItem } from "./directives.ts";

export type PartRole25D = "head_root" | "ear_or_horn" | "face_feature" | "face_dist" | "snout_sub" | "other";

export interface RigBinding {
  el: SVGGraphicsElement;
  id: string;
  label: string;
  cx: number;
  cy: number;
  bbox?: BoundingBox;
  baseTransform: string;
  directives: DirectiveItem[];
  isAccessoryBinding?: boolean;
  accId?: string;
  _sideOffset?: number;
  _isHeadRoot?: boolean;
  _partRole?: PartRole25D;
  _scaleCy?: number;
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

export interface Perspective25DOptions {
  headYaw: number;
  headPitch: number;
  sideOffset?: number;
  partRole?: PartRole25D;
  isHeadRoot?: boolean;
  distFactor?: number;
  amount?: number;
  foreshorten?: number;
  persp?: number;
  skewXDeg?: number;
  skewYDeg?: number;
}

export interface Perspective25DResult {
  sx: number;
  sy: number;
  skewX: number;
  skewY: number;
  extraTx: number;
  extraTy: number;
}

export function classifyRigBindings25D(
  svg: SVGSVGElement,
  bindings: RigBinding[],
  fallbackCenter?: { x: number; y: number }
): void {
  let headCenterCx = 0;
  let headHalfWidth = 100;
  let headNeckCy = 0;

  const headNode = findAnchorTarget(svg, "layer_head", bindings);
  if (headNode && headNode !== (svg as any)) {
    try {
      const skullBase =
        headNode.querySelector<SVGGraphicsElement>("#Head_Base_Group, #Head, #head_base, #face_base, #ellipse7") ||
        headNode;
      const hb = skullBase.getBBox();
      if (hb && hb.width > 0) {
        headCenterCx = hb.x + hb.width / 2;
        headHalfWidth = Math.max(20, hb.width / 2);
        headNeckCy = hb.y + hb.height * 0.88;
      }
    } catch {}
  }
  if (headCenterCx === 0 && fallbackCenter) {
    headCenterCx = fallbackCenter.x;
    headHalfWidth = Math.max(40, fallbackCenter.x * 0.35);
    headNeckCy = fallbackCenter.y * 1.15;
  }

  for (const b of bindings) {
    const lowerId = (b.id || "").toLowerCase();
    const lowerLabel = (b.label || "").toLowerCase();
    b._isHeadRoot =
      Boolean(headNode && headNode !== (svg as any) && b.el === headNode) ||
      lowerId === "head" ||
      lowerId === "layer_head" ||
      lowerId === "head_group" ||
      lowerLabel.startsWith("head ") ||
      lowerLabel.startsWith("head[") ||
      lowerLabel.startsWith("head_group");
  }

  const initialCount = bindings.length;
  for (let idx = 0; idx < initialCount; idx++) {
    const b = bindings[idx];
    if (b._isHeadRoot) {
      b._partRole = "head_root";
      b._sideOffset = 0;
      b._scaleCy = b.cy;
      continue;
    }

    b._scaleCy = b.cy;
    let visualCx = b.cx;
    if (b.bbox && b.bbox.width > 0) {
      visualCx = b.bbox.x + b.bbox.width / 2;
    } else {
      try {
        const eb = b.el.getBBox();
        if (eb && eb.width > 0) {
          b.bbox = { x: eb.x, y: eb.y, width: eb.width, height: eb.height };
          visualCx = eb.x + eb.width / 2;
        }
      } catch {}
    }
    b._sideOffset = Math.max(-1, Math.min(1, (visualCx - headCenterCx) / headHalfWidth));

    const inHead = Boolean(headNode && headNode !== (svg as any) && headNode.contains(b.el));
    if (!inHead) {
      b._partRole = "other";
      continue;
    }

    const intermediateAncestors = bindings.filter(
      (pb) =>
        pb !== b &&
        !pb._isHeadRoot &&
        Boolean(headNode && headNode.contains(pb.el)) &&
        Boolean(pb.el && pb.el.contains(b.el))
    );
    if (intermediateAncestors.length > 0) {
      // Direct children of a [Dist] snout/muzzle group: keep Mouth_* groups planted inside
      // their parent snout ("other" role) so they don't double-shift or tilt, while bilateral
      // snout sub-elements (such as Nostrils) get "snout_sub" foreshortening.
      const distParent = intermediateAncestors.find((pb) =>
        pb.directives.some((d) => {
          const t = (d.type || (d as any).Type || d.name || "").toLowerCase().trim();
          return t === "dist" || t === "distance" || t === "parallax";
        })
      );
      const isMouthChild = /mouth/i.test(b.id || "") || /mouth/i.test(b.label || "");
      if (distParent && intermediateAncestors.length === 1 && !isMouthChild) {
        b._partRole = "snout_sub";
        const dpBBox = distParent.bbox;
        if (dpBBox && dpBBox.width > 0) {
          const dpCx = dpBBox.x + dpBBox.width / 2;
          const dpHalfW = Math.max(20, dpBBox.width / 2);
          b._sideOffset = Math.max(-1, Math.min(1, (visualCx - dpCx) / dpHalfW));
        }
      } else {
        b._partRole = "other";
      }
      continue;
    }

    const hasDist = b.directives.some((d) => {
      const t = (d.type || (d as any).Type || d.name || "").toLowerCase().trim();
      return t === "dist" || t === "distance" || t === "parallax";
    });
    const hasSway = b.directives.some((d) => {
      const t = (d.type || (d as any).Type || d.name || "").toLowerCase().trim();
      return t === "sway";
    });
    const lowerCombined = `${(b.id || "").toLowerCase()} ${(b.label || "").toLowerCase()}`;

    if (hasDist) {
      b._partRole = "face_dist";
      b._scaleCy = b.cy;
      // Also auto-bind any unbound Nostril sub-elements inside this snout group for 2.5D muzzle curvature
      const nostrils = b.el.querySelectorAll<SVGGraphicsElement>('[id*="Nostril" i], [id*="nostril" i]');
      nostrils.forEach((nEl) => {
        if (bindings.some((existing) => existing.el === nEl)) return;
        try {
          const nb = nEl.getBBox();
          if (nb && nb.width > 0) {
            const nCx = nb.x + nb.width / 2;
            const nCy = nb.y + nb.height / 2;
            const dpBBox = b.bbox;
            const dpCx = dpBBox && dpBBox.width > 0 ? dpBBox.x + dpBBox.width / 2 : headCenterCx;
            const dpHalfW = dpBBox && dpBBox.width > 0 ? Math.max(20, dpBBox.width / 2) : headHalfWidth;
            bindings.push({
              el: nEl,
              id: nEl.id || "nostril",
              label: nEl.id || "nostril",
              cx: nCx,
              cy: nCy,
              bbox: { x: nb.x, y: nb.y, width: nb.width, height: nb.height },
              baseTransform: nEl.getAttribute("transform") || "",
              directives: [],
              _isHeadRoot: false,
              _partRole: "snout_sub",
              _scaleCy: nCy,
              _sideOffset: Math.max(-1, Math.min(1, (nCx - dpCx) / dpHalfW)),
            });
          }
        } catch {}
      });
    } else if (hasSway || /ear|horn|antenn|braid|hair_side|ahoge|top_accessory|forelock/.test(lowerCombined)) {
      b._partRole = "ear_or_horn";
    } else {
      b._partRole = "face_feature";
    }
  }
}

export function compute25DPerspective(opts: Perspective25DOptions): Perspective25DResult {
  const yaw = opts.headYaw || 0;
  const pitch = opts.headPitch || 0;
  const amt = opts.amount !== undefined ? opts.amount : 0;
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  const sinYaw = Math.sin(yawRad);
  const cosYaw = Math.cos(yawRad);
  const cosPitch = Math.cos(pitchRad);

  let sx = 1;
  let sy = 1;
  let skewX = 0;
  let skewY = 0;
  let extraTx = 0;
  let extraTy = 0;

  const side = Math.max(-1, Math.min(1, opts.sideOffset || 0));
  const role: PartRole25D =
    opts.partRole || (opts.isHeadRoot ? "head_root" : opts.distFactor ? "face_dist" : "other");

  if (amt > 0) {
    if (role === "head_root") {
      // Foreshorten skull width/height around its center pivot without neck-hinged forehead overhang
      // so horizontal turns stay level and upward/downward pitch is symmetric.
      sx *= 1 - (1 - cosYaw) * 0.18 * amt;
      sy *= 1 - (1 - cosPitch) * 0.12 * amt;
      skewY += -(yaw / 25) * (pitch / 20) * 1.8 * amt;
      extraTx += -yaw * 0.12 * amt;
    } else if (role === "ear_or_horn") {
      // Anchored at its skull attachment pivot (right/left/bottom/top):
      // zero extraTx/extraTy so the root stays 100% welded to the head outline,
      // with far-side horizontal foreshortening on yaw and vertical counter-tilt on pitch.
      const asymK = side * sinYaw >= 0 ? 0.50 : 0.18;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.10 * amt;
      sx *= Math.max(0.55, Math.min(1.20, autoScale));
      skewY += -side * (pitch / 20) * 3.5 * amt;
    } else if (role === "face_feature") {
      // Eyes, brows, cheeks, and standalone mouths sit on the mid-front facial sphere
      // (between the skull base and the protruding snout/muzzle).
      extraTx += yaw * 0.068 * 2.2 * amt - side * (1 - cosYaw) * 5.0 * amt;
      extraTy += pitch * 0.18 * amt - (1 - cosYaw) * 12.0 * amt;
      const asymK = side * sinYaw >= 0 ? 0.38 : 0.16;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.10 * amt;
      sx *= Math.max(0.62, Math.min(1.18, autoScale));
      sy *= 1 - (1 - cosPitch) * 0.10 * amt;
      skewY += -(yaw / 25) * (pitch / 20) * 1.5 * amt;
    } else if (role === "face_dist") {
      // Protruding [Dist] volume (cow snout/muzzle or robot mouth panel) projects forward in front of
      // the eye plane, foreshortens around its center pivot without flapping or seesaw-tilting,
      // and lifts subtly along the curved cheek/jaw contour on high yaw turns.
      const df = opts.distFactor !== undefined ? opts.distFactor : 0.14;
      extraTx += yaw * (df * 0.20) * amt;
      extraTy += pitch * (df * 0.55) * amt - (1 - cosYaw) * 22.0 * amt;
      const autoScale = 1 - (1 - cosYaw) * 0.20 * amt;
      sx *= Math.max(0.74, Math.min(1.10, autoScale));
      sy *= 1 - (1 - cosPitch) * 0.14 * amt;
    } else if (role === "snout_sub") {
      // Sub-features on the front tip of a protruding snout/muzzle (e.g. bilateral nostrils):
      // foreshorten across the curved snout surface without tilting or detaching.
      extraTx += -side * (1 - cosYaw) * 3.0 * amt;
      const asymK = side * sinYaw >= 0 ? 0.40 : 0.16;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.06 * amt;
      sx *= Math.max(0.60, Math.min(1.16, autoScale));
    } else {
      const asymK = side * sinYaw >= 0 ? 0.35 : 0.18;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.12 * amt;
      sx *= Math.max(0.58, Math.min(1.22, autoScale));
      skewY += -(yaw / 25) * (pitch / 20) * 2.5 * amt;
    }
  }

  if (opts.foreshorten !== undefined && !isNaN(opts.foreshorten) && opts.foreshorten !== 0) {
    sx *= 1 - (1 - cosYaw) * opts.foreshorten;
    sy *= 1 - (1 - cosPitch) * (opts.foreshorten * 0.75);
  }

  if (opts.persp !== undefined && !isNaN(opts.persp) && opts.persp !== 0) {
    const pScale = 1 - side * sinYaw * opts.persp;
    sx *= Math.max(0.55, Math.min(1.30, pScale));
  }

  if (opts.skewXDeg !== undefined && !isNaN(opts.skewXDeg) && !isNaN(opts.skewXDeg) && opts.skewXDeg !== 0) {
    skewX += (yaw / 25) * opts.skewXDeg;
  }

  if (opts.skewYDeg !== undefined && !isNaN(opts.skewYDeg) && opts.skewYDeg !== 0) {
    skewY += (pitch / 20) * opts.skewYDeg;
  }

  return { sx, sy, skewX, skewY, extraTx, extraTy };
}

export function formatPivotScaleSkewTransform(
  sx: number,
  sy: number,
  skewX: number,
  skewY: number,
  cx: number,
  cy: number
): string {
  const hasScale = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4;
  const hasSkewX = Math.abs(skewX) > 0.01;
  const hasSkewY = Math.abs(skewY) > 0.01;
  if (!hasScale && !hasSkewX && !hasSkewY) return "";

  const inner: string[] = [`translate(${cx.toFixed(2)}, ${cy.toFixed(2)})`];
  if (hasSkewX) {
    inner.push(`skewX(${skewX.toFixed(2)})`);
  }
  if (hasSkewY) {
    inner.push(`skewY(${skewY.toFixed(2)})`);
  }
  if (hasScale) {
    inner.push(`scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`);
  }
  inner.push(`translate(${(-cx).toFixed(2)}, ${(-cy).toFixed(2)})`);
  return inner.join(" ");
}
