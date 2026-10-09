(() => {
  const container = document.getElementById('avatar-container');
  const statusIndicator = document.getElementById('status-indicator');
  let socket = null;
  let reconnectTimer = null;

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
    } catch (err) {
      console.error('[SVGTuber] Failed to load avatar:', err);
      setStatus(`Avatar load error: ${err.message}`, true);
    }
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
        } else if (msg.type === 'param_frame') {
          // Future hooks for Milestone 3 runtime animation
        }
      } catch (err) {
        console.error('[SVGTuber] Failed to parse message:', err, event.data);
      }
    };

    socket.onclose = () => {
      console.warn('[SVGTuber] WebSocket closed. Reconnecting in 2s...');
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
