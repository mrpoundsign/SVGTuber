(() => {
  const container = document.getElementById('avatar-container');
  const statusIndicator = document.getElementById('status-indicator');
  let socket = null;
  let reconnectTimer = null;

  let activeRigBindings = [];
  let boundMouthNeutral = null;
  let boundMouthSmile = null;
  let boundMouthOpen = null;
  let boundEyesOpen = null;
  let boundEyesClosed = null;
  let boundEyeOpenL = null;
  let boundEyeClosedL = null;
  let boundEyeOpenR = null;
  let boundEyeClosedR = null;
  let activeExpressions = {};
  // Initialize with neutral defaults so Idle breathing and initial positioning work immediately
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
    mouthThreshold: 0.08,
    blinkThreshold: 0.45,
    blinkThresholdL: 0.45,
    blinkThresholdR: 0.45,
    blinkSyncDelayMs: 50
  };
  let animLoopStarted = false;

  function setStatus(text, visible = false) {
    if (statusIndicator) {
      statusIndicator.textContent = text;
      if (visible) {
        document.body.classList.add('show-status');
      } else {
        document.body.classList.remove('show-status');
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
      console.warn('[SVGTuber] Could not load rig.json:', err);
    }
  }

  function bindRig(rigDef) {
    activeRigBindings = [];
    boundMouthNeutral = null;
    boundMouthSmile = null;
    boundMouthOpen = null;
    boundEyesOpen = null;
    boundEyesClosed = null;
    boundEyeOpenL = null;
    boundEyeClosedL = null;
    boundEyeOpenR = null;
    boundEyeClosedR = null;
    if (!rigDef || !rigDef.elements || rigDef.elements.length === 0) {
      return;
    }

    const svg = container.querySelector('svg');
    if (!svg) {
      return;
    }

    rigDef.elements.forEach((elem) => {
      let el = elem.id ? svg.querySelector(`#${CSS.escape(elem.id)}`) : null;
      if (!el && elem.label) {
        // Fallback search by data-name (Vectorcraft, Illustrator)
        el = svg.querySelector(`[data-name="${CSS.escape(elem.label)}"]`);
      }
      if (!el && elem.label) {
        // Fallback search by inkscape:label
        el = svg.querySelector(`[inkscape\\:label="${CSS.escape(elem.label)}"]`);
      }
      if (!el && elem.label) {
        // Fallback search by aria-label
        el = svg.querySelector(`[aria-label="${CSS.escape(elem.label)}"]`);
      }
      if (!el) {
        return;
      }
      if (!el.id && elem.id) {
        el.id = elem.id;
      }

      const lowerId = (elem.id || '').toLowerCase();
      const lowerLabel = (elem.label || '').toLowerCase();

      if (lowerId === 'mouth_neutral' || lowerLabel.includes('mouth neutral')) boundMouthNeutral = el;
      if (lowerId === 'mouth_smile' || lowerLabel.includes('mouth smile')) boundMouthSmile = el;
      if (lowerId === 'mouth_open' || lowerLabel.includes('mouth open')) boundMouthOpen = el;
      if (lowerId === 'eyes_open' || lowerLabel.includes('eyes open')) boundEyesOpen = el;
      if (lowerId === 'eyes_closed' || lowerLabel.includes('eyes closed')) boundEyesClosed = el;
      if (lowerId === 'eye_open_left' || lowerLabel.includes('left eye open')) boundEyeOpenL = el;
      if (lowerId === 'eye_closed_left' || lowerLabel.includes('left eye closed')) boundEyeClosedL = el;
      if (lowerId === 'eye_open_right' || lowerLabel.includes('right eye open')) boundEyeOpenR = el;
      if (lowerId === 'eye_closed_right' || lowerLabel.includes('right eye closed')) boundEyeClosedR = el;

      // Calculate pivot coordinate using element bounding box
      let cx = 0, cy = 0;
      const prevDisplay = el.style.display;
      // If element is hidden (e.g. style="display: none;"), getBBox() throws or returns zeros
      const isHidden = (getComputedStyle(el).display === 'none') || (prevDisplay === 'none');
      if (isHidden) {
        el.style.display = 'inline';
      }

      try {
        const bbox = el.getBBox();
        cx = bbox.x + bbox.width / 2;
        cy = bbox.y + bbox.height / 2;

        // Check if any directive specifies an explicit pivot
        const directives = elem.directives || [];
        directives.forEach((d) => {
          const params = d.params || d.Params || {};
          const pivot = (params.pivot || '').toLowerCase().trim();
          if (pivot === 'top') {
            cy = bbox.y;
          } else if (pivot === 'bottom') {
            cy = bbox.y + bbox.height;
          } else if (pivot === 'left') {
            cx = bbox.x;
          } else if (pivot === 'right') {
            cx = bbox.x + bbox.width;
          } else if (pivot.startsWith('#')) {
            const targetEl = svg.querySelector(pivot);
            if (targetEl) {
              const tb = targetEl.getBBox();
              cx = tb.x + tb.width / 2;
              cy = tb.y + tb.height / 2;
            }
          }
        });
      } catch (e) {
        console.warn(`[SVGTuber] getBBox failed for #${elem.id}:`, e);
      } finally {
        if (isHidden) {
          el.style.display = prevDisplay;
        }
      }

      const baseTransform = elem.transform || el.getAttribute('transform') || '';

      activeRigBindings.push({
        el,
        cx,
        cy,
        baseTransform,
        directives: elem.directives || []
      });
    });

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
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgElement = doc.documentElement;

      if (svgElement.nodeName.toLowerCase() !== 'svg') {
        throw new Error('Parsed document is not an SVG element');
      }

      // Ensure SVG scales properly in container
      if (!svgElement.hasAttribute('viewBox') && svgElement.hasAttribute('width') && svgElement.hasAttribute('height')) {
        const w = parseFloat(svgElement.getAttribute('width'));
        const h = parseFloat(svgElement.getAttribute('height'));
        if (!isNaN(w) && !isNaN(h)) {
          svgElement.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
      }

      container.innerHTML = '';
      container.appendChild(svgElement);
      console.log('[SVGTuber] Avatar SVG loaded successfully.');

      // Load and bind rig definition
      await loadRig();
    } catch (err) {
      console.error('[SVGTuber] Failed to load avatar:', err);
      setStatus(`Avatar load error: ${err.message}`, true);
    }
  }

  const DEFAULT_PARAM_FALLBACKS = {
    mouththreshold: 0.08,
    blinkthreshold: 0.45,
    smilethreshold: 0.35,
  };

  function getParam(name, fallback = 0) {
    if (!name) return fallback;
    const clean = name.trim();
    const lower = clean.toLowerCase();
    const def = DEFAULT_PARAM_FALLBACKS.hasOwnProperty(lower) ? DEFAULT_PARAM_FALLBACKS[lower] : fallback;

    if (!latestParams) return def;
    if (latestParams.hasOwnProperty(clean)) {
      if (typeof latestParams[clean] === 'number' || typeof latestParams[clean] === 'boolean') {
        return latestParams[clean];
      }
    }
    for (const key of Object.keys(latestParams)) {
      if (key.toLowerCase() === lower) {
        if (typeof latestParams[key] === 'number' || typeof latestParams[key] === 'boolean') {
          return latestParams[key];
        }
      }
    }
    if (latestParams.raw) {
      if (latestParams.raw.hasOwnProperty(clean) && typeof latestParams.raw[clean] === 'number') {
        return latestParams.raw[clean];
      }
      for (const key of Object.keys(latestParams.raw)) {
        if (key.toLowerCase() === lower && typeof latestParams.raw[key] === 'number') {
          return latestParams.raw[key];
        }
      }
    }
    return def;
  }

  // Safe evaluation of boolean condition expressions (e.g. "isBlinkL", "isMouthOpen || isSmiling", "blinkL >= 0.45")
  function evaluateCondition(expr, params) {
    if (!expr) return true;
    try {
      const decoded = expr.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const hasComparison = /[><=!]=?/.test(decoded);

      // Replace known parameter variables with actual numeric or boolean values
      const sanitized = decoded.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
        if (match === 'true' || match === 'false') return match;

        const lower = match.toLowerCase();

        // Check custom toggleable expressions first (e.g. "blush", "isBlush", "tears", "isAngry")
        const exprName = lower.startsWith('is') && lower.length > 2 ? lower.substring(2) : lower;
        if (activeExpressions && (activeExpressions[exprName] !== undefined || activeExpressions[lower] !== undefined)) {
          return String(Boolean(activeExpressions[exprName] || activeExpressions[lower]));
        }

        // If expression has no comparison operator (pure boolean shorthand, e.g. "isSmiling", "blinkL")
        if (!hasComparison) {
          if (lower === 'blinkl' || lower === 'isblinkl') {
            const b = getParam('isBlinkL', null);
            return String(b !== null ? Boolean(b) : getParam('blinkL', 0) >= getParam('blinkThresholdL', getParam('blinkThreshold', 0.45)));
          }
          if (lower === 'blinkr' || lower === 'isblinkr') {
            const b = getParam('isBlinkR', null);
            return String(b !== null ? Boolean(b) : getParam('blinkR', 0) >= getParam('blinkThresholdR', getParam('blinkThreshold', 0.45)));
          }
          if (lower === 'mouthopen' || lower === 'ismouthopen') {
            const b = getParam('isMouthOpen', null);
            return String(b !== null ? Boolean(b) : getParam('mouthOpen', 0) >= getParam('mouthThreshold', 0.08));
          }
          if (lower === 'smile' || lower === 'issmiling') {
            const b = getParam('isSmiling', null);
            return String(b !== null ? Boolean(b) : getParam('smile', 0) >= getParam('smileThreshold', 0.50));
          }
          if (lower === 'speaking' || lower === 'isspeaking') {
            return String(Boolean(getParam('isSpeaking', false)));
          }
        }

        const val = getParam(match, null);
        if (typeof val === 'boolean' || typeof val === 'number') {
          return String(val);
        }
        return '0';
      });

      // Simple safe evaluation limited to numbers, booleans, and logical comparison operators
      if (/^[0-9\.\s><=!&|()+\-*\/a-zA-Z]+$/.test(sanitized)) {
        return Boolean(Function(`"use strict"; return (${sanitized});`)());
      }
    } catch (e) {
      console.warn('[SVGTuber] evaluateCondition error:', e, expr);
    }
    return false;
  }

  function parseDuration(val, defaultMs = 3500) {
    if (!val) return defaultMs;
    const str = String(val).trim().toLowerCase();
    if (str.endsWith('ms')) {
      return parseFloat(str) || defaultMs;
    }
    if (str.endsWith('s')) {
      return (parseFloat(str) || 1) * 1000;
    }
    return parseFloat(str) || defaultMs;
  }

  // Main Animation Transform Calculation
  function applyRigTransforms(now) {
    if (!latestParams || activeRigBindings.length === 0) return;

    const p = latestParams;
    const headYaw = p.headYaw || 0;
    const headPitch = p.headPitch || 0;
    const headRoll = p.headRoll || 0;

    for (let i = 0; i < activeRigBindings.length; i++) {
      const b = activeRigBindings[i];
      const el = b.el;
      let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1;

      for (let j = 0; j < b.directives.length; j++) {
        const d = b.directives[j];
        const type = (d.type || d.Type || '').toLowerCase().trim();
        const params = d.params || d.Params || {};

        switch (type) {
          case 'show': {
            const cond = evaluateCondition(params.when, p);
            el.style.display = cond ? 'inline' : 'none';
            break;
          }
          case 'hide': {
            const cond = evaluateCondition(params.when, p);
            el.style.display = cond ? 'none' : 'inline';
            break;
          }
          case 'follow': {
            const yawF = parseFloat(params.yaw || 0);
            const pitchF = parseFloat(params.pitch || 0);
            const rollF = parseFloat(params.roll || 0);

            // Angular rotation (roll in degrees)
            rot += headRoll * (rollF / 10);

            // Translation follow (yaw and pitch)
            tx += headYaw * (yawF / 15);
            ty += headPitch * (pitchF / 15);
            break;
          }
          case 'dist':
          case 'distance':
          case 'parallax': {
            const factor = parseFloat(params.factor || 0);
            tx += headYaw * factor * 2.2;
            ty += headPitch * factor * 1.6;
            break;
          }
          case 'move': {
            const px = params.x ? getParam(params.x, 0) : 0;
            const py = params.y ? getParam(params.y, 0) : 0;
            const rangeX = parseFloat(params.rangex || params.range || 8);
            const rangeY = parseFloat(params.rangey || params.range || 8);
            tx += px * rangeX;
            ty += py * rangeY;
            break;
          }
          case 'scale': {
            const px = params.x ? getParam(params.x, null) : null;
            const py = params.y ? getParam(params.y, null) : null;
            const fromX = parseFloat(params.fromx || params.from || 1.0);
            const toX = parseFloat(params.tox || params.to || 1.0);
            const fromY = parseFloat(params.fromy || params.from || 1.0);
            const toY = parseFloat(params.toy || params.to || 1.0);

            if (px !== null && !isNaN(px)) {
              sx *= (fromX + (toX - fromX) * px);
            }
            if (py !== null && !isNaN(py)) {
              sy *= (fromY + (toY - fromY) * py);
            }
            break;
          }
          case 'idle':
          case 'breathe': {
            const breathe = parseFloat(params.breathe || 0.02);
            const period = parseDuration(params.period, 3500);
            const phase = ((now % period) / period) * 2 * Math.PI;
            const idleFactor = 1.0 + Math.sin(phase) * breathe;
            sy *= idleFactor;
            break;
          }
        }
      }

      // Apply transforms using SVG transform attribute so existing element transforms (Inkscape/Illustrator)
      // are preserved and never overridden by CSS cascade rules.
      let animParts = [];
      if (tx !== 0 || ty !== 0) {
        animParts.push(`translate(${tx.toFixed(2)}, ${ty.toFixed(2)})`);
      }
      if (rot !== 0) {
        animParts.push(`rotate(${rot.toFixed(2)}, ${b.cx.toFixed(2)}, ${b.cy.toFixed(2)})`);
      }
      if (sx !== 1 || sy !== 1) {
        animParts.push(`translate(${b.cx.toFixed(2)}, ${b.cy.toFixed(2)}) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) translate(${(-b.cx).toFixed(2)}, ${(-b.cy).toFixed(2)})`);
      }

      // Ensure no residual style.transform overrides the SVG transform attribute
      if (el.style.transform) {
        el.style.transform = '';
      }
      if (el.style.transformBox) {
        el.style.transformBox = '';
      }
      if (el.style.transformOrigin) {
        el.style.transformOrigin = '';
      }

      if (animParts.length > 0) {
        const animStr = animParts.join(' ');
        el.setAttribute('transform', b.baseTransform ? `${b.baseTransform.trim()} ${animStr}` : animStr);
      } else {
        if (b.baseTransform) {
          el.setAttribute('transform', b.baseTransform.trim());
        } else {
          el.removeAttribute('transform');
        }
      }
    }

    // Mutual exclusivity for mouth layers to guarantee zero overlap and no disappearing mouth
    if (boundMouthNeutral || boundMouthSmile || boundMouthOpen) {
      const isSmile = boundMouthSmile && boundMouthSmile.style.display !== 'none';
      const isOpen = boundMouthOpen && boundMouthOpen.style.display !== 'none';

      if (isOpen) {
        // When mouth is open (speaking / wide expression), show open mouth and hide closed lines
        if (boundMouthNeutral) boundMouthNeutral.style.display = 'none';
        if (boundMouthSmile) boundMouthSmile.style.display = 'none';
      } else if (isSmile) {
        // Closed smiling mouth
        if (boundMouthNeutral) boundMouthNeutral.style.display = 'none';
        if (boundMouthOpen) boundMouthOpen.style.display = 'none';
      } else if (boundMouthNeutral) {
        // Resting neutral mouth
        boundMouthNeutral.style.display = 'inline';
        if (boundMouthSmile) boundMouthSmile.style.display = 'none';
        if (boundMouthOpen) boundMouthOpen.style.display = 'none';
      }
    }

    // Mutual exclusivity for independent eye blink layers
    if (boundEyeClosedL && boundEyeClosedL.style.display !== 'none') {
      if (boundEyeOpenL) boundEyeOpenL.style.display = 'none';
    }
    if (boundEyeClosedR && boundEyeClosedR.style.display !== 'none') {
      if (boundEyeOpenR) boundEyeOpenR.style.display = 'none';
    }

    // Mutual exclusivity for combined eye blink group (if legacy avatar uses whole-eye group)
    if (boundEyesClosed && boundEyesClosed.style.display !== 'none' && !boundEyeClosedL && !boundEyeClosedR) {
      if (boundEyesOpen) boundEyesOpen.style.display = 'none';
    }
  }

  // 60 FPS animation loop
  function animateLoop(now) {
    applyRigTransforms(now);
    requestAnimationFrame(animateLoop);
  }

  function connectWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/overlay`;
    console.log(`[SVGTuber] Connecting WebSocket: ${wsUrl}`);
    setStatus('Connecting WebSocket...', true);

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('[SVGTuber] WebSocket connected.');
      setStatus('Connected', false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'reload') {
          console.log('[SVGTuber] Received reload signal, reloading avatar...');
          loadAvatar();
        } else if (msg.type === 'rig_update') {
          console.log('[SVGTuber] Received rig update.');
          bindRig(msg.rig);
        } else if (msg.type === 'expression_update') {
          activeExpressions = msg.expressions || {};
          applyRigTransforms(performance.now());
        } else if (msg.type === 'param_frame') {
          latestParams = msg;
          window.latestParams = msg;
          if (msg.expressions) {
            activeExpressions = Object.assign({}, activeExpressions, msg.expressions);
          }
          // When overlay is in background tab/hidden iframe, rAF may pause; apply directly
          if (document.hidden) {
            applyRigTransforms(performance.now());
          }
        }
      } catch (err) {
        console.error('[SVGTuber] Failed to parse message:', err, event.data);
      }
    };

    socket.onclose = () => {
      setStatus('Disconnected. Reconnecting...', true);
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.error('[SVGTuber] WebSocket error:', err);
      socket.close();
    };
  }

  function scheduleReconnect() {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  }

  // Initial load
  loadAvatar();
  connectWebSocket();
})();
