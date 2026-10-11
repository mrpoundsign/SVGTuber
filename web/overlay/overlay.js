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
  let activeAccessories = [];
  const accessorySVGCache = new Map();
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
    const accessoryBindings = activeRigBindings.filter(b => b.isAccessoryBinding);
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
      activeRigBindings = accessoryBindings;
      return;
    }

    const svg = container.querySelector('svg');
    if (!svg) {
      activeRigBindings = accessoryBindings;
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
          if (!pivot) return;

          if (pivot === 'top' || pivot === 'top-center' || pivot === 'topcenter') {
            cy = bbox.y;
            cx = bbox.x + bbox.width / 2;
          } else if (pivot === 'bottom' || pivot === 'bottom-center' || pivot === 'bottomcenter') {
            cy = bbox.y + bbox.height;
            cx = bbox.x + bbox.width / 2;
          } else if (pivot === 'left' || pivot === 'center-left' || pivot === 'leftcenter') {
            cx = bbox.x;
            cy = bbox.y + bbox.height / 2;
          } else if (pivot === 'right' || pivot === 'center-right' || pivot === 'rightcenter') {
            cx = bbox.x + bbox.width;
            cy = bbox.y + bbox.height / 2;
          } else if (pivot === 'top-left' || pivot === 'topleft') {
            cx = bbox.x;
            cy = bbox.y;
          } else if (pivot === 'top-right' || pivot === 'topright') {
            cx = bbox.x + bbox.width;
            cy = bbox.y;
          } else if (pivot === 'bottom-left' || pivot === 'bottomleft') {
            cx = bbox.x;
            cy = bbox.y + bbox.height;
          } else if (pivot === 'bottom-right' || pivot === 'bottomright') {
            cx = bbox.x + bbox.width;
            cy = bbox.y + bbox.height;
          } else if (pivot === 'center' || pivot === 'middle') {
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
          } else if (pivot.startsWith('#')) {
            const targetEl = svg.querySelector(pivot);
            if (targetEl) {
              const tb = targetEl.getBBox();
              cx = tb.x + tb.width / 2;
              cy = tb.y + tb.height / 2;
            }
          } else if (pivot.includes(',') || pivot.includes(' ')) {
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
        id: elem.id || el.id || '',
        label: elem.label || '',
        cx,
        cy,
        baseTransform,
        directives: elem.directives || []
      });
    });

    // Restore preserved accessory bindings
    activeRigBindings.push(...accessoryBindings);

    // Re-scan any accessory DOM elements currently present in the SVG to ensure fresh pivots
    const domAccs = svg.querySelectorAll('.svgtuber-accessory');
    domAccs.forEach(accGroup => scanAndBindAccessoryDirectives(accGroup));

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
      await syncAccessories();
    } catch (err) {
      console.error('[SVGTuber] Failed to load avatar:', err);
      setStatus(`Avatar load error: ${err.message}`, true);
    }
  }


  function parseDirectiveString(str) {
    if (!str) return [];
    const regex = /([A-Za-z]+)\s*\{([^}]+)\}/g;
    const directives = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
      const name = match[1];
      const paramStr = match[2] || '';
      const params = {};
      if (paramStr.trim()) {
        paramStr.split(';').forEach((pair) => {
          const idx = pair.indexOf(':');
          if (idx !== -1) {
            const k = pair.substring(0, idx).trim().toLowerCase();
            const v = pair.substring(idx + 1).trim();
            if (k) params[k] = v;
          } else if (pair.trim()) {
            const k = pair.trim().toLowerCase();
            params[k] = 'true';
          }
        });
      }
      directives.push({
        type: name,
        Type: name,
        name: name,
        params: params
      });
    }
    return directives;
  }

  function scanAndBindAccessoryDirectives(accNode) {
    if (!accNode) return;
    const accId = accNode.dataset.accessoryId;
    if (accId) {
      activeRigBindings = activeRigBindings.filter(b => b.accId !== accId);
    }

    const allElements = [accNode, ...accNode.querySelectorAll('*')];
    allElements.forEach((el) => {
      let label = el.getAttribute('inkscape:label')
        || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label')
        || el.getAttribute('data-name')
        || el.getAttribute('aria-label')
        || el.getAttribute('label')
        || '';

      if (!label && el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.toLowerCase().endsWith('label') || attr.localName === 'label') {
            label = attr.value;
            break;
          }
        }
      }
      if (!label && el.id && el.id.includes('{')) {
        label = el.id;
      }
      if (!label) return;

      const directives = parseDirectiveString(label);
      if (directives.length === 0) return;

      // Track original pre-animation transform to prevent compounding rotations
      if (el.dataset.originalTransform === undefined) {
        el.dataset.originalTransform = el.getAttribute('transform') || '';
      }
      const baseTransform = el.dataset.originalTransform;

      let cx = 0, cy = 0;
      const prevDisplay = el.style.display;
      const isHidden = (getComputedStyle(el).display === 'none') || (prevDisplay === 'none');
      if (isHidden) el.style.display = 'inline';

      // Temporarily restore original transform for accurate BBox computation
      const curTransform = el.getAttribute('transform');
      if (curTransform !== baseTransform) {
        if (baseTransform) {
          el.setAttribute('transform', baseTransform);
        } else {
          el.removeAttribute('transform');
        }
      }

      try {
        const bbox = el.getBBox();
        cx = bbox.x + bbox.width / 2;
        cy = bbox.y + bbox.height / 2;
        directives.forEach((d) => {
          const pivot = (d.params.pivot || '').toLowerCase().trim();
          if (pivot === 'top' || pivot === 'top-center' || pivot === 'topcenter') {
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y;
          } else if (pivot === 'bottom' || pivot === 'bottom-center' || pivot === 'bottomcenter') {
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height;
          } else if (pivot === 'left' || pivot === 'center-left' || pivot === 'leftcenter') {
            cx = bbox.x;
            cy = bbox.y + bbox.height / 2;
          } else if (pivot === 'right' || pivot === 'center-right' || pivot === 'rightcenter') {
            cx = bbox.x + bbox.width;
            cy = bbox.y + bbox.height / 2;
          } else if (pivot === 'center' || pivot === 'middle') {
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
          }
        });
      } catch (e) {
        console.warn('[SVGTuber] Accessory getBBox error:', e);
      } finally {
        if (curTransform !== null && curTransform !== undefined) {
          el.setAttribute('transform', curTransform);
        }
        if (isHidden) el.style.display = prevDisplay;
      }

      activeRigBindings.push({
        el,
        id: el.id || '',
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

  const inFlightAccessoryLoads = new Set();
  let syncQueue = Promise.resolve();

  function syncAccessories(list) {
    syncQueue = syncQueue.then(() => _doSyncAccessories(list)).catch(err => {
      console.warn('[SVGTuber] syncAccessories error:', err);
    });
    return syncQueue;
  }

  function findAnchorTarget(svg, targetName) {
    if (!targetName || targetName === 'root_svg') return svg;

    // 1. Direct ID match
    let target = svg.querySelector(`#${CSS.escape(targetName)}`);
    if (target) return target;

    // 2. Direct data-name or label match
    target = svg.querySelector(`[data-name="${CSS.escape(targetName)}"]`)
      || svg.querySelector(`[inkscape\\:label="${CSS.escape(targetName)}"]`)
      || svg.querySelector(`[aria-label="${CSS.escape(targetName)}"]`);
    if (target) return target;

    // 3. Substring match on ID, data-name, or label
    target = svg.querySelector(`[id*="${CSS.escape(targetName)}"]`)
      || svg.querySelector(`[data-name*="${CSS.escape(targetName)}"]`)
      || svg.querySelector(`[inkscape\\:label*="${CSS.escape(targetName)}"]`);
    if (target) return target;

    // 4. Head fallbacks (handling Inkscape, Illustrator, Vectorcraft, standard conventions)
    const isHeadTarget = targetName.toLowerCase().includes('head');
    if (isHeadTarget) {
      for (const b of activeRigBindings) {
        if (b.isAccessoryBinding) continue;
        const lowerId = (b.id || '').toLowerCase();
        const lowerLabel = (b.label || '').toLowerCase();
        if (lowerId.includes('head') || lowerLabel.includes('head')) {
          return b.el;
        }
      }
      target = svg.querySelector('#layer_head')
        || svg.querySelector('#head')
        || svg.querySelector('[data-name*="Head" i]')
        || svg.querySelector('[inkscape\\:label*="Head" i]')
        || svg.querySelector('[id*="Head" i]')
        || svg.querySelector('[id*="head" i]');
      if (target) return target;
    }

    return svg;
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
      } catch (e) {}
    }
    const svg = container.querySelector('svg');
    if (!svg) return;

    const currentAccIds = new Set(activeAccessories.filter(a => a.enabled).map(a => a.id));

    // 1. Remove disabled, deleted, or duplicate accessory DOM nodes
    const seenAccIds = new Set();
    const existingDomAccs = svg.querySelectorAll('.svgtuber-accessory');
    existingDomAccs.forEach(node => {
      const accId = node.dataset.accessoryId;
      if (!currentAccIds.has(accId) || seenAccIds.has(accId)) {
        node.remove();
        activeRigBindings = activeRigBindings.filter(b => b.accId !== accId);
      } else {
        seenAccIds.add(accId);
      }
    });

    // 2. Render / update each enabled accessory
    for (const acc of activeAccessories) {
      if (!acc.enabled) continue;

      let accGroup = svg.querySelector(`.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`);
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

        // Re-check DOM in case another path inserted it during fetch
        const alreadyInserted = svg.querySelector(`.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`);
        if (alreadyInserted) {
          inFlightAccessoryLoads.delete(acc.id);
          accGroup = alreadyInserted;
        } else {
          const parser = new DOMParser();
          const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
          const accSvgEl = doc.documentElement;
          if (!accSvgEl || accSvgEl.nodeName.toLowerCase() !== 'svg') {
            inFlightAccessoryLoads.delete(acc.id);
            continue;
          }

          let vbX = 0, vbY = 0, vbW = 100, vbH = 100;
          if (accSvgEl.hasAttribute('viewBox')) {
            const parts = accSvgEl.getAttribute('viewBox').split(/[\s,]+/).map(Number);
            if (parts.length === 4) {
              vbX = parts[0]; vbY = parts[1]; vbW = parts[2]; vbH = parts[3];
            }
          } else {
            vbW = parseFloat(accSvgEl.getAttribute('width')) || 100;
            vbH = parseFloat(accSvgEl.getAttribute('height')) || 100;
          }
          const centerX = vbX + vbW / 2;
          const centerY = vbY + vbH / 2;

          accGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          accGroup.classList.add('svgtuber-accessory');
          accGroup.dataset.accessoryId = acc.id;
          accGroup.dataset.accessoryFile = acc.file;
          accGroup.dataset.centerX = String(centerX);
          accGroup.dataset.centerY = String(centerY);

          const innerWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          innerWrapper.setAttribute('transform', `translate(${-centerX}, ${-centerY})`);

          while (accSvgEl.firstChild) {
            innerWrapper.appendChild(accSvgEl.firstChild);
          }
          accGroup.appendChild(innerWrapper);

          let targetNode = findAnchorTarget(svg, acc.target || 'layer_head');

          // Calculate target anchor center before appending accGroup
          let anchorX = 0, anchorY = 0;
          if (targetNode !== svg) {
            try {
              const prevDisplay = targetNode.style.display;
              const isHidden = (getComputedStyle(targetNode).display === 'none') || (prevDisplay === 'none');
              if (isHidden) targetNode.style.display = 'inline';
              const tb = targetNode.getBBox();
              if (isHidden) targetNode.style.display = prevDisplay;
              if (tb && (tb.width > 0 || tb.height > 0)) {
                anchorX = tb.x + tb.width / 2;
                anchorY = tb.y + tb.height / 2;
              }
            } catch (e) {}
          }
          if (anchorX === 0 && anchorY === 0) {
            if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
              anchorX = svg.viewBox.baseVal.x + svg.viewBox.baseVal.width / 2;
              anchorY = svg.viewBox.baseVal.y + svg.viewBox.baseVal.height / 2;
            } else {
              const w = parseFloat(svg.getAttribute('width')) || 512;
              const h = parseFloat(svg.getAttribute('height')) || 512;
              anchorX = w / 2;
              anchorY = h / 2;
            }
          }

          accGroup.dataset.anchorX = String(anchorX);
          accGroup.dataset.anchorY = String(anchorY);
          accGroup.dataset.currentTarget = acc.target || 'layer_head';

          if (acc.order === 'back') {
            targetNode.insertBefore(accGroup, targetNode.firstChild);
          } else {
            targetNode.appendChild(accGroup);
          }

          scanAndBindAccessoryDirectives(accGroup);
          inFlightAccessoryLoads.delete(acc.id);
        }
      } else {
        // Verify target and order placement
        let desiredTarget = findAnchorTarget(svg, acc.target || 'layer_head');

        const targetChanged = accGroup.dataset.currentTarget !== (acc.target || 'layer_head');
        if (accGroup.parentElement !== desiredTarget || targetChanged) {
          accGroup.dataset.currentTarget = acc.target || 'layer_head';
          if (acc.order === 'back') {
            desiredTarget.insertBefore(accGroup, desiredTarget.firstChild);
          } else {
            desiredTarget.appendChild(accGroup);
          }

          // Recompute anchor center for new target
          let anchorX = 0, anchorY = 0;
          if (desiredTarget !== svg) {
            try {
              const prevDisplay = desiredTarget.style.display;
              const isHidden = (getComputedStyle(desiredTarget).display === 'none') || (prevDisplay === 'none');
              if (isHidden) desiredTarget.style.display = 'inline';
              accGroup.style.display = 'none';
              const tb = desiredTarget.getBBox();
              accGroup.style.display = '';
              if (isHidden) desiredTarget.style.display = prevDisplay;
              if (tb && (tb.width > 0 || tb.height > 0)) {
                anchorX = tb.x + tb.width / 2;
                anchorY = tb.y + tb.height / 2;
              }
            } catch (e) {}
          }
          if (anchorX === 0 && anchorY === 0) {
            if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
              anchorX = svg.viewBox.baseVal.x + svg.viewBox.baseVal.width / 2;
              anchorY = svg.viewBox.baseVal.y + svg.viewBox.baseVal.height / 2;
            } else {
              const w = parseFloat(svg.getAttribute('width')) || 512;
              const h = parseFloat(svg.getAttribute('height')) || 512;
              anchorX = w / 2;
              anchorY = h / 2;
            }
          }
          accGroup.dataset.anchorX = String(anchorX);
          accGroup.dataset.anchorY = String(anchorY);
        } else {
          if (acc.order === 'back' && accGroup !== desiredTarget.firstChild) {
            desiredTarget.insertBefore(accGroup, desiredTarget.firstChild);
          } else if (acc.order === 'front' && accGroup !== desiredTarget.lastChild) {
            desiredTarget.appendChild(accGroup);
          }
        }
      }

      // Apply transform relative to target anchor center
      const anchorX = parseFloat(accGroup.dataset.anchorX) || 0;
      const anchorY = parseFloat(accGroup.dataset.anchorY) || 0;
      const finalX = anchorX + (acc.x || 0);
      const finalY = anchorY + (acc.y || 0);
      const rot = acc.rotation || 0;
      const sx = acc.scaleX !== undefined ? acc.scaleX : 1.0;
      const sy = acc.scaleY !== undefined ? acc.scaleY : 1.0;
      accGroup.setAttribute('transform', `translate(${finalX}, ${finalY}) rotate(${rot}) scale(${sx}, ${sy})`);

      // Expression-driven visibility trigger
      if (acc.expression) {
        const exprName = acc.expression.toLowerCase().trim();
        const isExprActive = Boolean(activeExpressions && (
          activeExpressions[exprName] === true ||
          activeExpressions[`is${exprName}`] === true ||
          activeExpressions[`is${exprName.charAt(0).toUpperCase()}${exprName.slice(1)}`] === true
        ));
        accGroup.style.display = isExprActive ? '' : 'none';
      } else {
        accGroup.style.display = '';
      }

      scanAndBindAccessoryDirectives(accGroup);
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

  let prevHeadYaw = 0;
  let prevHeadPitch = 0;
  let prevHeadRoll = 0;
  let prevAudioVol = 0;
  let lastTransformTime = 0;

  // Main Animation Transform Calculation
  function applyRigTransforms(now) {
    // Real-time expression-based accessory display
    if (activeAccessories && activeAccessories.length > 0) {
      const svg = container.querySelector('svg');
      if (svg) {
        for (let i = 0; i < activeAccessories.length; i++) {
          const acc = activeAccessories[i];
          if (!acc.enabled || !acc.expression) continue;
          const accNode = svg.querySelector(`.svgtuber-accessory[data-accessory-id="${CSS.escape(acc.id)}"]`);
          if (accNode) {
            const exprName = acc.expression.toLowerCase().trim();
            const isExprActive = Boolean(activeExpressions && (
              activeExpressions[exprName] === true ||
              activeExpressions[`is${exprName}`] === true ||
              activeExpressions[`is${exprName.charAt(0).toUpperCase()}${exprName.slice(1)}`] === true
            ));
            accNode.style.display = isExprActive ? '' : 'none';
          }
        }
      }
    }

    if (!latestParams || activeRigBindings.length === 0) return;

    const p = latestParams;
    const headYaw = p.headYaw || 0;
    const headPitch = p.headPitch || 0;
    const headRoll = p.headRoll || 0;
    const audioVol = parseFloat(p.audioVolume || p.volume || 0);

    const dt = lastTransformTime ? Math.min(0.05, Math.max(0.001, (now - lastTransformTime) / 1000)) : (1 / 60);
    lastTransformTime = now;

    const deltaYaw = headYaw - prevHeadYaw;
    const deltaPitch = headPitch - prevHeadPitch;
    const deltaRoll = headRoll - prevHeadRoll;
    const deltaVol = Math.max(0, audioVol - prevAudioVol);

    prevHeadYaw = headYaw;
    prevHeadPitch = headPitch;
    prevHeadRoll = headRoll;
    prevAudioVol = audioVol;

    let globalPhysicsMult = 1.0;
    if (p.physicsEnabled === false) {
      globalPhysicsMult = 0;
    } else if (p.physicsAmount !== undefined) {
      const val = parseFloat(p.physicsAmount);
      globalPhysicsMult = isNaN(val) ? 1.0 : Math.max(0, val);
    }

    for (let i = 0; i < activeRigBindings.length; i++) {
      const b = activeRigBindings[i];
      const el = b.el;
      let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1;
      let physicsDirective = null;

      for (let j = 0; j < b.directives.length; j++) {
        const d = b.directives[j];
        const type = (d.type || d.Type || d.name || '').toLowerCase().trim();
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
          case 'rotate': {
            const pVal = getParam(params.param || params.target || params.source, 0);
            if (params.from !== undefined || params.to !== undefined) {
              const fromAngle = parseFloat(params.from || 0);
              const toAngle = parseFloat(params.to || 0);
              rot += fromAngle + (toAngle - fromAngle) * pVal;
            } else {
              const range = parseFloat(params.range || params.deg || params.angle || 15);
              rot += pVal * range;
            }
            break;
          }
          case 'fade':
          case 'opacity': {
            let pVal;
            if (params.when) {
              pVal = evaluateCondition(params.when, p) ? 1.0 : 0.0;
            } else {
              const src = params.param || params.target || params.source;
              pVal = getParam(src, 0);
              if (src && src.toLowerCase() === 'smile' && activeExpressions && (activeExpressions['blush'] || activeExpressions['isblush'])) {
                pVal = 1.0;
              }
            }
            const from = parseFloat(params.from !== undefined ? params.from : 0.0);
            const to = parseFloat(params.to !== undefined ? params.to : 1.0);
            const targetOpacity = Math.max(0, Math.min(1, from + (to - from) * pVal));

            if (d._currentOpacity === undefined) {
              d._currentOpacity = from;
            }

            let rate = 0.10; // ~250-300ms smooth ease transition
            if (params.speed) {
              rate = Math.max(0.01, Math.min(1.0, parseFloat(params.speed)));
            } else if (params.duration) {
              const durMs = parseDuration(params.duration, 300);
              rate = Math.max(0.01, Math.min(1.0, (1000 / 60) / durMs * 3.0));
            }

            d._currentOpacity += (targetOpacity - d._currentOpacity) * rate;
            if (Math.abs(targetOpacity - d._currentOpacity) < 0.005) {
              d._currentOpacity = targetOpacity;
            }

            el.style.opacity = d._currentOpacity.toFixed(3);
            if (d._currentOpacity > 0.005) {
              el.style.display = 'inline';
            } else if (from <= 0.005 && targetOpacity <= 0.005) {
              el.style.display = 'none';
            }
            break;
          }
          case 'bounce': {
            const bounceMult = parseFloat(p.bounceAmount !== undefined ? p.bounceAmount : 1.0);
            if (bounceMult <= 0) break;

            const height = parseFloat(params.height || params.y || 7);
            const squash = parseFloat(params.squash || 0.04);
            const minVol = parseFloat(params.minvolume || params.gate || 0.03);
            const vol = parseFloat(p.audioVolume || p.volume || 0);
            const isSpeaking = Boolean(p.isSpeaking || vol > minVol);
            if (isSpeaking && vol > 0.01) {
              const normVol = Math.min(1.0, Math.max(0.2, (vol - minVol) / (1.0 - minVol)));
              const speed = parseFloat(params.speed || 16);
              const hop = Math.abs(Math.sin(now * speed * 0.001));
              const bounceOffset = -hop * height * normVol * bounceMult;
              ty += bounceOffset;
              if (squash > 0) {
                sy *= (1.0 + (hop * squash * normVol * bounceMult));
                sx *= (1.0 - (hop * squash * 0.5 * normVol * bounceMult));
              }
            }
            break;
          }
          case 'sway': {
            if (globalPhysicsMult <= 0) break;
            const srcParam = (params.param || params.source || 'headRoll').trim();
            const pVal = getParam(srcParam, 0);
            const range = parseFloat(params.range || params.deg || params.angle || 10) * globalPhysicsMult;
            const gravity = parseFloat(params.gravity !== undefined ? params.gravity : 0.6);
            const stiffness = parseFloat(params.stiffness || params.k || 0.15);
            const damping = parseFloat(params.damping || params.c || 0.82);
            const wind = parseFloat(params.wind || 0);
            const mass = parseFloat(params.mass || params.inertia || 0.5);

            let targetAngle = 0;
            const rollFactor = parseFloat(params.roll !== undefined ? params.roll : gravity);
            const yawFactor = parseFloat(params.yaw !== undefined ? params.yaw : 0.85);

            if (srcParam.toLowerCase() === 'headroll' || srcParam.toLowerCase() === 'auto' || srcParam.toLowerCase() === 'head') {
              // Gravitational alignment: pendulum tilts opposite to head roll
              targetAngle = -(headRoll / 15.0) * range * rollFactor;
              // Lateral turning swing with head yaw (subtle static bias)
              targetAngle += (headYaw / 25.0) * (range * 0.35) * yawFactor;
            } else if (srcParam.toLowerCase() === 'headyaw') {
              targetAngle = (pVal / 15.0) * range * yawFactor;
            } else {
              targetAngle = pVal * range;
            }

            // Optional ambient wind / idle breeze flutter
            if (wind > 0) {
              const phase = (b.cx * 0.05) + (b.cy * 0.02);
              targetAngle += Math.sin(now * 0.0025 + phase) * wind * range;
            }

            if (d._angle === undefined) {
              d._angle = targetAngle;
              d._velocity = 0;
            }

            const stepRatio = dt * 60;
            // Physical acceleration impulse from head movement (turn and tilt inertia)
            const rollSign = (range < 0) ? -1 : 1;
            const impulse = (-deltaYaw * (params.yaw !== undefined ? parseFloat(params.yaw) : 1.2) * 2.2
                             - deltaRoll * (params.roll !== undefined ? parseFloat(params.roll) : (0.8 * rollSign)) * 1.8)
                             * mass * globalPhysicsMult;
            d._velocity += impulse * stepRatio;

            const force = -stiffness * (d._angle - targetAngle);
            d._velocity = (d._velocity + force * stepRatio) * Math.pow(damping, stepRatio);
            d._angle += d._velocity * stepRatio;

            rot += d._angle;

            const swayX = parseFloat(params.swayx || 0);
            if (swayX !== 0) {
              tx += d._angle * swayX;
            }
            break;
          }
          case 'physics':
          case 'spring': {
            physicsDirective = d;
            break;
          }
          case 'chain': {
            if (globalPhysicsMult <= 0) break;

            if (d._parentBinding === undefined) {
              let parentRef = (params.parent || '').trim();
              if (parentRef.startsWith('#')) parentRef = parentRef.substring(1);

              if (parentRef) {
                d._parentBinding = activeRigBindings.find(pb =>
                  pb !== b && (
                    pb.id === parentRef ||
                    (pb.el && pb.el.id === parentRef) ||
                    (pb.label && pb.label.toLowerCase().includes(parentRef.toLowerCase()))
                  )
                ) || null;
              }

              if (!d._parentBinding) {
                // Check DOM ancestry
                let pNode = b.el.parentElement;
                while (pNode && pNode.tagName && pNode.tagName.toLowerCase() !== 'svg') {
                  const pb = activeRigBindings.find(cand => cand.el === pNode);
                  if (pb) {
                    d._parentBinding = pb;
                    break;
                  }
                  pNode = pNode.parentElement;
                }
              }

              if (!d._parentBinding) {
                // Fallback: previous binding in activeRigBindings
                const myIdx = activeRigBindings.indexOf(b);
                if (myIdx > 0) {
                  d._parentBinding = activeRigBindings[myIdx - 1];
                }
              }
            }

            const parentB = d._parentBinding;
            if (!parentB) break;

            const factor = parseFloat(params.factor || params.mult || 0.85);
            const lag = Math.max(1, parseInt(params.lag || params.delay || 3, 10));
            const stiffness = parseFloat(params.stiffness || params.k || 0.18);
            const damping = parseFloat(params.damping || params.c || 0.80);
            const whip = parseFloat(params.whip || 0.25) * globalPhysicsMult;

            const history = parentB._rotHistory || [parentB._currentRot || 0];
            const histIdx = Math.max(0, history.length - 1 - lag);
            const delayedRot = history[histIdx] !== undefined ? history[histIdx] : (parentB._currentRot || 0);
            const currentParentRot = parentB._currentRot || 0;
            const parentVel = currentParentRot - (history[history.length - 2] !== undefined ? history[history.length - 2] : currentParentRot);

            // Target relative curve angle: delayed parent rotation
            let targetAngle = (delayedRot * factor) * globalPhysicsMult;

            if (params.range || params.max) {
              const maxAngle = parseFloat(params.range || params.max || 60);
              targetAngle = Math.max(-maxAngle, Math.min(maxAngle, targetAngle));
            }

            if (d._chainAngle === undefined) {
              d._chainAngle = targetAngle;
              d._chainVel = 0;
            }

            const stepRatio = dt * 60;
            // Dynamic secondary whip impulse from parent velocity and head turning
            const childWhipImpulse = (-parentVel * whip * 4.0 - deltaYaw * whip * 2.5) * stepRatio;
            d._chainVel += childWhipImpulse;

            const force = -stiffness * (d._chainAngle - targetAngle);
            d._chainVel = (d._chainVel + force * stepRatio) * Math.pow(damping, stepRatio);
            d._chainAngle += d._chainVel * stepRatio;

            rot += d._chainAngle;

            // Sibling forward kinematics: if child is not nested inside parent DOM element,
            // calculate the spatial orbit displacement around parent's pivot
            const isDOMChild = parentB.el && parentB.el.contains(b.el);
            if (!isDOMChild) {
              const rad = (parentB._currentRot || 0) * (Math.PI / 180);
              const dx0 = b.cx - parentB.cx;
              const dy0 = b.cy - parentB.cy;
              const rx = dx0 * Math.cos(rad) - dy0 * Math.sin(rad);
              const ry = dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
              tx += (rx - dx0) + (parentB._currentTx || 0);
              ty += (ry - dy0) + (parentB._currentTy || 0);
              rot += (parentB._currentRot || 0);
            }
            break;
          }
        }
      }

      // Apply secondary spring & inertia physics filter if enabled
      if (physicsDirective && globalPhysicsMult > 0) {
        const pParams = physicsDirective.params || physicsDirective.Params || {};
        const k = parseFloat(pParams.stiffness || pParams.k || 0.16);
        const damp = parseFloat(pParams.damping || pParams.c || 0.82);
        const mass = parseFloat(pParams.mass || pParams.inertia || 0.5) * globalPhysicsMult;
        const axis = (pParams.axis || 'all').toLowerCase();

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

        // Inertia opposing head acceleration and voice audio bounce
        const inertiaX = -deltaYaw * mass * 0.9;
        const inertiaY = -deltaPitch * mass * 0.8 - deltaVol * mass * 6.0;
        const inertiaRot = -deltaRoll * mass * 0.6;

        if (axis === 'all' || axis.includes('x')) {
          const forceX = -k * (state.curTx - tx) + inertiaX;
          state.vx = (state.vx + forceX * stepRatio) * Math.pow(damp, stepRatio);
          state.curTx += state.vx * stepRatio;
          tx = state.curTx;
        }

        if (axis === 'all' || axis.includes('y')) {
          const forceY = -k * (state.curTy - ty) + inertiaY;
          state.vy = (state.vy + forceY * stepRatio) * Math.pow(damp, stepRatio);
          state.curTy += state.vy * stepRatio;
          ty = state.curTy;
        }

        if (axis === 'all' || axis.includes('rot') || axis.includes('angle') || axis.includes('roll')) {
          const forceRot = -k * (state.curRot - rot) + inertiaRot;
          state.vRot = (state.vRot + forceRot * stepRatio) * Math.pow(damp, stepRatio);
          state.curRot += state.vRot * stepRatio;
          rot = state.curRot;
        }
      } else if (b._physicsState && globalPhysicsMult <= 0) {
        // Reset state when physics is disabled
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
          syncAccessories();
          applyRigTransforms(performance.now());
        } else if (msg.type === 'accessory_update') {
          syncAccessories(msg.accessories);
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
