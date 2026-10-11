/**
 * Directive Condition Evaluation & Directive Transformations
 */

import type { ParamFrame } from "../shared/types.ts";

export function evaluateCondition(
  expr: string | undefined | null,
  frame: Partial<ParamFrame>,
  activeExpressions: Record<string, boolean> = {}
): boolean {
  if (!expr || !expr.trim()) return true;

  try {
    const decoded = expr
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    const hasComparison = /[><=!]=?/.test(decoded);

    const getParam = (key: string, fallback: any = null): any => {
      const lower = key.toLowerCase();
      for (const k in frame) {
        if (k.toLowerCase() === lower) {
          const val = (frame as any)[k];
          if (val !== undefined && val !== null) return val;
        }
      }
      return fallback;
    };

    const sanitized = decoded.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
      if (match === "true" || match === "false") return match;

      const lower = match.toLowerCase();
      const exprName = lower.startsWith("is") && lower.length > 2 ? lower.substring(2) : lower;

      if (activeExpressions[exprName] !== undefined || activeExpressions[lower] !== undefined) {
        return String(Boolean(activeExpressions[exprName] || activeExpressions[lower]));
      }

      if (!hasComparison) {
        if (lower === "blinkl" || lower === "isblinkl") {
          const b = getParam("isBlinkL", null);
          return String(
            b !== null
              ? Boolean(b)
              : getParam("blinkL", 0) >= getParam("blinkThresholdL", getParam("blinkThreshold", 0.45))
          );
        }
        if (lower === "blinkr" || lower === "isblinkr") {
          const b = getParam("isBlinkR", null);
          return String(
            b !== null
              ? Boolean(b)
              : getParam("blinkR", 0) >= getParam("blinkThresholdR", getParam("blinkThreshold", 0.45))
          );
        }
        if (lower === "mouthopen" || lower === "ismouthopen") {
          const b = getParam("isMouthOpen", null);
          return String(
            b !== null
              ? Boolean(b)
              : getParam("mouthOpen", 0) >= getParam("mouthThreshold", 0.08)
          );
        }
        if (lower === "smile" || lower === "issmiling") {
          const b = getParam("isSmiling", null);
          return String(
            b !== null
              ? Boolean(b)
              : getParam("smile", 0) >= getParam("smileThreshold", 0.5)
          );
        }
        if (lower === "speaking" || lower === "isspeaking") {
          return String(Boolean(getParam("isSpeaking", false)));
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

export interface DirectiveItem {
  type: string;
  Type?: string;
  name?: string;
  params: Record<string, string>;
  _currentOpacity?: number;
  _angle?: number;
  _velocity?: number;
  _chainAngle?: number;
  _chainVel?: number;
  _parentBinding?: any;
}

export function parseDirectiveString(str: string): DirectiveItem[] {
  if (!str) return [];
  const regex = /([A-Za-z]+)\s*\{([^}]+)\}/g;
  const directives: DirectiveItem[] = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    const name = match[1];
    const paramStr = match[2] || "";
    const params: Record<string, string> = {};
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
      name: name,
      params,
    });
  }
  return directives;
}

export function parseDuration(val: string | number | undefined | null, defaultMs: number = 3500): number {
  if (!val && val !== 0) return defaultMs;
  const str = String(val).trim().toLowerCase();
  if (str.endsWith("ms")) {
    return parseFloat(str) || defaultMs;
  }
  if (str.endsWith("s")) {
    return (parseFloat(str) || 1) * 1000;
  }
  return parseFloat(str) || defaultMs;
}
