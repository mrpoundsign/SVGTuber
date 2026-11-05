// web/src/overlay/directives.ts
function evaluateCondition(expr, frame, activeExpressions = {}) {
  if (!expr || !expr.trim()) return true;
  try {
    const decoded = expr.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const hasComparison = /[><=!]=?/.test(decoded);
    const getParam = (key, fallback = null) => {
      const lower = key.toLowerCase();
      for (const k in frame) {
        if (k.toLowerCase() === lower) {
          const val = frame[k];
          if (val !== void 0 && val !== null) return val;
        }
      }
      return fallback;
    };
    const sanitized = decoded.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
      if (match === "true" || match === "false") return match;
      const lower = match.toLowerCase();
      const exprName = lower.startsWith("is") && lower.length > 2 ? lower.substring(2) : lower;
      if (activeExpressions[exprName] !== void 0 || activeExpressions[lower] !== void 0) {
        return String(Boolean(activeExpressions[exprName] || activeExpressions[lower]));
      }
      if (!hasComparison) {
        if (lower === "blinkl" || lower === "isblinkl") {
          const b = getParam("isBlinkL", null);
          return String(
            b !== null ? Boolean(b) : getParam("blinkL", 0) >= getParam("blinkThresholdL", getParam("blinkThreshold", 0.45))
          );
        }
        if (lower === "blinkr" || lower === "isblinkr") {
          const b = getParam("isBlinkR", null);
          return String(
            b !== null ? Boolean(b) : getParam("blinkR", 0) >= getParam("blinkThresholdR", getParam("blinkThreshold", 0.45))
          );
        }
        if (lower === "mouthopen" || lower === "ismouthopen") {
          const b = getParam("isMouthOpen", null);
          return String(
            b !== null ? Boolean(b) : getParam("mouthOpen", 0) >= getParam("mouthThreshold", 0.08)
          );
        }
        if (lower === "smile" || lower === "issmiling") {
          const b = getParam("isSmiling", null);
          return String(
            b !== null ? Boolean(b) : getParam("smile", 0) >= getParam("smileThreshold", 0.5)
          );
        }
        if (lower === "speaking" || lower === "isspeaking") {
          return String(Boolean(getParam("isSpeaking", false)));
        }
        if (lower === "cheekpuff" || lower === "ischeekpuff") {
          const b = getParam("isCheekPuff", null);
          return String(b !== null ? Boolean(b) : getParam("cheekPuff", 0) >= 0.35);
        }
        if (lower === "mouthpucker" || lower === "ismouthpucker" || lower === "pucker" || lower === "ispucker") {
          const b = getParam("isMouthPucker", null);
          return String(b !== null ? Boolean(b) : getParam("mouthPucker", 0) >= 0.35);
        }
        if (lower === "tongueout" || lower === "istongueout") {
          const b = getParam("isTongueOut", null);
          return String(b !== null ? Boolean(b) : getParam("tongueOut", 0) >= 0.35);
        }
        if (lower === "frown" || lower === "isfrowning" || lower === "isfrown") {
          const b = getParam("isFrowning", null);
          return String(b !== null ? Boolean(b) : getParam("frown", 0) >= 0.35);
        }
        if (lower === "nosesneer" || lower === "issneering" || lower === "sneer") {
          const b = getParam("isSneering", null);
          return String(b !== null ? Boolean(b) : getParam("noseSneer", 0) >= 0.35);
        }
        if (lower === "eyesquint" || lower === "iseyesquint") {
          return String(getParam("eyeSquint", 0) >= 0.35);
        }
        if (lower === "shouting" || lower === "isshouting" || lower === "shout") {
          return String(Boolean(getParam("isShouting", false)));
        }
        if (lower === "laughing" || lower === "islaughing" || lower === "laugh") {
          return String(Boolean(getParam("isLaughing", false)));
        }
        if (lower === "visemea" || lower === "isvisemea") {
          return String(getParam("viseme", "") === "A" || getParam("visemeA", 0) >= 0.45);
        }
        if (lower === "visemei" || lower === "isvisemei") {
          return String(getParam("viseme", "") === "I" || getParam("visemeI", 0) >= 0.45);
        }
        if (lower === "visemeu" || lower === "isvisemeu") {
          return String(getParam("viseme", "") === "U" || getParam("visemeU", 0) >= 0.45);
        }
        if (lower === "visemee" || lower === "isvisemee") {
          return String(getParam("viseme", "") === "E" || getParam("visemeE", 0) >= 0.45);
        }
        if (lower === "visemeo" || lower === "isvisemeo") {
          return String(getParam("viseme", "") === "O" || getParam("visemeO", 0) >= 0.45);
        }
      }
      const val = getParam(match, null);
      if (typeof val === "boolean" || typeof val === "number") {
        return String(val);
      }
      return "0";
    });
    if (/^[0-9.\s><=!&|()+\-*/a-zA-Z]+$/.test(sanitized)) {
      return Boolean(Function(`"use strict"; return (${sanitized});`)());
    }
  } catch (e) {
    console.warn("[SVGTuber] evaluateCondition error:", e, expr);
  }
  return true;
}
function parseDirectiveString(str) {
  if (!str) return [];
  const regex = /([A-Za-z]+)\s*\{([^}]+)\}/g;
  const directives = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    const name = match[1];
    const paramStr = match[2] || "";
    const params = {};
    if (paramStr.trim()) {
      paramStr.split(";").forEach((pair) => {
        const idx = pair.indexOf(":");
        if (idx !== -1) {
          const k = pair.substring(0, idx).trim().toLowerCase();
          const v = pair.substring(idx + 1).trim();
          if (k) params[k] = v;
        } else if (pair.trim()) {
          const k = pair.trim().toLowerCase();
          params[k] = "true";
        }
      });
    }
    directives.push({
      type: name,
      Type: name,
      name,
      params
    });
  }
  return directives;
}
function parseDuration(val, defaultMs = 3500) {
  if (!val && val !== 0) return defaultMs;
  const str = String(val).trim().toLowerCase();
  if (str.endsWith("ms")) {
    return parseFloat(str) || defaultMs;
  }
  if (str.endsWith("s")) {
    return (parseFloat(str) || 1) * 1e3;
  }
  return parseFloat(str) || defaultMs;
}

