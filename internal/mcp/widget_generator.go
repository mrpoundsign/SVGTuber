package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/mrpoundsign/SVGTuber/internal/rig"
)

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
		}
	}
	return strings.Join(words, " ")
}

// GenerateStudioWidget creates a standalone zero-scroll HTML Studio Widget for ANY avatar.
func GenerateStudioWidget(svgPath string, title string, outputPath string) (string, error) {
	data, err := os.ReadFile(svgPath)
	if err != nil {
		return "", fmt.Errorf("failed to read svg file: %w", err)
	}

	rawSVG := string(data)
	if title == "" {
		base := filepath.Base(svgPath)
		title = strings.TrimSuffix(base, filepath.Ext(base))
		title = strings.ReplaceAll(title, "_", " ")
		title = titleCase(title)
	}

	// Extract rig definition
	rigDef, err := rig.DefaultParser.Parse(data)
	if err != nil {
		return "", fmt.Errorf("failed to extract rig for widget: %w", err)
	}

	// Discover custom hotkey expressions
	exprSet := make(map[string]bool)
	for _, el := range rigDef.Elements {
		for _, d := range el.Directives {
			if when, ok := d.Params["when"]; ok {
				extractExpressionNames(when, exprSet)
			}
		}
	}

	var expressions []string
	for expr := range exprSet {
		expressions = append(expressions, expr)
	}
	sort.Strings(expressions)

	rigJSON, err := json.Marshal(rigDef.Elements)
	if err != nil {
		return "", fmt.Errorf("failed to serialize rig elements: %w", err)
	}

	var exprButtonsBuilder strings.Builder
	for _, exp := range expressions {
		cleanName := strings.TrimPrefix(strings.TrimPrefix(exp, "is"), "has")
		if cleanName == "" {
			cleanName = exp
		}
		displayName := titleCase(cleanName)
		fmt.Fprintf(&exprButtonsBuilder, `
          <button class="expr-btn px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition flex items-center justify-between cursor-pointer" data-expr="%s">
            <span>%s</span>
            <span class="status-indicator w-2 h-2 rounded-full bg-slate-600"></span>
          </button>`, exp, displayName)
	}

	exprButtonsHTML := exprButtonsBuilder.String()
	if exprButtonsHTML == "" {
		exprButtonsHTML = `<div class="text-xs text-slate-400 italic col-span-2">No custom hotkey expressions in rig.</div>`
	}

	// Strip XML prolog or doctype from rawSVG for clean inline embedding
	inlineSVG := rawSVG
	if idx := strings.Index(inlineSVG, "<svg"); idx != -1 {
		inlineSVG = inlineSVG[idx:]
	}

	// Clean height/width to ensure 100% responsiveness
	svgOpenRegex := regexp.MustCompile(`(?i)<svg([^>]*)>`)
	inlineSVG = svgOpenRegex.ReplaceAllStringFunc(inlineSVG, func(m string) string {
		clean := regexp.MustCompile(`(?i)\s+(width|height)=["'][^"']*["']`).ReplaceAllString(m, "")
		return strings.TrimSuffix(clean, ">") + ` style="width:100%; height:100%; max-height:100%; display:block;">`
	})

	htmlContent := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>%s - Studio Widget</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      user-select: none;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .slider-track {
      accent-color: #0ea5e9;
    }
    .expr-btn.active {
      border-color: #38bdf8;
      background: rgba(14, 165, 233, 0.2);
      color: #38bdf8;
    }
    .expr-btn.active .status-indicator {
      background: #38bdf8;
      box-shadow: 0 0 8px #38bdf8;
    }
  </style>
</head>
<body class="bg-[#0b1120] text-[#f8fafc] antialiased h-screen w-screen flex flex-col p-2.5 overflow-hidden box-border">

  <!-- TOP HEADER -->
  <header class="flex items-center justify-between px-3 py-1.5 mb-2 rounded-xl bg-slate-900/80 border border-slate-800 shadow-sm shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-xl">✨</span>
      <div>
        <h1 class="text-xs font-bold text-slate-100 leading-none">%s</h1>
        <p class="text-xs text-sky-400 font-medium leading-none mt-0.5">%d Rigged Layers • 60fps Spring Physics • Hover Stage to Track</p>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      <button id="btn-talk" class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 font-semibold text-xs text-white transition flex items-center gap-1 shadow cursor-pointer">
        <span>🎙️</span> <span id="lbl-talk">Voice Sim</span>
      </button>
      <button id="btn-blink" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer">
        👁️ Blink
      </button>
      <button id="btn-reset" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer">
        ↺ Reset
      </button>
    </div>
  </header>

  <!-- MAIN VIEWPORT -->
  <main class="flex-1 flex flex-row gap-2.5 min-h-0 overflow-hidden">
    
    <!-- LEFT: AVATAR STAGE -->
    <section class="flex-1 flex flex-col rounded-xl bg-slate-900/70 border border-slate-800 p-2 min-w-0 min-h-0 relative shadow-inner">
      <div id="stage-container" 
           class="flex-1 w-full h-full rounded-lg bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center overflow-hidden cursor-pointer relative">
        <div id="avatar-mount" class="w-full h-full p-2 flex items-center justify-center pointer-events-none">
          %s
        </div>
      </div>
    </section>

    <!-- RIGHT: CONTROLS SIDEBAR -->
    <aside class="w-64 flex flex-col gap-2 rounded-xl bg-slate-900/70 border border-slate-800 p-2.5 min-h-0 overflow-hidden shrink-0">
      
      <!-- MOTION SLIDERS -->
      <div class="flex flex-col gap-1.5">
        <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Face Tracking</div>
        
        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Head Yaw</span><span id="val-yaw" class="font-mono text-sky-400">0&deg;</span>
          </div>
          <input type="range" id="slider-yaw" min="-30" max="30" value="0" step="0.5" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Head Pitch</span><span id="val-pitch" class="font-mono text-sky-400">0&deg;</span>
          </div>
          <input type="range" id="slider-pitch" min="-20" max="20" value="0" step="0.5" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Head Roll</span><span id="val-roll" class="font-mono text-sky-400">0&deg;</span>
          </div>
          <input type="range" id="slider-roll" min="-15" max="15" value="0" step="0.5" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>
      </div>

      <hr class="border-slate-800 my-0.5">

      <!-- EXPRESSION SLIDERS -->
      <div class="flex flex-col gap-1.5">
        <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Features</div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Mouth Open</span><span id="val-mouth" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-mouth" min="0" max="1" value="0" step="0.02" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Blink Left</span><span id="val-blink-l" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-blink-l" min="0" max="1" value="0" step="0.02" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Blink Right</span><span id="val-blink-r" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-blink-r" min="0" max="1" value="0" step="0.02" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Brow Left</span><span id="val-brow-l" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-brow-l" min="-1" max="1" value="0" step="0.05" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Brow Right</span><span id="val-brow-r" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-brow-r" min="-1" max="1" value="0" step="0.05" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>

        <div>
          <div class="flex justify-between text-xs text-slate-300">
            <span>Smile</span><span id="val-smile" class="font-mono text-sky-400">0%%</span>
          </div>
          <input type="range" id="slider-smile" min="0" max="1" value="0" step="0.02" class="slider-track w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer">
        </div>
      </div>

      <hr class="border-slate-800 my-0.5">

      <!-- HOTKEY EXPRESSIONS -->
      <div class="flex-1 flex flex-col min-h-0">
        <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Expressions</div>
        <div class="grid grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
          %s
        </div>
      </div>

    </aside>
  </main>

  <script>
    const rigElements = %s;
    const activeExpressions = {};

    const state = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      targetYaw: 0,
      targetPitch: 0,
      targetRoll: 0,
      hoveringStage: false,
      mouthOpen: 0,
      blinkL: 0,
      blinkR: 0,
      browL: 0,
      browR: 0,
      smile: 0,
      audioVolume: 0,
      isTalking: false,
      manualBlink: false,
    };

    function resolvePivot(pivotStr, bbox) {
      let cx = bbox.x + bbox.width / 2;
      let cy = bbox.y + bbox.height / 2;
      if (!pivotStr) return { cx, cy };

      const p = pivotStr.toLowerCase().trim();
      if (p === 'top' || p === 'top-center' || p === 'topcenter') {
        cx = bbox.x + bbox.width / 2;
        cy = bbox.y;
      } else if (p === 'bottom' || p === 'bottom-center' || p === 'bottomcenter') {
        cx = bbox.x + bbox.width / 2;
        cy = bbox.y + bbox.height;
      } else if (p === 'left' || p === 'center-left' || p === 'leftcenter') {
        cx = bbox.x;
        cy = bbox.y + bbox.height / 2;
      } else if (p === 'right' || p === 'center-right' || p === 'rightcenter') {
        cx = bbox.x + bbox.width;
        cy = bbox.y + bbox.height / 2;
      } else if (p === 'top-left' || p === 'topleft' || p === 'top left' || p === 'left top') {
        cx = bbox.x;
        cy = bbox.y;
      } else if (p === 'top-right' || p === 'topright' || p === 'top right' || p === 'right top') {
        cx = bbox.x + bbox.width;
        cy = bbox.y;
      } else if (p === 'bottom-left' || p === 'bottomleft' || p === 'bottom left' || p === 'left bottom') {
        cx = bbox.x;
        cy = bbox.y + bbox.height;
      } else if (p === 'bottom-right' || p === 'bottomright' || p === 'bottom right' || p === 'right bottom') {
        cx = bbox.x + bbox.width;
        cy = bbox.y + bbox.height;
      } else if (p.includes(',') || p.includes(' ')) {
        const parts = p.replace(/px/g, '').split(/[, ]+/).filter(Boolean);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          cx = parseFloat(parts[0]);
          cy = parseFloat(parts[1]);
        }
      }
      return { cx, cy };
    }

    // Bind DOM elements and compute true local SVG bounding boxes
    const bindings = [];
    rigElements.forEach(elem => {
      let el = elem.id ? document.getElementById(elem.id) : null;
      if (!el && elem.id) {
        el = document.querySelector('[data-name*="' + elem.id + '"]');
      }
      if (!el) return;

      // Temporarily unhide element and any hidden SVG ancestors so getBBox() measures true geometry
      const hiddenNodes = [];
      let curr = el;
      while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
        if (curr.style && (curr.style.display === 'none' || getComputedStyle(curr).display === 'none')) {
          hiddenNodes.push({ node: curr, prev: curr.style.display });
          curr.style.display = 'inline';
        }
        curr = curr.parentElement;
      }

      let cx = 400, cy = 400;
      let bbox = { x: 0, y: 0, width: 0, height: 0 };
      try {
        if (typeof el.getBBox === 'function') {
          const b = el.getBBox();
          bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
          let explicitPivot = '';
          for (const d of (elem.directives || [])) {
            if (d.params && d.params.pivot) {
              explicitPivot = d.params.pivot;
              break;
            }
          }
          const piv = resolvePivot(explicitPivot, bbox);
          cx = piv.cx;
          cy = piv.cy;
        }
      } catch (e) {}

      for (const h of hiddenNodes) {
        h.node.style.display = h.prev;
      }

      bindings.push({
        el,
        id: elem.id,
        bbox,
        cx,
        cy,
        baseTransform: el.getAttribute('transform') || '',
        directives: (elem.directives || []).map(d => ({
          type: (d.type || '').toLowerCase().trim(),
          params: d.params || {},
          _angle: 0,
          _velocity: 0,
        })),
      });
    });

    // Zero-eval, CSP-safe boolean condition evaluator
    function resolveTokenValue(token, ctx) {
      const t = token.trim();
      if (t === 'true') return true;
      if (t === 'false') return false;
      const num = Number(t);
      if (t !== '' && !isNaN(num)) return num;
      if (t in ctx) return ctx[t];
      const lower = t.toLowerCase();
      for (const k of Object.keys(ctx)) {
        if (k.toLowerCase() === lower) return ctx[k];
      }
      return false;
    }

    function evalAtomicCondition(atomStr, ctx) {
      let s = atomStr.trim();
      while (s.startsWith('(') && s.endsWith(')')) {
        s = s.slice(1, -1).trim();
      }
      let negated = false;
      while (s.startsWith('!')) {
        negated = !negated;
        s = s.slice(1).trim();
      }
      const ops = ['>=', '<=', '===', '!==', '==', '!=', '>', '<'];
      for (const op of ops) {
        const idx = s.indexOf(op);
        if (idx !== -1) {
          const left = resolveTokenValue(s.slice(0, idx), ctx);
          const right = resolveTokenValue(s.slice(idx + op.length), ctx);
          let res = false;
          if (op === '>=') res = Number(left) >= Number(right);
          else if (op === '<=') res = Number(left) <= Number(right);
          else if (op === '>') res = Number(left) > Number(right);
          else if (op === '<') res = Number(left) < Number(right);
          else if (op === '==' || op === '===') res = left == right;
          else if (op === '!=' || op === '!==') res = left != right;
          return negated ? !res : res;
        }
      }
      const val = Boolean(resolveTokenValue(s, ctx));
      return negated ? !val : val;
    }

    function evalCondition(whenStr, ctx) {
      if (!whenStr || !whenStr.trim()) return true;
      const clean = whenStr
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      const orParts = clean.split('||');
      for (const orPart of orParts) {
        const andParts = orPart.split('&&');
        let allTrue = true;
        for (const andPart of andParts) {
          if (!evalAtomicCondition(andPart, ctx)) {
            allTrue = false;
            break;
          }
        }
        if (allTrue) return true;
      }
      return false;
    }

    function getParamValue(name, ctx) {
      if (!name) return 0;
      const val = resolveTokenValue(name, ctx);
      return typeof val === 'number' ? val : (val ? 1 : 0);
    }

    // Sliders
    const sYaw = document.getElementById('slider-yaw');
    const sPitch = document.getElementById('slider-pitch');
    const sRoll = document.getElementById('slider-roll');
    const sMouth = document.getElementById('slider-mouth');
    const sBlinkL = document.getElementById('slider-blink-l');
    const sBlinkR = document.getElementById('slider-blink-r');
    const sBrowL = document.getElementById('slider-brow-l');
    const sBrowR = document.getElementById('slider-brow-r');
    const sSmile = document.getElementById('slider-smile');

    let prevYaw = 0, prevPitch = 0, prevRoll = 0;
    let lastTime = performance.now();

    function animateLoop(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Smooth interpolation when hovering over the stage
      if (state.hoveringStage) {
        const lerpRate = Math.min(1, dt * 12);
        state.yaw += (state.targetYaw - state.yaw) * lerpRate;
        state.pitch += (state.targetPitch - state.pitch) * lerpRate;
        state.roll += (state.targetRoll - state.roll) * lerpRate;
        sYaw.value = state.yaw.toFixed(1);
        sPitch.value = state.pitch.toFixed(1);
        sRoll.value = state.roll.toFixed(1);
        document.getElementById('val-yaw').innerText = Math.round(state.yaw) + '\u00B0';
        document.getElementById('val-pitch').innerText = Math.round(state.pitch) + '\u00B0';
        document.getElementById('val-roll').innerText = Math.round(state.roll) + '\u00B0';
      }

      // Voice simulation envelope (smooth multi-harmonic syllable cadence)
      if (state.isTalking) {
        const w1 = Math.sin(now * 0.011);
        const w2 = Math.sin(now * 0.023 + 1.2);
        const w3 = Math.cos(now * 0.0045);
        const syllable = Math.max(0, (w1 * 0.5 + w2 * 0.5) * (w3 > -0.35 ? 1 : 0));
        state.mouthOpen = Math.min(1, Math.max(0, 0.12 + syllable * 0.85));
        state.audioVolume = state.mouthOpen;
        sMouth.value = state.mouthOpen.toFixed(2);
        document.getElementById('val-mouth').innerText = Math.round(state.mouthOpen * 100) + '%%';
      } else {
        state.audioVolume = state.mouthOpen * 0.5;
      }

      const deltaYaw = state.yaw - prevYaw;
      const deltaRoll = state.roll - prevRoll;
      prevYaw = state.yaw;
      prevPitch = state.pitch;
      prevRoll = state.roll;

      const isMouthOpen = state.mouthOpen > 0.08;
      const isSmiling = state.smile > 0.45;
      const isBlinkL = state.blinkL > 0.4;
      const isBlinkR = state.blinkR > 0.4;

      const evalCtx = {
        ...activeExpressions,
        blinkL: state.blinkL,
        blinkR: state.blinkR,
        mouthOpen: state.mouthOpen,
        smile: state.smile,
        headYaw: state.yaw,
        headPitch: state.pitch,
        headRoll: state.roll,
        eyeX: state.yaw / 25,
        eyeY: state.pitch / 20,
        eyeLookX: state.yaw / 25,
        eyeLookY: state.pitch / 20,
        browL: state.browL,
        browR: state.browR,
        browOuterUpLeft: state.browL,
        browOuterUpRight: state.browR,
        browUp: (state.browL + state.browR) / 2,
        browInnerUp: (state.browL + state.browR) / 2,
        isMouthOpen,
        isSmiling,
        isBlinking: isBlinkL,
        isBlinkL,
        isBlinkR,
        speaking: state.mouthOpen > 0.12,
        isSpeaking: state.mouthOpen > 0.12,
      };

      const stepRatio = dt * 60;

      for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        const el = b.el;
        let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1;
        let cx = b.cx, cy = b.cy;
        let isVisible = true;

        for (let j = 0; j < b.directives.length; j++) {
          const d = b.directives[j];
          const type = d.type;
          const p = d.params;

          if (p.pivot) {
            const piv = resolvePivot(p.pivot, b.bbox);
            cx = piv.cx;
            cy = piv.cy;
          }

          if (type === 'show') {
            if (!evalCondition(p.when || 'true', evalCtx)) {
              isVisible = false;
            }
          } else if (type === 'hide') {
            if (evalCondition(p.when || 'false', evalCtx)) {
              isVisible = false;
            }
          } else if (type === 'follow') {
            const yawF = parseFloat(p.yaw || '0');
            const pitchF = parseFloat(p.pitch || '0');
            const rollF = parseFloat(p.roll || '0');
            tx += state.yaw * (yawF / 15);
            ty += state.pitch * (pitchF / 15);
            rot += state.roll * (rollF / 10);
          } else if (type === 'dist' || type === 'distance' || type === 'parallax') {
            const factor = parseFloat(p.factor || '0');
            tx += state.yaw * factor * 2.2;
            ty += state.pitch * factor * 1.6;
          } else if (type === 'move') {
            const hasExplicitAxis = Boolean(p.x || p.y);
            const px = p.x ? getParamValue(p.x, evalCtx) : (hasExplicitAxis ? 0 : (state.yaw / 25));
            const py = p.y ? getParamValue(p.y, evalCtx) : (hasExplicitAxis ? 0 : (state.pitch / 20));
            const rangeX = parseFloat(p.rangex || p.range || '6');
            const rangeY = parseFloat(p.rangey || p.range || '6');
            tx += px * rangeX;
            ty += py * rangeY;
          } else if (type === 'rotate') {
            const pVal = getParamValue(p.param || p.target || p.source, evalCtx);
            if (p.from !== undefined && p.to !== undefined) {
              const fromA = parseFloat(p.from || '0');
              const toA = parseFloat(p.to || '0');
              rot += fromA + (toA - fromA) * pVal;
            } else {
              const range = parseFloat(p.range || p.deg || p.angle || '12');
              rot += pVal * range;
            }
          } else if (type === 'scale') {
            if (p.param) {
              const val = getParamValue(p.param, evalCtx);
              if (p.from !== undefined && p.to !== undefined) {
                const fromV = parseFloat(p.from);
                const toV = parseFloat(p.to);
                const cur = fromV + (toV - fromV) * val;
                sy *= cur;
                sx *= 1 + (cur - 1) * 0.35;
              } else {
                sx *= 1 + val * parseFloat(p.x || '0.2');
                sy *= 1 + val * parseFloat(p.y || '0.8');
              }
            } else {
              const px = p.x ? getParamValue(p.x, evalCtx) : null;
              const py = p.y ? getParamValue(p.y, evalCtx) : null;
              const fromX = parseFloat(p.fromx || p.from || '1.0');
              const toX = parseFloat(p.tox || p.to || '1.0');
              const fromY = parseFloat(p.fromy || p.from || '1.0');
              const toY = parseFloat(p.toy || p.to || '1.0');
              if (px !== null && !isNaN(px)) sx *= fromX + (toX - fromX) * px;
              if (py !== null && !isNaN(py)) sy *= fromY + (toY - fromY) * py;
            }
          } else if (type === 'idle' || type === 'breathe') {
            const breathe = parseFloat(p.breathe || '0.02');
            const periodMs = (parseFloat(p.period || '3.8') || 3.8) * 1000;
            const phase = ((now %% periodMs) / periodMs) * 2 * Math.PI;
            sy *= 1.0 + Math.sin(phase) * breathe;
          } else if (type === 'bounce') {
            const height = parseFloat(p.height || p.y || '6');
            const squash = parseFloat(p.squash || '0.03');
            const vol = state.audioVolume;
            if (vol > 0.08) {
              const speed = parseFloat(p.speed || '15');
              const hop = Math.abs(Math.sin(now * speed * 0.001));
              ty += -hop * height * vol;
              if (squash > 0) {
                sy *= 1.0 + hop * squash * vol;
                sx *= 1.0 - hop * squash * 0.5 * vol;
              }
            }
          } else if (type === 'sway') {
            const range = parseFloat(p.range || '10');
            const stiffness = parseFloat(p.stiffness || '0.18');
            const damping = parseFloat(p.damping || '0.82');
            const wind = parseFloat(p.wind || '0.04');

            let targetAngle = -(state.roll / 15.0) * range * 0.6 + (state.yaw / 25.0) * (range * 0.35);
            const phase = cx * 0.05 + cy * 0.02;
            targetAngle += Math.sin(now * 0.0025 + phase) * wind * range;

            const impulse = (-deltaYaw * 1.1 - deltaRoll * 0.9) * 0.45 * (range / 15.0);
            d._velocity += impulse * stepRatio;
            const force = -stiffness * (d._angle - targetAngle);
            d._velocity = (d._velocity + force * stepRatio) * Math.pow(damping, stepRatio);
            d._angle += d._velocity * stepRatio;
            rot += d._angle;
          }
        }

        el.style.display = isVisible ? 'inline' : 'none';
        if (el.style.transform) el.style.transform = '';
        if (el.style.transformOrigin) el.style.transformOrigin = '';

        const animParts = [];
        if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) {
          animParts.push('translate(' + tx.toFixed(2) + ', ' + ty.toFixed(2) + ')');
        }
        if (Math.abs(rot) > 0.01) {
          animParts.push('rotate(' + rot.toFixed(2) + ', ' + cx.toFixed(2) + ', ' + cy.toFixed(2) + ')');
        }
        if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
          animParts.push(
            'translate(' + cx.toFixed(2) + ', ' + cy.toFixed(2) + ') ' +
            'scale(' + sx.toFixed(4) + ', ' + sy.toFixed(4) + ') ' +
            'translate(' + (-cx).toFixed(2) + ', ' + (-cy).toFixed(2) + ')'
          );
        }

        if (animParts.length > 0) {
          const animStr = animParts.join(' ');
          el.setAttribute('transform', b.baseTransform ? (b.baseTransform + ' ' + animStr) : animStr);
        } else if (b.baseTransform) {
          el.setAttribute('transform', b.baseTransform);
        } else {
          el.removeAttribute('transform');
        }
      }

      requestAnimationFrame(animateLoop);
    }

    // Slider Listeners
    sYaw.addEventListener('input', e => {
      state.hoveringStage = false;
      state.yaw = state.targetYaw = parseFloat(e.target.value);
      document.getElementById('val-yaw').innerText = Math.round(state.yaw) + '\u00B0';
    });
    sPitch.addEventListener('input', e => {
      state.hoveringStage = false;
      state.pitch = state.targetPitch = parseFloat(e.target.value);
      document.getElementById('val-pitch').innerText = Math.round(state.pitch) + '\u00B0';
    });
    sRoll.addEventListener('input', e => {
      state.hoveringStage = false;
      state.roll = state.targetRoll = parseFloat(e.target.value);
      document.getElementById('val-roll').innerText = Math.round(state.roll) + '\u00B0';
    });
    sMouth.addEventListener('input', e => {
      if (state.isTalking) {
        state.isTalking = false;
        const btn = document.getElementById('btn-talk');
        btn.classList.remove('bg-rose-600');
        btn.classList.add('bg-sky-600');
        document.getElementById('lbl-talk').innerText = 'Voice Sim';
      }
      state.mouthOpen = parseFloat(e.target.value);
      document.getElementById('val-mouth').innerText = Math.round(state.mouthOpen * 100) + '%%';
    });
    sBlinkL.addEventListener('input', e => {
      state.blinkL = parseFloat(e.target.value);
      document.getElementById('val-blink-l').innerText = Math.round(state.blinkL * 100) + '%%';
    });
    sBlinkR.addEventListener('input', e => {
      state.blinkR = parseFloat(e.target.value);
      document.getElementById('val-blink-r').innerText = Math.round(state.blinkR * 100) + '%%';
    });
    sBrowL.addEventListener('input', e => {
      state.browL = parseFloat(e.target.value);
      document.getElementById('val-brow-l').innerText = Math.round(state.browL * 100) + '%%';
    });
    sBrowR.addEventListener('input', e => {
      state.browR = parseFloat(e.target.value);
      document.getElementById('val-brow-r').innerText = Math.round(state.browR * 100) + '%%';
    });
    sSmile.addEventListener('input', e => {
      state.smile = parseFloat(e.target.value);
      document.getElementById('val-smile').innerText = Math.round(state.smile * 100) + '%%';
    });

    // Hotkey Expression Buttons
    document.querySelectorAll('.expr-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const expr = btn.dataset.expr;
        activeExpressions[expr] = !activeExpressions[expr];
        btn.classList.toggle('active', activeExpressions[expr]);
      });
    });

    // Reset Button
    document.getElementById('btn-reset').addEventListener('click', () => {
      state.isTalking = false;
      state.hoveringStage = false;
      const btn = document.getElementById('btn-talk');
      btn.classList.remove('bg-rose-600');
      btn.classList.add('bg-sky-600');
      document.getElementById('lbl-talk').innerText = 'Voice Sim';

      state.yaw = state.pitch = state.roll = 0;
      state.targetYaw = state.targetPitch = state.targetRoll = 0;
      state.mouthOpen = state.blinkL = state.blinkR = state.browL = state.browR = state.smile = state.audioVolume = 0;
      sYaw.value = sPitch.value = sRoll.value = sMouth.value = sBlinkL.value = sBlinkR.value = sBrowL.value = sBrowR.value = sSmile.value = 0;
      document.getElementById('val-yaw').innerText = '0\u00B0';
      document.getElementById('val-pitch').innerText = '0\u00B0';
      document.getElementById('val-roll').innerText = '0\u00B0';
      document.getElementById('val-mouth').innerText = '0%%';
      document.getElementById('val-blink-l').innerText = '0%%';
      document.getElementById('val-blink-r').innerText = '0%%';
      document.getElementById('val-brow-l').innerText = '0%%';
      document.getElementById('val-brow-r').innerText = '0%%';
      document.getElementById('val-smile').innerText = '0%%';
      Object.keys(activeExpressions).forEach(k => activeExpressions[k] = false);
      document.querySelectorAll('.expr-btn').forEach(b => b.classList.remove('active'));
    });

    // Blink Button
    document.getElementById('btn-blink').addEventListener('click', () => {
      state.blinkL = state.blinkR = 1;
      sBlinkL.value = sBlinkR.value = 1;
      document.getElementById('val-blink-l').innerText = '100%%';
      document.getElementById('val-blink-r').innerText = '100%%';
      setTimeout(() => {
        state.blinkL = state.blinkR = 0;
        sBlinkL.value = sBlinkR.value = 0;
        document.getElementById('val-blink-l').innerText = '0%%';
        document.getElementById('val-blink-r').innerText = '0%%';
      }, 180);
    });

    // Voice / Talk Sim Toggle
    document.getElementById('btn-talk').addEventListener('click', () => {
      state.isTalking = !state.isTalking;
      const btn = document.getElementById('btn-talk');
      const lbl = document.getElementById('lbl-talk');
      if (state.isTalking) {
        btn.classList.add('bg-rose-600');
        btn.classList.remove('bg-sky-600');
        lbl.innerText = 'Stop Talk';
      } else {
        btn.classList.remove('bg-rose-600');
        btn.classList.add('bg-sky-600');
        lbl.innerText = 'Voice Sim';
        state.mouthOpen = 0;
        state.audioVolume = 0;
        sMouth.value = 0;
        document.getElementById('val-mouth').innerText = '0%%';
      }
    });

    // Stage Hover Tracking (No click-drag required)
    const stage = document.getElementById('stage-container');
    stage.addEventListener('mousemove', e => {
      state.hoveringStage = true;
      const rect = stage.getBoundingClientRect();
      const nx = Math.max(-0.5, Math.min(0.5, (e.clientX - rect.left) / rect.width - 0.5));
      const ny = Math.max(-0.5, Math.min(0.5, (e.clientY - rect.top) / rect.height - 0.5));
      state.targetYaw = nx * 60;
      state.targetPitch = ny * 40;
      state.targetRoll = nx * 16;
    });

    stage.addEventListener('mouseleave', () => {
      state.hoveringStage = true;
      state.targetYaw = 0;
      state.targetPitch = 0;
      state.targetRoll = 0;
    });

    requestAnimationFrame(animateLoop);
  </script>
</body>
</html>`, title, title, len(rigDef.Elements), inlineSVG, exprButtonsHTML, string(rigJSON))

	if outputPath == "" {
		ext := filepath.Ext(svgPath)
		outputPath = strings.TrimSuffix(svgPath, ext) + "_studio_widget.html"
	}

	if err := os.WriteFile(outputPath, []byte(htmlContent), 0644); err != nil {
		return "", fmt.Errorf("failed to write widget html: %w", err)
	}

	return outputPath, nil
}
