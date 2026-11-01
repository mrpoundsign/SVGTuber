"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// integrations/streamdeck/src/plugin.ts
var plugin_exports = {};
__export(plugin_exports, {
  ACTION_ACCESSORY: () => ACTION_ACCESSORY,
  ACTION_AVATAR: () => ACTION_AVATAR,
  ACTION_CALIBRATE: () => ACTION_CALIBRATE,
  ACTION_EXPRESSION: () => ACTION_EXPRESSION,
  ACTION_MODE: () => ACTION_MODE,
  DEFAULT_PORT: () => DEFAULT_PORT,
  SVGTuberStreamDeckPlugin: () => SVGTuberStreamDeckPlugin,
  escapeXml: () => escapeXml,
  renderIconSvg: () => renderIconSvg,
  svgDataUri: () => svgDataUri
});
module.exports = __toCommonJS(plugin_exports);
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);

// integrations/streamdeck/src/ws_client.ts
var crypto = __toESM(require("node:crypto"), 1);
var import_node_events = require("node:events");
var http = __toESM(require("node:http"), 1);
var NodeWebSocketClient = class _NodeWebSocketClient extends import_node_events.EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = _NodeWebSocketClient.CONNECTING;
  req = null;
  socket = null;
  rxBuffer = Buffer.alloc(0);
  fragments = [];
  constructor(urlStr) {
    super();
    this.connect(urlStr);
  }
  connect(urlStr) {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      queueMicrotask(() => this.emit("error", err));
      return;
    }
    const key = crypto.randomBytes(16).toString("base64");
    const port = parsed.port ? parseInt(parsed.port, 10) : 80;
    const path2 = (parsed.pathname || "/") + (parsed.search || "");
    const req = http.request({
      hostname: parsed.hostname || "127.0.0.1",
      port,
      path: path2,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: `http://${parsed.hostname || "127.0.0.1"}:${port}`,
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key
      }
    });
    this.req = req;
    req.on("upgrade", (_res, socket, head) => {
      this.socket = socket;
      this.readyState = _NodeWebSocketClient.OPEN;
      socket.setNoDelay(true);
      if (head && head.length > 0) {
        this.rxBuffer = Buffer.concat([this.rxBuffer, head]);
      }
      socket.on("data", (chunk) => {
        this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
        this.consumeFrames();
      });
      socket.on("close", () => {
        const wasOpen = this.readyState !== _NodeWebSocketClient.CLOSED;
        this.readyState = _NodeWebSocketClient.CLOSED;
        if (wasOpen) {
          this.emit("close");
        }
      });
      socket.on("error", (err) => {
        this.emit("error", err);
      });
      this.emit("open");
      if (this.rxBuffer.length > 0) {
        this.consumeFrames();
      }
    });
    req.on("response", (res) => {
      this.readyState = _NodeWebSocketClient.CLOSED;
      this.emit("error", new Error(`Unexpected HTTP status ${res.statusCode}`));
      this.emit("close");
    });
    req.on("error", (err) => {
      this.readyState = _NodeWebSocketClient.CLOSED;
      this.emit("error", err);
      this.emit("close");
    });
    req.end();
  }
  send(data) {
    if (this.readyState !== _NodeWebSocketClient.OPEN || !this.socket) {
      return;
    }
    const isText = typeof data === "string";
    const payload = isText ? Buffer.from(data, "utf8") : Buffer.from(data);
    this.writeMaskedFrame(isText ? 1 : 2, payload);
  }
  close() {
    if (this.readyState === _NodeWebSocketClient.CLOSED) {
      return;
    }
    this.readyState = _NodeWebSocketClient.CLOSED;
    try {
      this.req?.destroy();
    } catch {
    }
    if (this.socket) {
      try {
        this.writeMaskedFrame(8, Buffer.alloc(0));
        this.socket.end();
        this.socket.destroy();
      } catch {
      }
      this.socket = null;
    }
    this.emit("close");
  }
  writeMaskedFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) {
      return;
    }
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let headerLen = 2;
    if (len >= 126 && len <= 65535) {
      headerLen = 4;
    } else if (len > 65535) {
      headerLen = 10;
    }
    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = 128 | opcode & 15;
    if (len < 126) {
      frame[1] = 128 | len;
    } else if (len <= 65535) {
      frame[1] = 128 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 128 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
    }
    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payload[i] ^ mask[i & 3];
    }
    this.socket.write(frame);
  }
  consumeFrames() {
    while (this.rxBuffer.length >= 2) {
      const b0 = this.rxBuffer[0];
      const b1 = this.rxBuffer[1];
      const fin = (b0 & 128) !== 0;
      const opcode = b0 & 15;
      const masked = (b1 & 128) !== 0;
      let payloadLen = b1 & 127;
      let offset = 2;
      if (payloadLen === 126) {
        if (this.rxBuffer.length < 4) return;
        payloadLen = this.rxBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.rxBuffer.length < 10) return;
        payloadLen = Number(this.rxBuffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (this.rxBuffer.length < offset + maskLen + payloadLen) {
        return;
      }
      let payload = this.rxBuffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = this.rxBuffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i & 3];
        }
        payload = unmasked;
      }
      this.rxBuffer = this.rxBuffer.subarray(offset + maskLen + payloadLen);
      if (opcode === 8) {
        this.close();
        return;
      } else if (opcode === 9) {
        this.writeMaskedFrame(10, payload);
      } else if (opcode === 0 || opcode === 1 || opcode === 2) {
        this.fragments.push(Buffer.from(payload));
        if (fin) {
          const full = Buffer.concat(this.fragments);
          this.fragments = [];
          this.emit("message", full.toString("utf8"));
        }
      }
    }
  }
};