// web/src/overlay/rig.ts
function resolvePivot(pivotStr, bbox, resolveTargetBBox) {
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
function computeMouthExclusivity(states) {
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
function findAnchorTarget(svg, targetName, bindings = []) {
  if (!targetName || targetName === "root_svg") return svg;
  let target = svg.querySelector(`#${CSS.escape(targetName)}`);
  if (target) return target;
  target = svg.querySelector(`[data-name="${CSS.escape(targetName)}"]`) || svg.querySelector(`[inkscape\\:label="${CSS.escape(targetName)}"]`) || svg.querySelector(`[aria-label="${CSS.escape(targetName)}"]`);
  if (target) return target;
  target = svg.querySelector(`[id*="${CSS.escape(targetName)}"]`) || svg.querySelector(`[data-name*="${CSS.escape(targetName)}"]`) || svg.querySelector(`[inkscape\\:label*="${CSS.escape(targetName)}"]`);
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
    target = svg.querySelector("#layer_head") || svg.querySelector("#head") || svg.querySelector('[data-name*="Head" i]') || svg.querySelector('[inkscape\\:label*="Head" i]') || svg.querySelector('[id*="Head" i]') || svg.querySelector('[id*="head" i]');
    if (target) return target;
  }
  return svg;
}
function classifyRigBindings25D(svg, bindings, fallbackCenter) {
  let headCenterCx = 0;
  let headHalfWidth = 100;
  let headNeckCy = 0;
  const headNode = findAnchorTarget(svg, "layer_head", bindings);
  if (headNode && headNode !== svg) {
    try {
      const skullBase = headNode.querySelector("#Head_Base_Group, #Head, #head_base, #face_base, #ellipse7") || headNode;
      const hb = skullBase.getBBox();
      if (hb && hb.width > 0) {
        headCenterCx = hb.x + hb.width / 2;
        headHalfWidth = Math.max(20, hb.width / 2);
        headNeckCy = hb.y + hb.height * 0.88;
      }
    } catch {
    }
  }
  if (headCenterCx === 0 && fallbackCenter) {
    headCenterCx = fallbackCenter.x;
    headHalfWidth = Math.max(40, fallbackCenter.x * 0.35);
    headNeckCy = fallbackCenter.y * 1.15;
  }
  for (const b of bindings) {
    const lowerId = (b.id || "").toLowerCase();
    const lowerLabel = (b.label || "").toLowerCase();
    b._isHeadRoot = Boolean(headNode && headNode !== svg && b.el === headNode) || lowerId === "head" || lowerId === "layer_head" || lowerId === "head_group" || lowerLabel.startsWith("head ") || lowerLabel.startsWith("head[") || lowerLabel.startsWith("head_group");
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
      } catch {
      }
    }
    b._sideOffset = Math.max(-1, Math.min(1, (visualCx - headCenterCx) / headHalfWidth));
    const inHead = Boolean(headNode && headNode !== svg && headNode.contains(b.el));
    if (!inHead) {
      b._partRole = "other";
      continue;
    }
    const intermediateAncestors = bindings.filter(
      (pb) => pb !== b && !pb._isHeadRoot && Boolean(headNode && headNode.contains(pb.el)) && Boolean(pb.el && pb.el.contains(b.el))
    );
    if (intermediateAncestors.length > 0) {
      const distParent = intermediateAncestors.find(
        (pb) => pb.directives.some((d) => {
          const t = (d.type || d.Type || d.name || "").toLowerCase().trim();
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
      const t = (d.type || d.Type || d.name || "").toLowerCase().trim();
      return t === "dist" || t === "distance" || t === "parallax";
    });
    const hasSway = b.directives.some((d) => {
      const t = (d.type || d.Type || d.name || "").toLowerCase().trim();
      return t === "sway";
    });
    const lowerCombined = `${(b.id || "").toLowerCase()} ${(b.label || "").toLowerCase()}`;
    if (hasDist) {
      b._partRole = "face_dist";
      b._scaleCy = b.cy;
      const nostrils = b.el.querySelectorAll('[id*="Nostril" i], [id*="nostril" i]');
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
              _sideOffset: Math.max(-1, Math.min(1, (nCx - dpCx) / dpHalfW))
            });
          }
        } catch {
        }
      });
    } else if (hasSway || /ear|horn|antenn|braid|hair_side|ahoge|top_accessory|forelock/.test(lowerCombined)) {
      b._partRole = "ear_or_horn";
    } else {
      b._partRole = "face_feature";
    }
  }
}
function compute25DPerspective(opts) {
  const yaw = opts.headYaw || 0;
  const pitch = opts.headPitch || 0;
  const amt = opts.amount !== void 0 ? opts.amount : 0;
  const yawRad = yaw * Math.PI / 180;
  const pitchRad = pitch * Math.PI / 180;
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
  const role = opts.partRole || (opts.isHeadRoot ? "head_root" : opts.distFactor ? "face_dist" : "other");
  if (amt > 0) {
    if (role === "head_root") {
      sx *= 1 - (1 - cosYaw) * 0.18 * amt;
      sy *= 1 - (1 - cosPitch) * 0.12 * amt;
      skewY += -(yaw / 25) * (pitch / 20) * 1.8 * amt;
      extraTx += -yaw * 0.12 * amt;
    } else if (role === "ear_or_horn") {
      const asymK = side * sinYaw >= 0 ? 0.5 : 0.18;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.1 * amt;
      sx *= Math.max(0.55, Math.min(1.2, autoScale));
      skewY += -side * (pitch / 20) * 3.5 * amt;
    } else if (role === "face_feature") {
      extraTx += yaw * 0.068 * 2.2 * amt - side * (1 - cosYaw) * 5 * amt;
      extraTy += pitch * 0.18 * amt - (1 - cosYaw) * 12 * amt;
      const asymK = side * sinYaw >= 0 ? 0.38 : 0.16;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.1 * amt;
      sx *= Math.max(0.62, Math.min(1.18, autoScale));
      sy *= 1 - (1 - cosPitch) * 0.1 * amt;
      skewY += -(yaw / 25) * (pitch / 20) * 1.5 * amt;
    } else if (role === "face_dist") {
      const df = opts.distFactor !== void 0 ? opts.distFactor : 0.14;
      extraTx += yaw * (df * 0.2) * amt;
      extraTy += pitch * (df * 0.55) * amt - (1 - cosYaw) * 22 * amt;
      const autoScale = 1 - (1 - cosYaw) * 0.2 * amt;
      sx *= Math.max(0.74, Math.min(1.1, autoScale));
      sy *= 1 - (1 - cosPitch) * 0.14 * amt;
    } else if (role === "snout_sub") {
      extraTx += -side * (1 - cosYaw) * 3 * amt;
      const asymK = side * sinYaw >= 0 ? 0.4 : 0.16;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.06 * amt;
      sx *= Math.max(0.6, Math.min(1.16, autoScale));
    } else {
      const asymK = side * sinYaw >= 0 ? 0.35 : 0.18;
      const autoScale = 1 - side * sinYaw * asymK * amt - (1 - cosYaw) * 0.12 * amt;
      sx *= Math.max(0.58, Math.min(1.22, autoScale));
      skewY += -(yaw / 25) * (pitch / 20) * 2.5 * amt;
    }
  }
  if (opts.foreshorten !== void 0 && !isNaN(opts.foreshorten) && opts.foreshorten !== 0) {
    sx *= 1 - (1 - cosYaw) * opts.foreshorten;
    sy *= 1 - (1 - cosPitch) * (opts.foreshorten * 0.75);
  }
  if (opts.persp !== void 0 && !isNaN(opts.persp) && opts.persp !== 0) {
    const pScale = 1 - side * sinYaw * opts.persp;
    sx *= Math.max(0.55, Math.min(1.3, pScale));
  }
  if (opts.skewXDeg !== void 0 && !isNaN(opts.skewXDeg) && !isNaN(opts.skewXDeg) && opts.skewXDeg !== 0) {
    skewX += yaw / 25 * opts.skewXDeg;
  }
  if (opts.skewYDeg !== void 0 && !isNaN(opts.skewYDeg) && opts.skewYDeg !== 0) {
    skewY += pitch / 20 * opts.skewYDeg;
  }
  return { sx, sy, skewX, skewY, extraTx, extraTy };
}
function formatPivotScaleSkewTransform(sx, sy, skewX, skewY, cx, cy) {
  const hasScale = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4;
  const hasSkewX = Math.abs(skewX) > 0.01;
  const hasSkewY = Math.abs(skewY) > 0.01;
  if (!hasScale && !hasSkewX && !hasSkewY) return "";
  const inner = [`translate(${cx.toFixed(2)}, ${cy.toFixed(2)})`];
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

// web/src/overlay/accessories.ts
function buildAccessoryTransform(acc, anchor) {
  const finalX = anchor.x + (acc.x || 0);
  const finalY = anchor.y + (acc.y || 0);
  const rot = acc.rotation || 0;
  const sx = acc.scaleX !== void 0 ? acc.scaleX : 1;
  const sy = acc.scaleY !== void 0 ? acc.scaleY : 1;
  return `translate(${finalX}, ${finalY}) rotate(${rot}) scale(${sx}, ${sy})`;
}
function isAccessoryVisible(acc, activeExpressions = {}) {
  if (!acc.enabled) return false;
  const trigger = (acc.expression || "").trim().toLowerCase();
  if (!trigger) return true;
  const exprName = trigger.startsWith("is") && trigger.length > 2 ? trigger.substring(2) : trigger;
  return Boolean(activeExpressions[exprName] || activeExpressions[trigger]);
}

// web/src/overlay/index.ts
(() => {
  const container = document.getElementById("avatar-container");
  const statusIndicator = document.getElementById("status-indicator");
  if (!container) return;
  let socket = null;
  let reconnectTimer = null;
  let activeRigBindings = [];
  let boundMouthNeutral = null;
  let boundMouthSmile = null;
  let boundMouthOpen = null;
  let boundMouthOpenBaseTransform = "";
  let boundOpenCx = 256;
  let boundOpenCy = 310;
  let boundMouthA = null;
  let boundMouthI = null;
  let boundMouthU = null;
  let boundMouthE = null;
  let boundMouthO = null;
  let boundMouthFrown = null;
  let boundMouthFrownIsAuto = false;
  let boundFrownCx = 256;
  let boundFrownCy = 310;
  let boundMouthTongue = null;
  let boundTongueCx = 256;
  let boundTongueTopY = 315;
  let boundEyesOpen = null;
  let boundEyesClosed = null;
  let boundEyeOpenL = null;
  let boundEyeClosedL = null;
  let boundEyeOpenR = null;
  let boundEyeClosedR = null;
  let activeExpressions = {};
  let activeAccessories = [];
  const accessorySVGCache = /* @__PURE__ */ new Map();
  const urlParams = new URLSearchParams(window.location.search);
  const isFreezeMode = urlParams.has("freeze") || urlParams.has("rest");
  let latestParams = {
    present: false,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    eyeX: 0,
    eyeY: 0,
    blinkL: 0,
    blinkR: 0,
    mouthOpen: 0,
    smile: 0,
    browUp: 0,
    browL: 0,
    browR: 0,
    mouthThreshold: 0.08,
    blinkThreshold: 0.45,
    blinkThresholdL: 0.45,
    blinkThresholdR: 0.45,
    blinkSyncDelayMs: 50
  };
  let animLoopStarted = false;
  let perspSkewOverride = {};
  let perspPreviewUntil = 0;
  let perspPreviewStart = 0;
  function applySettingsOverride(settings, preview25D = false) {
    if (!settings || !settings.tracking) return;
    const t = settings.tracking;
    if (typeof t.perspectiveSkewEnabled === "boolean") {
      perspSkewOverride.enabled = t.perspectiveSkewEnabled;
      latestParams.perspectiveSkewEnabled = t.perspectiveSkewEnabled;
    }
    if (typeof t.perspectiveSkewAmount === "number" && !isNaN(t.perspectiveSkewAmount)) {
      perspSkewOverride.amount = t.perspectiveSkewAmount;
      latestParams.perspectiveSkewAmount = t.perspectiveSkewAmount;
    }
    if (typeof t.physicsEnabled === "boolean") {
      latestParams.physicsEnabled = t.physicsEnabled;
    }
    if (typeof t.physicsAmount === "number" && !isNaN(t.physicsAmount)) {
      latestParams.physicsAmount = t.physicsAmount;
    }
    if (typeof t.depthZoomAmount === "number" && !isNaN(t.depthZoomAmount)) {
      latestParams.depthZoomAmount = t.depthZoomAmount;
    }
    const hasPositivePerspAmt = perspSkewOverride.amount === void 0 || perspSkewOverride.amount > 0;
    if (preview25D && perspSkewOverride.enabled && hasPositivePerspAmt) {
      const now = performance.now();
      if (now >= perspPreviewUntil) {
        perspPreviewStart = now;
      }
      perspPreviewUntil = now + 2200;
    } else if (!perspSkewOverride.enabled || !hasPositivePerspAmt) {
      perspPreviewUntil = 0;
    }
  }
  try {
    const rawSaved = localStorage.getItem("svgtuber_persp_skew");
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (typeof parsed.enabled === "boolean") {
        perspSkewOverride.enabled = parsed.enabled;
        latestParams.perspectiveSkewEnabled = parsed.enabled;
      }
      if (typeof parsed.amount === "number" && !isNaN(parsed.amount)) {
        perspSkewOverride.amount = parsed.amount;
        latestParams.perspectiveSkewAmount = parsed.amount;
      }
    }
  } catch {
  }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const settingsChannel = new BroadcastChannel("svgtuber_settings");
      settingsChannel.onmessage = (ev) => {
        const data = ev.data;
        if (data && data.type === "settings_update" && data.settings) {
          applySettingsOverride(data.settings, Boolean(data.preview25D));
        }
      };
    } catch {
    }
  }
  window.addEventListener("storage", (ev) => {
    if (ev.key === "svgtuber_persp_skew" && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue);
        if (typeof parsed.enabled === "boolean") {
          perspSkewOverride.enabled = parsed.enabled;
          latestParams.perspectiveSkewEnabled = parsed.enabled;
        }
        if (typeof parsed.amount === "number" && !isNaN(parsed.amount)) {
          perspSkewOverride.amount = parsed.amount;
          latestParams.perspectiveSkewAmount = parsed.amount;
        }
        if (parsed.previewAt && Date.now() - parsed.previewAt < 1500 && perspSkewOverride.enabled) {
          const now = performance.now();
          if (now >= perspPreviewUntil) {
            perspPreviewStart = now;
          }
          perspPreviewUntil = now + 2200;
        }
      } catch {
      }
    }
  });
  async function fetchInitialSettings() {
    try {
      const res = await fetch(`/api/settings?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.settings) {
        applySettingsOverride(data.settings, false);
      }
    } catch {
    }
  }
  function setStatus(text, visible = false) {
    if (statusIndicator) {
      statusIndicator.textContent = text;
      if (visible) {
        document.body.classList.add("show-status");
      } else {
        document.body.classList.remove("show-status");
      }
    }
  }
  async function loadRig() {
    try {
      const res = await fetch(`/rig.json?t=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const rigDef = await res.json();
      bindRig(rigDef);
    } catch (err) {
      console.warn("[SVGTuber] Could not load rig.json:", err);
    }
  }
  function bindRig(rigDef) {
    const accessoryBindings = activeRigBindings.filter((b) => b.isAccessoryBinding);
    activeRigBindings = [];
    boundMouthNeutral = null;
    boundMouthSmile = null;
    boundMouthOpen = null;
    boundMouthOpenBaseTransform = "";
    boundMouthA = null;
    boundMouthI = null;
    boundMouthU = null;
    boundMouthE = null;
    boundMouthO = null;
    boundMouthFrown = null;
    boundMouthFrownIsAuto = false;
    boundMouthTongue = null;
    boundEyesOpen = null;
    boundEyesClosed = null;
    boundEyeOpenL = null;
    boundEyeClosedL = null;
    boundEyeOpenR = null;
    boundEyeClosedR = null;
    if (!rigDef || !rigDef.elements || rigDef.elements.length === 0) {
      activeRigBindings = accessoryBindings;
      return;
    }
    const svg = container.querySelector("svg");
    if (!svg) {
      activeRigBindings = accessoryBindings;
      return;
    }
    svg.querySelector("#svgtuber_mouth_frown_auto")?.remove();
    rigDef.elements.forEach((elem) => {
      let el = elem.id ? svg.querySelector(`#${CSS.escape(elem.id)}`) : null;
      if (!el && elem.label) {
        el = svg.querySelector(`[data-name="${CSS.escape(elem.label)}"]`);
      }
      if (!el && elem.label) {
        el = svg.querySelector(`[inkscape\\:label="${CSS.escape(elem.label)}"]`);
      }
      if (!el && elem.label) {
        el = svg.querySelector(`[aria-label="${CSS.escape(elem.label)}"]`);
      }
      if (!el) return;
      if (!el.id && elem.id) {
        el.id = elem.id;
      }
      const lowerId = (elem.id || "").toLowerCase();
      const lowerLabel = (elem.label || "").toLowerCase();
      if (lowerId === "mouth_neutral" || lowerId === "mouth_resting_group" || lowerLabel.includes("mouth neutral") || lowerLabel.includes("mouth_resting")) {
        boundMouthNeutral = el;
      }
      if (lowerId === "mouth_smile" || lowerId === "mouth_smile_group" || lowerLabel.includes("mouth smile") || lowerLabel.includes("mouth_smile")) {
        boundMouthSmile = el;
      }
      if (lowerId === "mouth_open" || lowerId === "mouth_open_group" || lowerLabel.includes("mouth open") || lowerLabel.includes("mouth_open")) {
        boundMouthOpen = el;
      }
      if (lowerId === "mouth_frown" || lowerId === "mouth_frown_group" || lowerLabel.includes("mouth frown") || lowerLabel.includes("mouth_frown")) {
        boundMouthFrown = el;
      }
      if (lowerId === "mouth_a" || lowerLabel.includes("mouth a") || lowerLabel.includes("viseme_a")) {
        boundMouthA = el;
      }
      if (lowerId === "mouth_i" || lowerLabel.includes("mouth i") || lowerLabel.includes("viseme_i")) {
        boundMouthI = el;
      }
      if (lowerId === "mouth_u" || lowerLabel.includes("mouth u") || lowerLabel.includes("viseme_u")) {
        boundMouthU = el;
      }
      if (lowerId === "mouth_e" || lowerLabel.includes("mouth e") || lowerLabel.includes("viseme_e")) {
        boundMouthE = el;
      }
      if (lowerId === "mouth_o" || lowerLabel.includes("mouth o") || lowerLabel.includes("viseme_o")) {
        boundMouthO = el;
      }
      if (lowerId === "eyes_open" || lowerLabel.includes("eyes open")) boundEyesOpen = el;
      if (lowerId === "eyes_closed" || lowerLabel.includes("eyes closed")) boundEyesClosed = el;
      if (lowerId === "eye_open_left" || lowerLabel.includes("left eye open")) boundEyeOpenL = el;
      if (lowerId === "eye_closed_left" || lowerLabel.includes("left eye closed")) boundEyeClosedL = el;
      if (lowerId === "eye_open_right" || lowerLabel.includes("right eye open")) boundEyeOpenR = el;
      if (lowerId === "eye_closed_right" || lowerLabel.includes("right eye closed")) boundEyeClosedR = el;
      let cx = 0, cy = 0;
      let measuredBBox;
      const prevDisplay = el.style.display;
      const isHidden = getComputedStyle(el).display === "none" || prevDisplay === "none";
      if (isHidden) {
        el.style.display = "inline";
      }
      try {
        const bbox = el.getBBox();
        measuredBBox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
        const directives = elem.directives || [];
        let explicitPivot;
        for (const d of directives) {
          const params = d.params || d.Params || {};
          if (params.pivot) {
            explicitPivot = params.pivot;
            break;
          }
        }
        const p = resolvePivot(explicitPivot, bbox, (id) => {
          const targetEl = svg.querySelector(id);
          return targetEl ? targetEl.getBBox() : null;
        });
        cx = p.cx;
        cy = p.cy;
      } catch (e) {
        console.warn(`[SVGTuber] getBBox failed for #${elem.id}:`, e);
      } finally {
        if (isHidden) {
          el.style.display = prevDisplay;
        }
      }
      const baseTransform = elem.transform || el.getAttribute("transform") || "";
      activeRigBindings.push({
        el,
        id: elem.id || el.id || "",
        label: elem.label || "",
        cx,
        cy,
        bbox: measuredBBox,
        baseTransform,
        directives: elem.directives || []
      });
    });
    activeRigBindings.push(...accessoryBindings);
    const smileEl = boundMouthSmile;
    if (!boundMouthFrown && smileEl && smileEl.parentElement) {
      try {
        const prevDisp = smileEl.style.display;
        smileEl.style.display = "inline";
        const sb = smileEl.getBBox();
        smileEl.style.display = prevDisp;
        boundFrownCx = sb.x + sb.width / 2;
        boundFrownCy = sb.y + sb.height / 2;
        const frownClone = smileEl.cloneNode(true);
        frownClone.id = "svgtuber_mouth_frown_auto";
        frownClone.querySelectorAll('[id*="Tongue" i], [id*="tongue" i]').forEach((n) => n.remove());
        frownClone.style.display = "none";
        smileEl.parentElement.insertBefore(frownClone, smileEl.nextSibling);
        boundMouthFrown = frownClone;
        boundMouthFrownIsAuto = true;
      } catch (e) {
        console.warn("[SVGTuber] Could not auto-synthesize frown layer:", e);
      }
    }
    const openEl = boundMouthOpen;
    if (openEl) {
      boundMouthOpenBaseTransform = openEl.getAttribute("transform") || "";
      try {
        const prevOpenDisp = openEl.style.display;
        openEl.style.display = "inline";
        const ob = openEl.getBBox();
        openEl.style.display = prevOpenDisp;
        boundOpenCx = ob.x + ob.width / 2;
        boundOpenCy = ob.y + ob.height / 2;
      } catch {
      }
    }
    const tongueScope = openEl || svg;
    boundMouthTongue = tongueScope.querySelector(
      "#Mouth_Tongue, #mouth_tongue, #path18"
    );
    if (boundMouthTongue && openEl) {
      try {
        const prevOpenDisp = openEl.style.display;
        openEl.style.display = "inline";
        const tb = boundMouthTongue.getBBox();
        openEl.style.display = prevOpenDisp;
        boundTongueCx = tb.x + tb.width / 2;
        boundTongueTopY = tb.y;
      } catch {
      }
    }
    const domAccs = svg.querySelectorAll(".svgtuber-accessory");
    domAccs.forEach((accGroup) => scanAndBindAccessoryDirectives(accGroup));
    classifyRigBindings25D(svg, activeRigBindings, computeTargetAnchorCenter(svg, svg));
    console.log(`[SVGTuber] Bound ${activeRigBindings.length} elements to rig directives.`);
    if (!animLoopStarted) {
      animLoopStarted = true;
      requestAnimationFrame(animateLoop);
    }
  }
  async function loadAvatar() {
    try {
      const res = await fetch(`/avatar.svg?t=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const svgText = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");
      const svgElement = doc.documentElement;
      if (svgElement.nodeName.toLowerCase() !== "svg") {
        throw new Error("Parsed document is not an SVG element");
      }
      if (!svgElement.hasAttribute("viewBox") && svgElement.hasAttribute("width") && svgElement.hasAttribute("height")) {
        const w = parseFloat(svgElement.getAttribute("width") || "0");
        const h = parseFloat(svgElement.getAttribute("height") || "0");
        if (!isNaN(w) && !isNaN(h)) {
          svgElement.setAttribute("viewBox", `0 0 ${w} ${h}`);
        }
      }
      container.innerHTML = "";
      container.appendChild(svgElement);
      console.log("[SVGTuber] Avatar SVG loaded successfully.");
      await loadRig();
      await syncAccessories();
    } catch (err) {
      console.error("[SVGTuber] Failed to load avatar:", err);
      setStatus(`Avatar load error: ${err.message}`, true);
    }
  }
  function scanAndBindAccessoryDirectives(accNode) {
    if (!accNode) return;
    const accId = accNode.dataset.accessoryId;
    if (accId) {
      activeRigBindings = activeRigBindings.filter((b) => b.accId !== accId);
    }
    const allElements = [accNode, ...Array.from(accNode.querySelectorAll("*"))];
    allElements.forEach((el) => {
      let label = el.getAttribute("inkscape:label") || el.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label") || el.getAttribute("data-name") || el.getAttribute("aria-label") || el.getAttribute("label") || "";
      if (!label && el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.toLowerCase().endsWith("label") || attr.localName === "label") {
            label = attr.value;
            break;
          }
        }
      }
      if (!label && el.id && el.id.includes("{")) {
        label = el.id;
      }
      if (!label) return;
      const directives = parseDirectiveString(label);
      if (directives.length === 0) return;
      if (el.dataset.originalTransform === void 0) {
        el.dataset.originalTransform = el.getAttribute("transform") || "";
      }
      const baseTransform = el.dataset.originalTransform;
      let cx = 0, cy = 0;
      const prevDisplay = el.style.display;
      const isHidden = getComputedStyle(el).display === "none" || prevDisplay === "none";
      if (isHidden) el.style.display = "inline";
      const curTransform = el.getAttribute("transform");
      if (curTransform !== baseTransform) {
        if (baseTransform) {
          el.setAttribute("transform", baseTransform);
        } else {
          el.removeAttribute("transform");
        }
      }
      try {
        const bbox = el.getBBox();
        let explicitPivot;
        for (const d of directives) {
          const params = d.params || {};
          if (params.pivot) {
            explicitPivot = params.pivot;
            break;
          }
        }
        const p = resolvePivot(explicitPivot, bbox);
        cx = p.cx;
        cy = p.cy;
      } catch (e) {
        console.warn("[SVGTuber] Accessory getBBox error:", e);
      } finally {
        if (curTransform !== null && curTransform !== void 0) {
          el.setAttribute("transform", curTransform);
        }
        if (isHidden) el.style.display = prevDisplay;
      }
      activeRigBindings.push({
        el,
        id: el.id || "",
        label,
        cx,
        cy,
        baseTransform,
        directives,
        isAccessoryBinding: true,
        accId: accId || accNode.dataset.accessoryId
      });
    });
  }
  function computeTargetAnchorCenter(targetNode, svg) {
    if (!targetNode || targetNode === svg) {
      if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
        return {
          x: svg.viewBox.baseVal.x + svg.viewBox.baseVal.width / 2,
          y: svg.viewBox.baseVal.y + svg.viewBox.baseVal.height / 2
        };
      }
      const w = parseFloat(svg.getAttribute("width") || "512") || 512;
      const h = parseFloat(svg.getAttribute("height") || "512") || 512;
      return { x: w / 2, y: h / 2 };
    }
    const attachedAccs = targetNode.querySelectorAll(".svgtuber-accessory");
    const prevDisplays = [];
    attachedAccs.forEach((node) => {
      prevDisplays.push(node.style.display);
      node.style.display = "none";
    });
    const prevDisplay = targetNode.style.display;
    const isHidden = getComputedStyle(targetNode).display === "none" || prevDisplay === "none";
    if (isHidden) targetNode.style.display = "inline";
    let anchorX = 0, anchorY = 0;
    try {
      const tb = targetNode.getBBox();
      if (tb && (tb.width > 0 || tb.height > 0)) {
        anchorX = tb.x + tb.width / 2;
        anchorY = tb.y + tb.height / 2;
      }
    } catch (e) {
    }
    if (isHidden) targetNode.style.display = prevDisplay;
    attachedAccs.forEach((node, i) => {
      node.style.display = prevDisplays[i];
    });
    if (anchorX === 0 && anchorY === 0) {
      if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
        anchorX = svg.viewBox.baseVal.x + svg.viewBox.baseVal.width / 2;
        anchorY = svg.viewBox.baseVal.y + svg.viewBox.baseVal.height / 2;
      } else {
        const w = parseFloat(svg.getAttribute("width") || "512") || 512;
        const h = parseFloat(svg.getAttribute("height") || "512") || 512;
        anchorX = w / 2;
        anchorY = h / 2;
      }
    }
    return { x: anchorX, y: anchorY };
  }
  const inFlightAccessoryLoads = /* @__PURE__ */ new Set();
  let syncQueue = Promise.resolve();
  function syncAccessories(list) {
    syncQueue = syncQueue.then(() => _doSyncAccessories(list)).catch((err) => {
      console.warn("[SVGTuber] syncAccessories error:", err);
    });
    return syncQueue;
  }
  async function _doSyncAccessories(list) {
    if (Array.isArray(list)) {
      activeAccessories = list;
    } else {
      try {
        const res = await fetch(`/api/accessories?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.accessories)) {
            activeAccessories = data.accessories;
          }
        }
      } catch (e) {
      }
    }
    const svg = container.querySelector("svg");
    if (!svg) return;
    const currentAccIds = new Set(activeAccessories.filter((a) => a.enabled).map((a) => a.id));
    const seenAccIds = /* @__PURE__ */ new Set();
    const existingDomAccs = svg.querySelectorAll(".svgtuber-accessory");
    existingDomAccs.forEach((node) => {
      const accId = node.dataset.accessoryId || "";
      if (!currentAccIds.has(accId) || seenAccIds.has(accId)) {
        node.remove();
        activeRigBindings = activeRigBindings.filter((b) => b.accId !== accId);
      } else {
        seenAccIds.add(accId);
      }
    });
    for (const acc of activeAccessories) {
      if (!acc.enabled) continue;
      let accGroup = svg.querySelector(
        `.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`
      );
      if (!accGroup) {
        if (inFlightAccessoryLoads.has(acc.id)) continue;
        inFlightAccessoryLoads.add(acc.id);
        let rawSvg = accessorySVGCache.get(acc.file);
        if (!rawSvg) {
          try {
            const res = await fetch(`/accessories/${encodeURIComponent(acc.file)}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            rawSvg = await res.text();
            accessorySVGCache.set(acc.file, rawSvg);
          } catch (err) {
            inFlightAccessoryLoads.delete(acc.id);
            console.warn(`[SVGTuber] Failed to load accessory ${acc.file}:`, err);
            continue;
          }
        }
        const alreadyInserted = svg.querySelector(
          `.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`
        );
        if (alreadyInserted) {
          inFlightAccessoryLoads.delete(acc.id);
          accGroup = alreadyInserted;
        } else {
          const parser = new DOMParser();
          const doc = parser.parseFromString(rawSvg, "image/svg+xml");
          const accSvgEl = doc.documentElement;
          if (!accSvgEl || accSvgEl.nodeName.toLowerCase() !== "svg") {
            inFlightAccessoryLoads.delete(acc.id);
            continue;
          }
          let vbX = 0, vbY = 0, vbW = 100, vbH = 100;
          if (accSvgEl.hasAttribute("viewBox")) {
            const parts = (accSvgEl.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
            if (parts.length === 4) {
              vbX = parts[0];
              vbY = parts[1];
              vbW = parts[2];
              vbH = parts[3];
            }
          } else {
            vbW = parseFloat(accSvgEl.getAttribute("width") || "100") || 100;
            vbH = parseFloat(accSvgEl.getAttribute("height") || "100") || 100;
          }
          const centerX = vbX + vbW / 2;
          const centerY = vbY + vbH / 2;
          accGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          accGroup.classList.add("svgtuber-accessory");
          accGroup.dataset.accessoryId = acc.id;
          accGroup.dataset.accessoryFile = acc.file;
          accGroup.dataset.centerX = String(centerX);
          accGroup.dataset.centerY = String(centerY);
          const innerWrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
          innerWrapper.setAttribute("transform", `translate(${-centerX}, ${-centerY})`);
          while (accSvgEl.firstChild) {
            innerWrapper.appendChild(accSvgEl.firstChild);
          }
          accGroup.appendChild(innerWrapper);
          let targetNode = findAnchorTarget(svg, acc.target || "layer_head", activeRigBindings);
          const anchor = computeTargetAnchorCenter(targetNode, svg);
          accGroup.dataset.anchorX = String(anchor.x);
          accGroup.dataset.anchorY = String(anchor.y);
          accGroup.dataset.currentTarget = acc.target || "layer_head";
          if (acc.order === "back") {
            targetNode.insertBefore(accGroup, targetNode.firstChild);
          } else {
            targetNode.appendChild(accGroup);
          }
          scanAndBindAccessoryDirectives(accGroup);
          inFlightAccessoryLoads.delete(acc.id);
        }
      } else {
        const desiredTarget = findAnchorTarget(svg, acc.target || "layer_head", activeRigBindings);
        const targetChanged = accGroup.dataset.currentTarget !== (acc.target || "layer_head");
        if (accGroup.parentElement !== desiredTarget || targetChanged) {
          accGroup.dataset.currentTarget = acc.target || "layer_head";
          if (acc.order === "back") {
            desiredTarget.insertBefore(accGroup, desiredTarget.firstChild);
          } else {
            desiredTarget.appendChild(accGroup);
          }
          const newAnchor = computeTargetAnchorCenter(desiredTarget, svg);
          accGroup.dataset.anchorX = String(newAnchor.x);
          accGroup.dataset.anchorY = String(newAnchor.y);
        } else {
          if (acc.order === "back" && accGroup !== desiredTarget.firstChild) {
            desiredTarget.insertBefore(accGroup, desiredTarget.firstChild);
          } else if (acc.order === "front" && accGroup !== desiredTarget.lastChild) {
            desiredTarget.appendChild(accGroup);
          }
        }
      }
      const anchorX = parseFloat(accGroup.dataset.anchorX || "0") || 0;
      const anchorY = parseFloat(accGroup.dataset.anchorY || "0") || 0;
      accGroup.setAttribute("transform", buildAccessoryTransform(acc, { x: anchorX, y: anchorY }));
      accGroup.style.display = isAccessoryVisible(acc, activeExpressions) ? "" : "none";
      scanAndBindAccessoryDirectives(accGroup);
    }
  }
  const DEFAULT_PARAM_FALLBACKS = {
    mouththreshold: 0.08,
    blinkthreshold: 0.45,
    smilethreshold: 0.35
  };
  function getParam(name, fallback = 0) {
    if (!name) return fallback;
    const clean = name.trim();
    const lower = clean.toLowerCase();
    const def = DEFAULT_PARAM_FALLBACKS[lower] !== void 0 ? DEFAULT_PARAM_FALLBACKS[lower] : fallback;
    if (!latestParams) return def;
    if (clean in latestParams) {
      const val = latestParams[clean];
      if (typeof val === "number" || typeof val === "boolean") return val;
    }
    for (const key of Object.keys(latestParams)) {
      if (key.toLowerCase() === lower) {
        const val = latestParams[key];
        if (typeof val === "number" || typeof val === "boolean") return val;
      }
    }
    if (latestParams.raw) {
      if (clean in latestParams.raw) return latestParams.raw[clean];
      for (const key of Object.keys(latestParams.raw)) {
        if (key.toLowerCase() === lower) return latestParams.raw[key];
      }
    }
    if ((lower === "browl" || lower === "browr") && typeof latestParams.browUp === "number") {
      return latestParams.browUp;
    }
    if ((lower === "browinnerup" || lower === "browup") && (typeof latestParams.browL === "number" || typeof latestParams.browR === "number")) {
      return Math.max(0, ((latestParams.browL || 0) + (latestParams.browR || 0)) / 2);
    }
    return def;
  }
  let prevHeadYaw = 0;
  let prevHeadPitch = 0;
  let prevHeadRoll = 0;
  let prevAudioVol = 0;
  let lastTransformTime = 0;
  function applyRigTransforms(now) {
    if (activeAccessories && activeAccessories.length > 0) {
      const svg = container.querySelector("svg");
      if (svg) {
        for (const acc of activeAccessories) {
          if (!acc.enabled || !acc.expression) continue;
          const accNode = svg.querySelector(
            `.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`
          );
          if (accNode) {
            accNode.style.display = isAccessoryVisible(acc, activeExpressions) ? "" : "none";
          }
        }
      }
    }
    if (!latestParams || activeRigBindings.length === 0) return;
    const p = latestParams;
    let headYaw = p.headYaw || 0;
    let headPitch = p.headPitch || 0;
    const headRoll = p.headRoll || 0;
    const audioVol = parseFloat(String(p.audioVolume || 0));
    const isPerspEnabled = perspSkewOverride.enabled !== void 0 ? perspSkewOverride.enabled : Boolean(p.perspectiveSkewEnabled);
    let globalPerspAmount = 0;
    if (!isFreezeMode && isPerspEnabled) {
      const rawAmt = perspSkewOverride.amount !== void 0 ? perspSkewOverride.amount : p.perspectiveSkewAmount !== void 0 ? parseFloat(String(p.perspectiveSkewAmount)) : 1;
      globalPerspAmount = isNaN(rawAmt) ? 1 : Math.max(0, rawAmt);
    }
    if (!isFreezeMode && globalPerspAmount > 0 && now < perspPreviewUntil && Math.abs(headYaw) < 5) {
      const elapsed = (now - perspPreviewStart) / 1e3;
      const remRatio = Math.min(1, (perspPreviewUntil - now) / 350);
      headYaw = Math.sin(elapsed * Math.PI * 1.45) * 24 * remRatio;
      headPitch = -Math.sin(elapsed * Math.PI * 1.15) * 10 * remRatio;
    }
    const dt = lastTransformTime ? Math.min(0.05, Math.max(1e-3, (now - lastTransformTime) / 1e3)) : 1 / 60;
    lastTransformTime = now;
    const deltaYaw = headYaw - prevHeadYaw;
    const deltaPitch = headPitch - prevHeadPitch;
    const deltaRoll = headRoll - prevHeadRoll;
    const deltaVol = Math.max(0, audioVol - prevAudioVol);
    prevHeadYaw = headYaw;
    prevHeadPitch = headPitch;
    prevHeadRoll = headRoll;
    prevAudioVol = audioVol;
    let globalPhysicsMult = 1;
    if (isFreezeMode || p.physicsEnabled === false) {
      globalPhysicsMult = 0;
    } else if (p.physicsAmount !== void 0) {
      const val = parseFloat(String(p.physicsAmount));
      globalPhysicsMult = isNaN(val) ? 1 : Math.max(0, val);
    }
    for (let i = 0; i < activeRigBindings.length; i++) {
      const b = activeRigBindings[i];
      const el = b.el;
      let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1, skewX = 0, skewY = 0;
      let bDistFactor;
      let physicsDirective = null;
      for (let j = 0; j < b.directives.length; j++) {
        const d = b.directives[j];
        const type = (d.type || d.Type || d.name || "").toLowerCase().trim();
        const params = d.params || d.Params || {};
        switch (type) {
          case "show": {
            const cond = evaluateCondition(params.when, p, activeExpressions);
            el.style.display = cond ? "inline" : "none";
            break;
          }
          case "hide": {
            const cond = evaluateCondition(params.when, p, activeExpressions);
            el.style.display = cond ? "none" : "inline";
            break;
          }
          case "follow": {
            const yawF = parseFloat(params.yaw || "0");
            const pitchF = parseFloat(params.pitch || "0");
            const rollF = parseFloat(params.roll || "0");
            rot += headRoll * (rollF / 10);
            tx += headYaw * (yawF / 15);
            ty += headPitch * (pitchF / 15);
            const fore = params.foreshorten || params.turnscale ? parseFloat(params.foreshorten || params.turnscale) : void 0;
            const persp = params.persp ? parseFloat(params.persp) : void 0;
            const kx = params.skewx ? parseFloat(params.skewx) : void 0;
            const ky = params.skewy ? parseFloat(params.skewy) : void 0;
            if (fore !== void 0 || persp !== void 0 || kx !== void 0 || ky !== void 0) {
              const p25 = compute25DPerspective({
                headYaw,
                headPitch,
                sideOffset: b._sideOffset || 0,
                partRole: b._partRole,
                isHeadRoot: Boolean(b._isHeadRoot),
                amount: 0,
                foreshorten: fore,
                persp,
                skewXDeg: kx,
                skewYDeg: ky
              });
              sx *= p25.sx;
              sy *= p25.sy;
              skewX += p25.skewX;
              skewY += p25.skewY;
            }
            break;
          }
          case "dist":
          case "distance":
          case "parallax": {
            const factor = parseFloat(params.factor || "0");
            bDistFactor = factor;
            tx += headYaw * factor * 2.2 * globalPerspAmount;
            ty += headPitch * factor * 1.6 * globalPerspAmount;
            const fore = params.foreshorten || params.turnscale ? parseFloat(params.foreshorten || params.turnscale) : void 0;
            const persp = params.persp ? parseFloat(params.persp) : void 0;
            const kx = params.skewx ? parseFloat(params.skewx) : void 0;
            const ky = params.skewy ? parseFloat(params.skewy) : void 0;
            if (fore !== void 0 || persp !== void 0 || kx !== void 0 || ky !== void 0) {
              const p25 = compute25DPerspective({
                headYaw,
                headPitch,
                sideOffset: b._sideOffset || 0,
                partRole: b._partRole,
                isHeadRoot: false,
                distFactor: factor,
                amount: 0,
                foreshorten: fore,
                persp,
                skewXDeg: kx,
                skewYDeg: ky
              });
              sx *= p25.sx;
              sy *= p25.sy;
              skewX += p25.skewX;
              skewY += p25.skewY;
            }
            break;
          }
          case "skew": {
            const hasExplicitAxis = Boolean(params.x || params.y);
            const rawX = params.x ? getParam(params.x, 0) : hasExplicitAxis ? 0 : headYaw / 25;
            const rawY = params.y ? getParam(params.y, 0) : hasExplicitAxis ? 0 : headPitch / 20;
            const px = params.x && params.x.toLowerCase() === "headyaw" ? rawX / 25 : rawX;
            const py = params.y && params.y.toLowerCase() === "headpitch" ? rawY / 20 : rawY;
            const rangeX = parseFloat(params.rangex || params.skewx || params.range || "5");
            const rangeY = parseFloat(params.rangey || params.skewy || params.range || "0");
            skewX += px * rangeX;
            skewY += py * rangeY;
            const fore = params.foreshorten || params.turnscale ? parseFloat(params.foreshorten || params.turnscale) : void 0;
            const persp = params.persp ? parseFloat(params.persp) : void 0;
            if (fore !== void 0 || persp !== void 0) {
              const p25 = compute25DPerspective({
                headYaw,
                headPitch,
                sideOffset: b._sideOffset || 0,
                isHeadRoot: Boolean(b._isHeadRoot),
                amount: 0,
                foreshorten: fore,
                persp
              });
              sx *= p25.sx;
              sy *= p25.sy;
            }
            break;
          }
          case "move": {
            const px = params.x ? getParam(params.x, 0) : 0;
            const py = params.y ? getParam(params.y, 0) : 0;
            const rangeX = parseFloat(params.rangex || params.range || "8");
            const rangeY = parseFloat(params.rangey || params.range || "8");
            tx += px * rangeX;
            ty += py * rangeY;
            break;
          }
          case "scale": {
            const px = params.x ? getParam(params.x, null) : null;
            const py = params.y ? getParam(params.y, null) : null;
            const fromX = parseFloat(params.fromx || params.from || "1.0");
            const toX = parseFloat(params.tox || params.to || "1.0");
            const fromY = parseFloat(params.fromy || params.from || "1.0");
            const toY = parseFloat(params.toy || params.to || "1.0");
            if (px !== null && !isNaN(px)) {
              sx *= fromX + (toX - fromX) * px;
            }
            if (py !== null && !isNaN(py)) {
              sy *= fromY + (toY - fromY) * py;
            }
            break;
          }
          case "depth": {
            const zVal = parseFloat(String(p.headZ || 0));
            const amount = parseFloat(params.amount || params.factor || "0.25");
            const minScale = parseFloat(params.min || "0.80");
            const maxScale = parseFloat(params.max || "1.25");
            const depthScale = Math.max(minScale, Math.min(maxScale, 1 + zVal * amount));
            sx *= depthScale;
            sy *= depthScale;
            break;
          }
          case "idle":
          case "breathe": {
            if (!isFreezeMode) {
              const breathe = parseFloat(params.breathe || "0.02");
              const period = parseDuration(params.period, 3500);
              const phase = now % period / period * 2 * Math.PI;
              const idleFactor = 1 + Math.sin(phase) * breathe;
              sy *= idleFactor;
            }
            break;
          }
          case "rotate": {
            const pVal = getParam(params.param || params.target || params.source, 0);
            if (params.from !== void 0 || params.to !== void 0) {
              const fromAngle = parseFloat(params.from || "0");
              const toAngle = parseFloat(params.to || "0");
              rot += fromAngle + (toAngle - fromAngle) * pVal;
            } else {
              const range = parseFloat(params.range || params.deg || params.angle || "15");
              rot += pVal * range;
            }
            break;
          }
          case "fade":
          case "opacity": {
            let pVal;
            if (params.when) {
              pVal = evaluateCondition(params.when, p, activeExpressions) ? 1 : 0;
            } else {
              const src = params.param || params.target || params.source;
              pVal = getParam(src, 0);
              if (src && src.toLowerCase() === "smile" && activeExpressions && (activeExpressions["blush"] || activeExpressions["isblush"])) {
                pVal = 1;
              }
            }
            const from = parseFloat(params.from !== void 0 ? params.from : "0.0");
            const to = parseFloat(params.to !== void 0 ? params.to : "1.0");
            const targetOpacity = Math.max(0, Math.min(1, from + (to - from) * pVal));
            if (d._currentOpacity === void 0) {
              d._currentOpacity = from;
            }
            let rate = 0.1;
            if (params.speed) {
              rate = Math.max(0.01, Math.min(1, parseFloat(params.speed)));
            } else if (params.duration) {
              const durMs = parseDuration(params.duration, 300);
              rate = Math.max(0.01, Math.min(1, 1e3 / 60 / durMs * 3));
            }
            d._currentOpacity += (targetOpacity - d._currentOpacity) * rate;
            if (Math.abs(targetOpacity - d._currentOpacity) < 5e-3) {
              d._currentOpacity = targetOpacity;
            }
            el.style.opacity = d._currentOpacity.toFixed(3);
            if (d._currentOpacity > 5e-3) {
              el.style.display = "inline";
            } else if (from <= 5e-3 && targetOpacity <= 5e-3) {
              el.style.display = "none";
            }
            break;
          }
          case "bounce": {
            const bounceMult = parseFloat(p.bounceAmount !== void 0 ? String(p.bounceAmount) : "1.0");
            if (bounceMult <= 0) break;
            const height = parseFloat(params.height || params.y || "7");
            const squash = parseFloat(params.squash || "0.04");
            const minVol = parseFloat(params.minvolume || params.gate || "0.03");
            const vol = parseFloat(String(p.audioVolume || 0));
            const isSpeaking = Boolean(p.isSpeaking || vol > minVol);
            const isLaughing = Boolean(p.isLaughing);
            const isShouting = Boolean(p.isShouting);
            if (isSpeaking && vol > 0.01 || isLaughing) {
              const normVol = Math.min(1, Math.max(isLaughing ? 0.55 : 0.2, (vol - minVol) / (1 - minVol)));
              const baseSpeed = parseFloat(params.speed || "16");
              const speed = isLaughing ? baseSpeed * 1.35 : baseSpeed;
              const hop = Math.abs(Math.sin(now * speed * 1e-3));
              const laughBoost = isLaughing ? 1.25 : 1;
              const bounceOffset = -hop * height * normVol * bounceMult * laughBoost;
              ty += bounceOffset;
              if (isShouting) {
                tx += Math.sin(now * 0.085) * 1.4 * bounceMult;
              }
              if (squash > 0) {
                sy *= 1 + hop * squash * normVol * bounceMult * laughBoost;
                sx *= 1 - hop * squash * 0.5 * normVol * bounceMult;
              }
            }
            break;
          }
          case "sway": {
            if (globalPhysicsMult <= 0) break;
            const srcParam = (params.param || params.source || "headRoll").trim();
            const pVal = getParam(srcParam, 0);
            const range = parseFloat(params.range || params.deg || params.angle || "10") * globalPhysicsMult;
            const gravity = parseFloat(params.gravity !== void 0 ? params.gravity : "0.6");
            const stiffness = parseFloat(params.stiffness || params.k || "0.15");
            const damping = parseFloat(params.damping || params.c || "0.82");
            const wind = parseFloat(params.wind || "0");
            const mass = parseFloat(params.mass || params.inertia || "0.5");
            let targetAngle = 0;
            const rollFactor = parseFloat(params.roll !== void 0 ? params.roll : String(gravity));
            const yawFactor = parseFloat(params.yaw !== void 0 ? params.yaw : "0.85");
            if (srcParam.toLowerCase() === "headroll" || srcParam.toLowerCase() === "auto" || srcParam.toLowerCase() === "head") {
              targetAngle = -(headRoll / 15) * range * rollFactor;
              targetAngle += headYaw / 25 * (range * 0.35) * yawFactor;
            } else if (srcParam.toLowerCase() === "headyaw") {
              targetAngle = pVal / 15 * range * yawFactor;
            } else {
              targetAngle = pVal * range;
            }
            if (wind > 0) {
              const phase = b.cx * 0.05 + b.cy * 0.02;
              targetAngle += Math.sin(now * 25e-4 + phase) * wind * range;
            }
            if (d._angle === void 0) {
              d._angle = targetAngle;
              d._velocity = 0;
            }
            if (d._velocity === void 0) {
              d._velocity = 0;
            }
            const stepRatio = dt * 60;
            const rollSign = range < 0 ? -1 : 1;
            const impulse = (-deltaYaw * (params.yaw !== void 0 ? parseFloat(params.yaw) : 1.2) * 2.2 - deltaRoll * (params.roll !== void 0 ? parseFloat(params.roll) : 0.8 * rollSign) * 1.8) * mass * globalPhysicsMult;
            d._velocity += impulse * stepRatio;
            const force = -stiffness * (d._angle - targetAngle);
            d._velocity = (d._velocity + force * stepRatio) * Math.pow(damping, stepRatio);
            d._angle += d._velocity * stepRatio;
            rot += d._angle;
            const swayX = parseFloat(params.swayx || "0");
            if (swayX !== 0) {
              tx += d._angle * swayX;
            }
            break;
          }
          case "physics":
          case "spring": {
            physicsDirective = d;
            break;
          }
          case "chain": {
            if (globalPhysicsMult <= 0) break;
            if (d._parentBinding === void 0) {
              let parentRef = (params.parent || "").trim();
              if (parentRef.startsWith("#")) parentRef = parentRef.substring(1);
              if (parentRef) {
                d._parentBinding = activeRigBindings.find(
                  (pb) => pb !== b && (pb.id === parentRef || pb.el && pb.el.id === parentRef || pb.label && pb.label.toLowerCase().includes(parentRef.toLowerCase()))
                ) || null;
              }
              if (!d._parentBinding) {
                let pNode = b.el.parentElement;
                while (pNode && pNode.tagName && pNode.tagName.toLowerCase() !== "svg") {
                  const pb = activeRigBindings.find((cand) => cand.el === pNode);
                  if (pb) {
                    d._parentBinding = pb;
                    break;
                  }
                  pNode = pNode.parentElement;
                }
              }
              if (!d._parentBinding) {
                const myIdx = activeRigBindings.indexOf(b);
                if (myIdx > 0) {
                  d._parentBinding = activeRigBindings[myIdx - 1];
                }
              }
            }
            const parentB = d._parentBinding;
            if (!parentB) break;
            const factor = parseFloat(params.factor || params.mult || "0.85");
            const lag = Math.max(1, parseInt(params.lag || params.delay || "3", 10));
            const stiffness = parseFloat(params.stiffness || params.k || "0.18");
            const damping = parseFloat(params.damping || params.c || "0.80");
            const whip = parseFloat(params.whip || "0.25") * globalPhysicsMult;
            const history = parentB._rotHistory || [parentB._currentRot || 0];
            const histIdx = Math.max(0, history.length - 1 - lag);
            const delayedRot = history[histIdx] !== void 0 ? history[histIdx] : parentB._currentRot || 0;
            const currentParentRot = parentB._currentRot || 0;
            const parentVel = currentParentRot - (history[history.length - 2] !== void 0 ? history[history.length - 2] : currentParentRot);
            let targetAngle = delayedRot * factor * globalPhysicsMult;
            if (params.range || params.max) {
              const maxAngle = parseFloat(params.range || params.max || "60");
              targetAngle = Math.max(-maxAngle, Math.min(maxAngle, targetAngle));
            }
            if (d._chainAngle === void 0) {
              d._chainAngle = targetAngle;
              d._chainVel = 0;
            }
            if (d._chainVel === void 0) {
              d._chainVel = 0;
            }
            const stepRatio = dt * 60;
            const childWhipImpulse = (-parentVel * whip * 4 - deltaYaw * whip * 2.5) * stepRatio;
            d._chainVel += childWhipImpulse;
            const force = -stiffness * (d._chainAngle - targetAngle);
            d._chainVel = (d._chainVel + force * stepRatio) * Math.pow(damping, stepRatio);
            d._chainAngle += d._chainVel * stepRatio;
            rot += d._chainAngle;
            const isDOMChild = parentB.el && parentB.el.contains(b.el);
            if (!isDOMChild) {
              const rad = (parentB._currentRot || 0) * (Math.PI / 180);
              const dx0 = b.cx - parentB.cx;
              const dy0 = b.cy - parentB.cy;
              const rx = dx0 * Math.cos(rad) - dy0 * Math.sin(rad);
              const ry = dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
              tx += rx - dx0 + (parentB._currentTx || 0);
              ty += ry - dy0 + (parentB._currentTy || 0);
              rot += parentB._currentRot || 0;
            }
            break;
          }
        }
      }
      if (globalPerspAmount > 0 && b._partRole && b._partRole !== "other") {
        const p25 = compute25DPerspective({
          headYaw,
          headPitch,
          sideOffset: b._sideOffset || 0,
          partRole: b._partRole,
          isHeadRoot: Boolean(b._isHeadRoot),
          distFactor: bDistFactor,
          amount: globalPerspAmount
        });
        tx += p25.extraTx;
        ty += p25.extraTy;
        sx *= p25.sx;
        sy *= p25.sy;
        skewX += p25.skewX;
        skewY += p25.skewY;
      }
      if (physicsDirective && globalPhysicsMult > 0) {
        const pParams = physicsDirective.params || physicsDirective.Params || {};
        const k = parseFloat(pParams.stiffness || pParams.k || "0.16");
        const damp = parseFloat(pParams.damping || pParams.c || "0.82");
        const mass = parseFloat(pParams.mass || pParams.inertia || "0.5") * globalPhysicsMult;
        const axis = (pParams.axis || "all").toLowerCase();
        if (!b._physicsState) {
          b._physicsState = {
            curTx: tx,
            curTy: ty,
            curRot: rot,
            vx: 0,
            vy: 0,
            vRot: 0
          };
        }
        const state = b._physicsState;
        const stepRatio = dt * 60;
        const inertiaX = -deltaYaw * mass * 0.9;
        const inertiaY = -deltaPitch * mass * 0.8 - deltaVol * mass * 6;
        const inertiaRot = -deltaRoll * mass * 0.6;
        if (axis === "all" || axis.includes("x")) {
          const forceX = -k * (state.curTx - tx) + inertiaX;
          state.vx = (state.vx + forceX * stepRatio) * Math.pow(damp, stepRatio);
          state.curTx += state.vx * stepRatio;
          tx = state.curTx;
        }
        if (axis === "all" || axis.includes("y")) {
          const forceY = -k * (state.curTy - ty) + inertiaY;
          state.vy = (state.vy + forceY * stepRatio) * Math.pow(damp, stepRatio);
          state.curTy += state.vy * stepRatio;
          ty = state.curTy;
        }
        if (axis === "all" || axis.includes("rot") || axis.includes("angle") || axis.includes("roll")) {
          const forceRot = -k * (state.curRot - rot) + inertiaRot;
          state.vRot = (state.vRot + forceRot * stepRatio) * Math.pow(damp, stepRatio);
          state.curRot += state.vRot * stepRatio;
          rot = state.curRot;
        }
      } else if (b._physicsState && globalPhysicsMult <= 0) {
        b._physicsState.curTx = tx;
        b._physicsState.curTy = ty;
        b._physicsState.curRot = rot;
        b._physicsState.vx = 0;
        b._physicsState.vy = 0;
        b._physicsState.vRot = 0;
      }
      b._currentTx = tx;
      b._currentTy = ty;
      b._currentRot = rot;
      if (!b._rotHistory) {
        b._rotHistory = [];
      }
      b._rotHistory.push(rot);
      if (b._rotHistory.length > 40) {
        b._rotHistory.shift();
      }
      const animParts = [];
      if (tx !== 0 || ty !== 0) {
        animParts.push(`translate(${tx.toFixed(2)}, ${ty.toFixed(2)})`);
      }
      if (rot !== 0) {
        animParts.push(`rotate(${rot.toFixed(2)}, ${b.cx.toFixed(2)}, ${b.cy.toFixed(2)})`);
      }
      const scaleCy = b._scaleCy !== void 0 ? b._scaleCy : b.cy;
      const pivotScaleSkew = formatPivotScaleSkewTransform(sx, sy, skewX, skewY, b.cx, scaleCy);
      if (pivotScaleSkew) {
        animParts.push(pivotScaleSkew);
      }
      if (el.style.transform) el.style.transform = "";
      if (el.style.transformBox) el.style.transformBox = "";
      if (el.style.transformOrigin) el.style.transformOrigin = "";
      if (animParts.length > 0) {
        const animStr = animParts.join(" ");
        el.setAttribute("transform", b.baseTransform ? `${b.baseTransform.trim()} ${animStr}` : animStr);
      } else {
        if (b.baseTransform) {
          el.setAttribute("transform", b.baseTransform.trim());
        } else {
          el.removeAttribute("transform");
        }
      }
    }
    if (boundMouthNeutral || boundMouthSmile || boundMouthOpen || boundMouthFrown) {
      const tongueVal = Math.max(0, Math.min(1, parseFloat(String(p.tongueOut || 0))));
      const frownVal = Math.max(0, Math.min(1, parseFloat(String(p.frown || 0))));
      const puckerVal = Math.max(0, Math.min(1, parseFloat(String(p.mouthPucker || 0))));
      const jawXVal = Math.max(-1, Math.min(1, parseFloat(String(p.jawX || 0))));
      const isTongue = Boolean(p.isTongueOut || tongueVal >= 0.35);
      const frownThresh = parseFloat(String(p.frownThreshold || 0.4));
      const isFrown = Boolean(
        p.isFrowning !== void 0 ? p.isFrowning : frownVal >= frownThresh
      );
      const isSmile = Boolean(boundMouthSmile && boundMouthSmile.style.display !== "none");
      const isOpen = Boolean(boundMouthOpen && boundMouthOpen.style.display !== "none" || isTongue);
      const mResult = computeMouthExclusivity({
        hasNeutral: Boolean(boundMouthNeutral),
        hasSmile: Boolean(boundMouthSmile),
        hasOpen: Boolean(boundMouthOpen),
        isOpen,
        isSmile
      });
      const showFrown = Boolean(!mResult.showOpen && !mResult.showSmile && isFrown && boundMouthFrown);
      const showNeutral = Boolean(mResult.showNeutral && !showFrown);
      if (boundMouthNeutral) {
        boundMouthNeutral.style.display = showNeutral ? "inline" : "none";
        if (showNeutral && (puckerVal > 0.06 || Math.abs(jawXVal) > 0.04 || frownVal > 0.15)) {
          const sxN = 1 - puckerVal * 0.45;
          const syN = 1 + puckerVal * 0.4;
          const jx = jawXVal * 7;
          const fy = frownVal * 2.5;
          boundMouthNeutral.setAttribute(
            "transform",
            `translate(${jx.toFixed(2)}, ${fy.toFixed(2)}) translate(${boundFrownCx.toFixed(2)}, ${boundFrownCy.toFixed(2)}) scale(${sxN.toFixed(3)}, ${syN.toFixed(3)}) translate(${(-boundFrownCx).toFixed(2)}, ${(-boundFrownCy).toFixed(2)})`
          );
        }
      }
      if (boundMouthSmile) boundMouthSmile.style.display = mResult.showSmile ? "inline" : "none";
      const activeViseme = !isTongue && mResult.showOpen ? String(p.viseme || "") : "";
      const explicitVisemeEl = activeViseme === "A" ? boundMouthA : activeViseme === "I" ? boundMouthI : activeViseme === "U" ? boundMouthU : activeViseme === "E" ? boundMouthE : activeViseme === "O" ? boundMouthO : null;
      if (boundMouthA) boundMouthA.style.display = explicitVisemeEl === boundMouthA ? "inline" : "none";
      if (boundMouthI) boundMouthI.style.display = explicitVisemeEl === boundMouthI ? "inline" : "none";
      if (boundMouthU) boundMouthU.style.display = explicitVisemeEl === boundMouthU ? "inline" : "none";
      if (boundMouthE) boundMouthE.style.display = explicitVisemeEl === boundMouthE ? "inline" : "none";
      if (boundMouthO) boundMouthO.style.display = explicitVisemeEl === boundMouthO ? "inline" : "none";
      if (boundMouthOpen) {
        const showGenericOpen = Boolean(mResult.showOpen && !explicitVisemeEl);
        boundMouthOpen.style.display = showGenericOpen ? "inline" : "none";
        if (showGenericOpen) {
          const vA = Math.max(0, Math.min(1, parseFloat(String(p.visemeA || 0))));
          const vI = Math.max(0, Math.min(1, parseFloat(String(p.visemeI || 0))));
          const vU = Math.max(0, Math.min(1, parseFloat(String(p.visemeU || 0))));
          const vE = Math.max(0, Math.min(1, parseFloat(String(p.visemeE || 0))));
          const vO = Math.max(0, Math.min(1, parseFloat(String(p.visemeO || 0))));
          const hasVowelOrPose = vA > 0.05 || vI > 0.05 || vU > 0.05 || vE > 0.05 || vO > 0.05 || puckerVal > 0.06 || Math.abs(jawXVal) > 0.04;
          if (hasVowelOrPose) {
            const sxOpen = Math.max(
              0.52,
              Math.min(
                1.35,
                1 + vA * 0.1 + vI * 0.22 + vE * 0.14 - vU * 0.34 - vO * 0.22 - puckerVal * 0.25
              )
            );
            const syOpen = Math.max(
              0.65,
              Math.min(
                1.35,
                1 + vA * 0.16 + vO * 0.15 - vI * 0.24 - vE * 0.1 - vU * 0.06 + puckerVal * 0.12
              )
            );
            const jx = jawXVal * 7;
            const vowelTransform = `translate(${jx.toFixed(2)}, 0) translate(${boundOpenCx.toFixed(2)}, ${boundOpenCy.toFixed(2)}) scale(${sxOpen.toFixed(3)}, ${syOpen.toFixed(3)}) translate(${(-boundOpenCx).toFixed(2)}, ${(-boundOpenCy).toFixed(2)})`;
            const curOpenTransform = boundMouthOpen.getAttribute("transform") || boundMouthOpenBaseTransform;
            boundMouthOpen.setAttribute(
              "transform",
              curOpenTransform ? `${curOpenTransform.trim()} ${vowelTransform}` : vowelTransform
            );
          }
        }
      }
      if (boundMouthFrown) {
        boundMouthFrown.style.display = showFrown ? "inline" : "none";
        if (showFrown && boundMouthFrownIsAuto) {
          const frownArc = 0.65 + frownVal * 0.35;
          const puckerScaleX = 1 - puckerVal * 0.42;
          const jx = jawXVal * 7;
          boundMouthFrown.setAttribute(
            "transform",
            `translate(${jx.toFixed(2)}, 2.5) translate(${boundFrownCx.toFixed(2)}, ${boundFrownCy.toFixed(2)}) scale(${puckerScaleX.toFixed(3)}, ${(-frownArc).toFixed(3)}) translate(${(-boundFrownCx).toFixed(2)}, ${(-boundFrownCy).toFixed(2)})`
          );
        }
      }
      if (boundMouthTongue) {
        if (mResult.showOpen && tongueVal > 0.08) {
          const tyTongue = tongueVal * 10;
          const sxTongue = 1 + tongueVal * 0.22;
          const syTongue = 1 + tongueVal * 0.95;
          boundMouthTongue.setAttribute(
            "transform",
            `translate(0, ${tyTongue.toFixed(2)}) translate(${boundTongueCx.toFixed(2)}, ${boundTongueTopY.toFixed(2)}) scale(${sxTongue.toFixed(3)}, ${syTongue.toFixed(3)}) translate(${(-boundTongueCx).toFixed(2)}, ${(-boundTongueTopY).toFixed(2)})`
          );
        } else if (boundMouthTongue.hasAttribute("transform")) {
          boundMouthTongue.removeAttribute("transform");
        }
      }
    }
    if (boundEyeClosedL && boundEyeClosedL.style.display !== "none") {
      if (boundEyeOpenL) boundEyeOpenL.style.display = "none";
    }
    if (boundEyeClosedR && boundEyeClosedR.style.display !== "none") {
      if (boundEyeOpenR) boundEyeOpenR.style.display = "none";
    }
    if (boundEyesClosed && boundEyesClosed.style.display !== "none" && !boundEyeClosedL && !boundEyeClosedR) {
      if (boundEyesOpen) boundEyesOpen.style.display = "none";
    }
    if (container && !isFreezeMode) {
      const depthAmt = p.depthZoomAmount !== void 0 ? parseFloat(String(p.depthZoomAmount)) : 0.25;
      const headZ = parseFloat(String(p.headZ || 0));
      if (depthAmt > 0 && Math.abs(headZ) > 2e-3) {
        const zScale = Math.max(0.8, Math.min(1.25, 1 + headZ * depthAmt * 0.35));
        container.style.transform = `scale(${zScale.toFixed(4)})`;
      } else if (container.style.transform) {
        container.style.transform = "";
      }
    }
  }
  function animateLoop(now) {
    applyRigTransforms(now);
    requestAnimationFrame(animateLoop);
  }
  function connectWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const isEmbeddedPreview = window.self !== window.top || urlParams.has("preview");
    const wsUrl = `${protocol}//${location.host}/ws/overlay${isEmbeddedPreview ? "?preview=1" : ""}`;
    console.log(`[SVGTuber] Connecting WebSocket: ${wsUrl}`);
    setStatus("Connecting WebSocket...", true);
    socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      console.log("[SVGTuber] WebSocket connected.");
      setStatus("Connected", false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "reload") {
          console.log("[SVGTuber] Received reload signal, reloading avatar...");
          loadAvatar();
        } else if (msg.type === "rig_update") {
          console.log("[SVGTuber] Received rig update.");
          bindRig(msg.rig);
        } else if (msg.type === "expression_update") {
          activeExpressions = msg.expressions || {};
          syncAccessories();
          applyRigTransforms(performance.now());
        } else if (msg.type === "accessory_update") {
          syncAccessories(msg.accessories);
        } else if (msg.type === "settings_update") {
          if (msg.settings) {
            applySettingsOverride(msg.settings, false);
          }
        } else if (msg.type === "param_frame") {
          if (isFreezeMode) return;
          if (typeof msg.perspectiveSkewEnabled === "boolean") {
            perspSkewOverride.enabled = msg.perspectiveSkewEnabled;
          } else if (perspSkewOverride.enabled !== void 0) {
            msg.perspectiveSkewEnabled = perspSkewOverride.enabled;
          }
          if (typeof msg.perspectiveSkewAmount === "number" && !isNaN(msg.perspectiveSkewAmount)) {
            perspSkewOverride.amount = msg.perspectiveSkewAmount;
          } else if (perspSkewOverride.amount !== void 0) {
            msg.perspectiveSkewAmount = perspSkewOverride.amount;
          }
          latestParams = msg;
          window.latestParams = msg;
          if (msg.expressions) {
            activeExpressions = Object.assign({}, activeExpressions, msg.expressions);
          }
          if (document.hidden) {
            applyRigTransforms(performance.now());
          }
        }
      } catch (err) {
        console.error("[SVGTuber] Failed to parse message:", err, event.data);
      }
    };
    socket.onclose = () => {
      setStatus("Disconnected. Reconnecting...", true);
      scheduleReconnect();
    };
    socket.onerror = (err) => {
      console.error("[SVGTuber] WebSocket error:", err);
      socket?.close();
    };
  }
  function scheduleReconnect() {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2e3);
    }
  }
  fetchInitialSettings();
  loadAvatar();
  connectWebSocket();
})();