// integrations/streamdeck/src/plugin.ts
var DEFAULT_PORT = 7420;
var ACTION_EXPRESSION = "com.github.mrpoundsign.svgtuber.expression";
var ACTION_ACCESSORY = "com.github.mrpoundsign.svgtuber.accessory";
var ACTION_AVATAR = "com.github.mrpoundsign.svgtuber.avatar";
var ACTION_MODE = "com.github.mrpoundsign.svgtuber.mode";
var ACTION_CALIBRATE = "com.github.mrpoundsign.svgtuber.calibrate";
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function renderIconSvg(kind, accent) {
  switch (kind) {
    case "expr_on":
      return `<circle cx="72" cy="46" r="20" stroke="${accent}" stroke-width="4" fill="none"/>
              <circle cx="64" cy="41" r="3" fill="#F8FAFC"/>
              <circle cx="80" cy="41" r="3" fill="#F8FAFC"/>
              <path d="M62 51 Q72 60 82 51" stroke="${accent}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case "expr_off":
      return `<circle cx="72" cy="46" r="20" stroke="${accent}" stroke-width="4" fill="none"/>
              <circle cx="64" cy="42" r="3" fill="#F8FAFC"/>
              <circle cx="80" cy="42" r="3" fill="#F8FAFC"/>
              <line x1="63" y1="53" x2="81" y2="53" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`;
    case "expr_clear":
      return `<circle cx="72" cy="46" r="20" stroke="${accent}" stroke-width="4" fill="none"/>
              <line x1="63" y1="37" x2="81" y2="55" stroke="#F8FAFC" stroke-width="4" stroke-linecap="round"/>
              <line x1="81" y1="37" x2="63" y2="55" stroke="#F8FAFC" stroke-width="4" stroke-linecap="round"/>`;
    case "acc_on":
      return `<rect x="42" y="38" width="24" height="16" rx="4" stroke="${accent}" stroke-width="4" fill="none"/>
              <rect x="78" y="38" width="24" height="16" rx="4" stroke="${accent}" stroke-width="4" fill="none"/>
              <line x1="66" y1="45" x2="78" y2="45" stroke="#F8FAFC" stroke-width="4" stroke-linecap="round"/>`;
    case "acc_off":
      return `<rect x="42" y="38" width="24" height="16" rx="4" stroke="${accent}" stroke-width="4" fill="none"/>
              <rect x="78" y="38" width="24" height="16" rx="4" stroke="${accent}" stroke-width="4" fill="none"/>
              <line x1="66" y1="45" x2="78" y2="45" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>
              <line x1="48" y1="60" x2="96" y2="32" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>`;
    case "avatar":
      return `<circle cx="72" cy="38" r="11" fill="${accent}"/>
              <path d="M52 64 C52 51 92 51 92 64" stroke="#F8FAFC" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case "mode_hybrid":
      return `<rect x="44" y="34" width="38" height="26" rx="5" stroke="${accent}" stroke-width="4" fill="none"/>
              <polygon points="86,41 98,34 98,60 86,53" fill="#F8FAFC"/>
              <circle cx="63" cy="47" r="5" fill="${accent}"/>`;
    case "mode_camera":
      return `<rect x="46" y="34" width="40" height="26" rx="5" stroke="${accent}" stroke-width="4" fill="none"/>
              <polygon points="90,41 100,35 100,59 90,53" fill="${accent}"/>`;
    case "mode_audio":
      return `<rect x="64" y="28" width="16" height="24" rx="8" fill="${accent}"/>
              <path d="M56 44 C56 54 88 54 88 44" stroke="#F8FAFC" stroke-width="4" fill="none" stroke-linecap="round"/>
              <line x1="72" y1="54" x2="72" y2="64" stroke="#F8FAFC" stroke-width="4" stroke-linecap="round"/>`;
    case "calibrate":
      return `<circle cx="72" cy="46" r="17" stroke="${accent}" stroke-width="4" fill="none"/>
              <line x1="72" y1="23" x2="72" y2="69" stroke="#F8FAFC" stroke-width="3" stroke-linecap="round"/>
              <line x1="49" y1="46" x2="95" y2="46" stroke="#F8FAFC" stroke-width="3" stroke-linecap="round"/>`;
  }
}
function svgDataUri(bg, border, icon, labelTop, labelBottom, accent) {
  const safeTop = escapeXml(labelTop.slice(0, 14));
  const safeBottom = escapeXml(labelBottom.slice(0, 14));
  const iconMarkup = renderIconSvg(icon, accent);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect x="4" y="4" width="136" height="136" rx="22" fill="${bg}" stroke="${border}" stroke-width="4"/>
    ${iconMarkup}
    <text x="72" y="96" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#F8FAFC" text-anchor="middle">${safeTop}</text>
    <text x="72" y="120" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="${accent}" text-anchor="middle">${safeBottom}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
var SVGTuberStreamDeckPlugin = class {
  sdWs = null;
  stWs = null;
  reconnectTimer = null;
  flashTimer = null;
  pluginUUID = "";
  registerEvent = "";
  sdPort = 0;
  globalSettings = {
    host: "127.0.0.1",
    port: DEFAULT_PORT
  };
  actions = /* @__PURE__ */ new Map();
  pendingCommands = [];
  state = {
    currentAvatar: "avatar.svg",
    avatars: [],
    expressions: {},
    availableExpressions: [],
    accessories: [],
    mode: "hybrid",
    calibratedFlash: false
  };
  shuttingDown = false;
  startFromArgs(argv) {
    this.loadBundledConfig();
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "-port" && i + 1 < argv.length) {
        this.sdPort = parseInt(argv[++i] ?? "0", 10);
      } else if (arg === "-pluginUUID" && i + 1 < argv.length) {
        this.pluginUUID = argv[++i] ?? "";
      } else if (arg === "-registerEvent" && i + 1 < argv.length) {
        this.registerEvent = argv[++i] ?? "";
      } else if (arg === "-svgtuberUrl" && i + 1 < argv.length) {
        this.globalSettings.svgtuberWsUrl = argv[++i] ?? "";
      }
    }
    if (!this.sdPort || !this.pluginUUID || !this.registerEvent) {
      throw new Error("Missing required Stream Deck CLI arguments (-port, -pluginUUID, -registerEvent)");
    }
    this.connectStreamDeck();
    this.connectSVGTuber();
  }
  loadBundledConfig() {
    try {
      const cfgPath = path.resolve(__dirname, "..", "config.json");
      if (fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (typeof raw.host === "string" && raw.host.trim() !== "") {
          this.globalSettings.host = raw.host.trim();
        }
        if (typeof raw.port === "number" && raw.port > 0 && raw.port <= 65535) {
          this.globalSettings.port = raw.port;
        }
      }
    } catch {
    }
  }
  stop() {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.stWs?.close();
    this.sdWs?.close();
  }
  connectStreamDeck() {
    const url = `ws://127.0.0.1:${this.sdPort}`;
    this.sdWs = new NodeWebSocketClient(url);
    this.sdWs.on("open", () => {
      this.sendToSD({
        event: this.registerEvent,
        uuid: this.pluginUUID
      });
      this.sendToSD({
        event: "getGlobalSettings",
        context: this.pluginUUID
      });
    });
    this.sdWs.on("message", (text) => {
      try {
        const msg = JSON.parse(text);
        this.handleStreamDeckMessage(msg);
      } catch {
      }
    });
    this.sdWs.on("close", () => {
      if (!this.shuttingDown) {
        process.exit(0);
      }
    });
    this.sdWs.on("error", () => {
    });
  }
  buildSVGTuberWsUrl() {
    if (this.globalSettings.svgtuberWsUrl) {
      return this.globalSettings.svgtuberWsUrl;
    }
    const host = this.globalSettings.host || "127.0.0.1";
    const port = this.globalSettings.port || DEFAULT_PORT;
    return `ws://${host}:${port}/ws/tracker?client=streamdeck`;
  }
  connectSVGTuber() {
    if (this.shuttingDown) return;
    if (this.stWs) {
      this.stWs.removeAllListeners();
      try {
        this.stWs.close();
      } catch {
      }
      this.stWs = null;
    }
    const url = this.buildSVGTuberWsUrl();
    const ws = new NodeWebSocketClient(url);
    this.stWs = ws;
    ws.on("open", () => {
      this.sendCommand({ type: "get_state" });
      while (this.pendingCommands.length > 0) {
        const nextCmd = this.pendingCommands.shift();
        ws.send(JSON.stringify(nextCmd));
      }
    });
    ws.on("message", (text) => {
      try {
        const msg = JSON.parse(text);
        this.handleSVGTuberMessage(msg);
      } catch {
      }
    });
    ws.on("close", () => {
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });
    ws.on("error", () => {
    });
  }
  scheduleReconnect() {
    if (this.reconnectTimer || this.shuttingDown) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSVGTuber();
    }, 2e3);
  }
  handleSVGTuberMessage(msg) {
    const type = String(msg.type ?? "");
    switch (type) {
      case "state_snapshot": {
        if (typeof msg.currentAvatar === "string") {
          this.state.currentAvatar = msg.currentAvatar;
        }
        if (Array.isArray(msg.avatars)) {
          this.state.avatars = msg.avatars.map(String);
        }
        if (msg.expressions && typeof msg.expressions === "object") {
          this.state.expressions = msg.expressions;
        }
        if (Array.isArray(msg.availableExpressions)) {
          this.state.availableExpressions = msg.availableExpressions.map(String);
        }
        if (Array.isArray(msg.accessories)) {
          this.state.accessories = msg.accessories;
        }
        if (msg.mode === "hybrid" || msg.mode === "camera" || msg.mode === "audio") {
          this.state.mode = msg.mode;
        }
        this.refreshAllActions();
        break;
      }
      case "expression_update": {
        if (msg.expressions && typeof msg.expressions === "object") {
          this.state.expressions = msg.expressions;
        }
        this.refreshAllActions();
        break;
      }
      case "accessory_update": {
        if (Array.isArray(msg.accessories)) {
          this.state.accessories = msg.accessories;
        }
        this.refreshAllActions();
        break;
      }
      case "avatar_swapped": {
        if (typeof msg.currentAvatar === "string") {
          this.state.currentAvatar = msg.currentAvatar;
        }
        if (Array.isArray(msg.avatars)) {
          this.state.avatars = msg.avatars.map(String);
        }
        this.refreshAllActions();
        break;
      }
      case "mode_update": {
        if (msg.mode === "hybrid" || msg.mode === "camera" || msg.mode === "audio") {
          this.state.mode = msg.mode;
        }
        this.refreshAllActions();
        break;
      }
      case "calibrated":
      case "calibration_reset": {
        this.state.calibratedFlash = true;
        this.refreshAllActions();
        if (this.flashTimer) {
          clearTimeout(this.flashTimer);
        }
        this.flashTimer = setTimeout(() => {
          this.state.calibratedFlash = false;
          this.refreshAllActions();
        }, 1200);
        break;
      }
    }
  }
  sendCommand(cmd, actionContext) {
    if (!this.stWs || this.stWs.readyState !== NodeWebSocketClient.OPEN) {
      if (this.stWs && this.stWs.readyState === NodeWebSocketClient.CONNECTING) {
        this.pendingCommands.push(cmd);
        return true;
      }
      if (actionContext) {
        this.sendToSD({
          event: "showAlert",
          context: actionContext
        });
      }
      return false;
    }
    this.stWs.send(JSON.stringify(cmd));
    return true;
  }
  sendToSD(msg) {
    if (!this.sdWs || this.sdWs.readyState !== NodeWebSocketClient.OPEN) {
      return;
    }
    this.sdWs.send(JSON.stringify(msg));
  }
  handleStreamDeckMessage(msg) {
    switch (msg.event) {
      case "didReceiveGlobalSettings": {
        const s = msg.payload?.settings ?? {};
        const prevUrl = this.buildSVGTuberWsUrl();
        if (typeof s.host === "string" && s.host.trim() !== "") {
          this.globalSettings.host = s.host.trim();
        }
        if (typeof s.port === "number" && s.port > 0 && s.port <= 65535) {
          this.globalSettings.port = s.port;
        }
        if (typeof s.svgtuberWsUrl === "string" && s.svgtuberWsUrl.trim() !== "") {
          this.globalSettings.svgtuberWsUrl = s.svgtuberWsUrl.trim();
        }
        if (this.buildSVGTuberWsUrl() !== prevUrl) {
          this.connectSVGTuber();
        }
        break;
      }
      case "willAppear": {
        if (msg.context && msg.action) {
          const inst = {
            action: msg.action,
            context: msg.context,
            settings: msg.payload?.settings ?? {}
          };
          this.actions.set(msg.context, inst);
          this.refreshAction(inst);
        }
        break;
      }
      case "willDisappear": {
        if (msg.context) {
          this.actions.delete(msg.context);
        }
        break;
      }
      case "didReceiveSettings": {
        if (msg.context && this.actions.has(msg.context)) {
          const inst = this.actions.get(msg.context);
          inst.settings = msg.payload?.settings ?? {};
          this.refreshAction(inst);
        }
        break;
      }
      case "keyDown": {
        if (msg.context && msg.action) {
          const inst = this.actions.get(msg.context) ?? {
            action: msg.action,
            context: msg.context,
            settings: msg.payload?.settings ?? {}
          };
          this.handleKeyDown(inst);
        }
        break;
      }
    }
  }
  handleKeyDown(inst) {
    switch (inst.action) {
      case ACTION_EXPRESSION: {
        const op = String(inst.settings.operation ?? "toggle").toLowerCase();
        const name = String(inst.settings.expression ?? "").trim().toLowerCase();
        const duration = String(inst.settings.duration ?? "3s").trim() || "3s";
        if (op === "reset") {
          this.sendCommand({ type: "expression_reset" }, inst.context);
          return;
        }
        if (!name) {
          this.sendToSD({ event: "showAlert", context: inst.context });
          return;
        }
        if (op === "trigger") {
          this.sendCommand({ type: "expression_trigger", name, duration }, inst.context);
        } else if (op === "enable") {
          this.sendCommand({ type: "expression_set", name, active: true }, inst.context);
        } else if (op === "disable") {
          this.sendCommand({ type: "expression_set", name, active: false }, inst.context);
        } else {
          this.sendCommand({ type: "expression_toggle", name }, inst.context);
        }
        break;
      }
      case ACTION_ACCESSORY: {
        const id = String(inst.settings.accessoryId ?? "").trim();
        if (!id) {
          this.sendToSD({ event: "showAlert", context: inst.context });
          return;
        }
        this.sendCommand({ type: "accessory_toggle", id }, inst.context);
        break;
      }
      case ACTION_AVATAR: {
        const op = String(inst.settings.operation ?? "cycle").toLowerCase();
        if (op === "reload") {
          this.sendCommand({ type: "avatar_reload" }, inst.context);
        } else if (op === "select") {
          const avatar = String(inst.settings.avatar ?? "").trim();
          if (!avatar) {
            this.sendToSD({ event: "showAlert", context: inst.context });
            return;
          }
          this.sendCommand({ type: "avatar_select", avatar }, inst.context);
        } else {
          this.sendCommand({ type: "avatar_cycle" }, inst.context);
        }
        break;
      }
      case ACTION_MODE: {
        const target = String(inst.settings.targetMode ?? "cycle").toLowerCase();
        if (target === "hybrid" || target === "camera" || target === "audio") {
          this.sendCommand({ type: "set_mode", mode: target }, inst.context);
        } else {
          this.sendCommand({ type: "cycle_mode" }, inst.context);
        }
        break;
      }
      case ACTION_CALIBRATE: {
        const op = String(inst.settings.operation ?? "calibrate").toLowerCase();
        if (op === "reset") {
          this.sendCommand({ type: "reset_calibration" }, inst.context);
        } else {
          this.sendCommand({ type: "calibrate" }, inst.context);
        }
        break;
      }
    }
  }
  refreshAllActions() {
    for (const inst of this.actions.values()) {
      this.refreshAction(inst);
    }
  }
  clearNativeTitle(context) {
    this.sendToSD({
      event: "setTitle",
      context,
      payload: { title: "", target: 0 }
    });
  }
  findAccessory(query) {
    const q = query.trim().toLowerCase();
    if (!q) return void 0;
    return this.state.accessories.find(
      (a) => a.id.toLowerCase() === q || a.file.toLowerCase() === q || a.file.replace(/\.svg$/i, "").toLowerCase() === q || a.name && a.name.toLowerCase() === q
    );
  }
  refreshAction(inst) {
    const s = this.state;
    this.clearNativeTitle(inst.context);
    switch (inst.action) {
      case ACTION_EXPRESSION: {
        const op = String(inst.settings.operation ?? "toggle").toLowerCase();
        const rawExpr = String(inst.settings.expression ?? "").trim().toLowerCase();
        const customLabel = String(inst.settings.label ?? "").trim();
        if (op === "reset") {
          const activeCount = Object.values(s.expressions).filter(Boolean).length;
          const top2 = customLabel || "EXPRESSIONS";
          const bottom2 = activeCount > 0 ? `CLEAR (${activeCount})` : "ALL CLEAR";
          const accent2 = activeCount > 0 ? "#F59E0B" : "#38BDF8";
          const image2 = svgDataUri("#0F172A", accent2, "expr_clear", top2, bottom2, accent2);
          this.sendToSD({
            event: "setImage",
            context: inst.context,
            payload: { image: image2, target: 0 }
          });
          return;
        }
        const isActive = rawExpr ? Boolean(s.expressions[rawExpr]) : false;
        const top = customLabel || (rawExpr ? rawExpr.toUpperCase() : "EXPRESSION");
        const bottom = !rawExpr ? "SET NAME" : isActive ? "ACTIVE" : "OFF";
        const accent = isActive ? "#22C55E" : "#38BDF8";
        const bg = isActive ? "#052E16" : "#0F172A";
        const icon = isActive ? "expr_on" : "expr_off";
        const image = svgDataUri(bg, accent, icon, top, bottom, accent);
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 }
        });
        this.sendToSD({
          event: "setState",
          context: inst.context,
          payload: { state: isActive ? 1 : 0 }
        });
        break;
      }
      case ACTION_ACCESSORY: {
        const rawId = String(inst.settings.accessoryId ?? "").trim();
        const customLabel = String(inst.settings.label ?? "").trim();
        const match = this.findAccessory(rawId);
        const enabled = Boolean(match?.enabled);
        const displayName = customLabel || (match?.name || rawId.replace(/\.svg$/i, "") || "ACCESSORY").toUpperCase();
        const bottom = !rawId ? "SET ITEM" : enabled ? "EQUIPPED" : "HIDDEN";
        const accent = enabled ? "#22C55E" : "#64748B";
        const bg = enabled ? "#052E16" : "#0F172A";
        const icon = enabled ? "acc_on" : "acc_off";
        const image = svgDataUri(bg, accent, icon, displayName, bottom, enabled ? "#22C55E" : "#94A3B8");
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 }
        });
        this.sendToSD({
          event: "setState",
          context: inst.context,
          payload: { state: enabled ? 1 : 0 }
        });
        break;
      }
      case ACTION_AVATAR: {
        const op = String(inst.settings.operation ?? "cycle").toLowerCase();
        const targetAvatar = String(inst.settings.avatar ?? "").trim();
        const customLabel = String(inst.settings.label ?? "").trim();
        const currentShort = (s.currentAvatar || "avatar.svg").replace(/\.svg$/i, "").toUpperCase();
        let top = customLabel || "AVATAR";
        let bottom = currentShort;
        let accent = "#38BDF8";
        if (op === "reload") {
          top = customLabel || "RELOAD RIG";
          bottom = currentShort;
        } else if (op === "select" && targetAvatar) {
          const targetShort = targetAvatar.replace(/\.svg$/i, "").toUpperCase();
          const isCurrent = s.currentAvatar.toLowerCase() === targetAvatar.toLowerCase();
          top = customLabel || targetShort;
          bottom = isCurrent ? "ACTIVE" : "SWITCH";
          accent = isCurrent ? "#22C55E" : "#38BDF8";
        }
        const image = svgDataUri("#0F172A", accent, "avatar", top, bottom, accent);
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 }
        });
        break;
      }
      case ACTION_MODE: {
        let image = svgDataUri("#0F172A", "#38BDF8", "mode_hybrid", "TRACK MODE", "HYBRID", "#38BDF8");
        if (s.mode === "camera") {
          image = svgDataUri("#0F172A", "#22C55E", "mode_camera", "TRACK MODE", "CAMERA ONLY", "#22C55E");
        } else if (s.mode === "audio") {
          image = svgDataUri("#0F172A", "#F59E0B", "mode_audio", "TRACK MODE", "AUDIO ONLY", "#F59E0B");
        }
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 }
        });
        break;
      }
      case ACTION_CALIBRATE: {
        const op = String(inst.settings.operation ?? "calibrate").toLowerCase();
        const isFlash = s.calibratedFlash;
        const top = op === "reset" ? "RESET POSE" : "CALIBRATE";
        const bottom = isFlash ? "\u2713 DONE!" : op === "reset" ? "DEFAULT" : "NEUTRAL";
        const accent = isFlash ? "#22C55E" : "#38BDF8";
        const bg = isFlash ? "#052E16" : "#0F172A";
        const image = svgDataUri(bg, accent, "calibrate", top, bottom, accent);
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 }
        });
        break;
      }
    }
  }
};
if (typeof process !== "undefined" && Array.isArray(process.argv) && process.argv.includes("-port")) {
  const plugin = new SVGTuberStreamDeckPlugin();
  plugin.startFromArgs(process.argv.slice(2));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ACTION_ACCESSORY,
  ACTION_AVATAR,
  ACTION_CALIBRATE,
  ACTION_EXPRESSION,
  ACTION_MODE,
  DEFAULT_PORT,
  SVGTuberStreamDeckPlugin,
  escapeXml,
  renderIconSvg,
  svgDataUri
});
