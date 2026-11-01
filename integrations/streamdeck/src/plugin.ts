import * as fs from "node:fs";
import * as path from "node:path";
import { NodeWebSocketClient } from "./ws_client";

export const DEFAULT_PORT = 7420;

export interface ActionInstance {
  action: string;
  context: string;
  settings: Record<string, unknown>;
}

export interface GlobalSettings {
  host?: string;
  port?: number;
  svgtuberWsUrl?: string;
}

export interface AccessoryItem {
  id: string;
  file: string;
  name?: string;
  enabled: boolean;
}

export interface SVGTuberState {
  currentAvatar: string;
  avatars: string[];
  expressions: Record<string, boolean>;
  availableExpressions: string[];
  accessories: AccessoryItem[];
  mode: "hybrid" | "camera" | "audio";
  calibratedFlash: boolean;
}

interface SDIncomingMessage {
  event: string;
  action?: string;
  context?: string;
  payload?: {
    settings?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export const ACTION_EXPRESSION = "com.github.mrpoundsign.svgtuber.expression";
export const ACTION_ACCESSORY = "com.github.mrpoundsign.svgtuber.accessory";
export const ACTION_AVATAR = "com.github.mrpoundsign.svgtuber.avatar";
export const ACTION_MODE = "com.github.mrpoundsign.svgtuber.mode";
export const ACTION_CALIBRATE = "com.github.mrpoundsign.svgtuber.calibrate";

export type IconKind =
  | "expr_on"
  | "expr_off"
  | "expr_clear"
  | "acc_on"
  | "acc_off"
  | "avatar"
  | "mode_hybrid"
  | "mode_camera"
  | "mode_audio"
  | "calibrate";

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderIconSvg(kind: IconKind, accent: string): string {
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

export function svgDataUri(
  bg: string,
  border: string,
  icon: IconKind,
  labelTop: string,
  labelBottom: string,
  accent: string,
): string {
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

export class SVGTuberStreamDeckPlugin {
  private sdWs: NodeWebSocketClient | null = null;
  private stWs: NodeWebSocketClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private pluginUUID = "";
  private registerEvent = "";
  private sdPort = 0;
  private globalSettings: GlobalSettings = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
  };
  private actions = new Map<string, ActionInstance>();
  private pendingCommands: Array<Record<string, unknown>> = [];
  private state: SVGTuberState = {
    currentAvatar: "avatar.svg",
    avatars: [],
    expressions: {},
    availableExpressions: [],
    accessories: [],
    mode: "hybrid",
    calibratedFlash: false,
  };
  private shuttingDown = false;

  public startFromArgs(argv: string[]): void {
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

  private loadBundledConfig(): void {
    try {
      const cfgPath = path.resolve(__dirname, "..", "config.json");
      if (fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as { host?: string; port?: number };
        if (typeof raw.host === "string" && raw.host.trim() !== "") {
          this.globalSettings.host = raw.host.trim();
        }
        if (typeof raw.port === "number" && raw.port > 0 && raw.port <= 65535) {
          this.globalSettings.port = raw.port;
        }
      }
    } catch {
      // Ignore if config.json is absent or unreadable
    }
  }

  public stop(): void {
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

  private connectStreamDeck(): void {
    const url = `ws://127.0.0.1:${this.sdPort}`;
    this.sdWs = new NodeWebSocketClient(url);

    this.sdWs.on("open", () => {
      this.sendToSD({
        event: this.registerEvent,
        uuid: this.pluginUUID,
      });
      this.sendToSD({
        event: "getGlobalSettings",
        context: this.pluginUUID,
      });
    });

    this.sdWs.on("message", (text: string) => {
      try {
        const msg = JSON.parse(text) as SDIncomingMessage;
        this.handleStreamDeckMessage(msg);
      } catch {
        // Ignore malformed host frames
      }
    });

    this.sdWs.on("close", () => {
      if (!this.shuttingDown) {
        process.exit(0);
      }
    });

    this.sdWs.on("error", () => {
      // Handled by close
    });
  }

  public buildSVGTuberWsUrl(): string {
    if (this.globalSettings.svgtuberWsUrl) {
      return this.globalSettings.svgtuberWsUrl;
    }
    const host = this.globalSettings.host || "127.0.0.1";
    const port = this.globalSettings.port || DEFAULT_PORT;
    return `ws://${host}:${port}/ws/tracker?client=streamdeck`;
  }

  private connectSVGTuber(): void {
    if (this.shuttingDown) return;
    if (this.stWs) {
      this.stWs.removeAllListeners();
      try {
        this.stWs.close();
      } catch {
        // ignore
      }
      this.stWs = null;
    }

    const url = this.buildSVGTuberWsUrl();
    const ws = new NodeWebSocketClient(url);
    this.stWs = ws;

    ws.on("open", () => {
      this.sendCommand({ type: "get_state" });
      while (this.pendingCommands.length > 0) {
        const nextCmd = this.pendingCommands.shift()!;
        ws.send(JSON.stringify(nextCmd));
      }
    });

    ws.on("message", (text: string) => {
      try {
        const msg = JSON.parse(text) as Record<string, unknown>;
        this.handleSVGTuberMessage(msg);
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on("close", () => {
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", () => {
      // Handled by close
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSVGTuber();
    }, 2000);
  }

  public handleSVGTuberMessage(msg: Record<string, unknown>): void {
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
          this.state.expressions = msg.expressions as Record<string, boolean>;
        }
        if (Array.isArray(msg.availableExpressions)) {
          this.state.availableExpressions = msg.availableExpressions.map(String);
        }
        if (Array.isArray(msg.accessories)) {
          this.state.accessories = msg.accessories as AccessoryItem[];
        }
        if (msg.mode === "hybrid" || msg.mode === "camera" || msg.mode === "audio") {
          this.state.mode = msg.mode;
        }
        this.refreshAllActions();
        break;
      }

      case "expression_update": {
        if (msg.expressions && typeof msg.expressions === "object") {
          this.state.expressions = msg.expressions as Record<string, boolean>;
        }
        this.refreshAllActions();
        break;
      }

      case "accessory_update": {
        if (Array.isArray(msg.accessories)) {
          this.state.accessories = msg.accessories as AccessoryItem[];
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

  private sendCommand(cmd: Record<string, unknown>, actionContext?: string): boolean {
    if (!this.stWs || this.stWs.readyState !== NodeWebSocketClient.OPEN) {
      if (this.stWs && this.stWs.readyState === NodeWebSocketClient.CONNECTING) {
        this.pendingCommands.push(cmd);
        return true;
      }
      if (actionContext) {
        this.sendToSD({
          event: "showAlert",
          context: actionContext,
        });
      }
      return false;
    }
    this.stWs.send(JSON.stringify(cmd));
    return true;
  }

  private sendToSD(msg: Record<string, unknown>): void {
    if (!this.sdWs || this.sdWs.readyState !== NodeWebSocketClient.OPEN) {
      return;
    }
    this.sdWs.send(JSON.stringify(msg));
  }

  private handleStreamDeckMessage(msg: SDIncomingMessage): void {
    switch (msg.event) {
      case "didReceiveGlobalSettings": {
        const s = (msg.payload?.settings ?? {}) as GlobalSettings;
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
          const inst: ActionInstance = {
            action: msg.action,
            context: msg.context,
            settings: msg.payload?.settings ?? {},
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
          const inst = this.actions.get(msg.context)!;
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
            settings: msg.payload?.settings ?? {},
          };
          this.handleKeyDown(inst);
        }
        break;
      }
    }
  }

  private handleKeyDown(inst: ActionInstance): void {
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

  private refreshAllActions(): void {
    for (const inst of this.actions.values()) {
      this.refreshAction(inst);
    }
  }

  private clearNativeTitle(context: string): void {
    this.sendToSD({
      event: "setTitle",
      context,
      payload: { title: "", target: 0 },
    });
  }

  private findAccessory(query: string): AccessoryItem | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return this.state.accessories.find(
      (a) =>
        a.id.toLowerCase() === q ||
        a.file.toLowerCase() === q ||
        a.file.replace(/\.svg$/i, "").toLowerCase() === q ||
        (a.name && a.name.toLowerCase() === q),
    );
  }

  private refreshAction(inst: ActionInstance): void {
    const s = this.state;
    this.clearNativeTitle(inst.context);

    switch (inst.action) {
      case ACTION_EXPRESSION: {
        const op = String(inst.settings.operation ?? "toggle").toLowerCase();
        const rawExpr = String(inst.settings.expression ?? "").trim().toLowerCase();
        const customLabel = String(inst.settings.label ?? "").trim();

        if (op === "reset") {
          const activeCount = Object.values(s.expressions).filter(Boolean).length;
          const top = customLabel || "EXPRESSIONS";
          const bottom = activeCount > 0 ? `CLEAR (${activeCount})` : "ALL CLEAR";
          const accent = activeCount > 0 ? "#F59E0B" : "#38BDF8";
          const image = svgDataUri("#0F172A", accent, "expr_clear", top, bottom, accent);
          this.sendToSD({
            event: "setImage",
            context: inst.context,
            payload: { image, target: 0 },
          });
          return;
        }

        const isActive = rawExpr ? Boolean(s.expressions[rawExpr]) : false;
        const top = customLabel || (rawExpr ? rawExpr.toUpperCase() : "EXPRESSION");
        const bottom = !rawExpr ? "SET NAME" : isActive ? "ACTIVE" : "OFF";
        const accent = isActive ? "#22C55E" : "#38BDF8";
        const bg = isActive ? "#052E16" : "#0F172A";
        const icon: IconKind = isActive ? "expr_on" : "expr_off";
        const image = svgDataUri(bg, accent, icon, top, bottom, accent);

        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 },
        });
        this.sendToSD({
          event: "setState",
          context: inst.context,
          payload: { state: isActive ? 1 : 0 },
        });
        break;
      }

      case ACTION_ACCESSORY: {
        const rawId = String(inst.settings.accessoryId ?? "").trim();
        const customLabel = String(inst.settings.label ?? "").trim();
        const match = this.findAccessory(rawId);
        const enabled = Boolean(match?.enabled);
        const displayName =
          customLabel ||
          (match?.name || rawId.replace(/\.svg$/i, "") || "ACCESSORY").toUpperCase();
        const bottom = !rawId ? "SET ITEM" : enabled ? "EQUIPPED" : "HIDDEN";
        const accent = enabled ? "#22C55E" : "#64748B";
        const bg = enabled ? "#052E16" : "#0F172A";
        const icon: IconKind = enabled ? "acc_on" : "acc_off";
        const image = svgDataUri(bg, accent, icon, displayName, bottom, enabled ? "#22C55E" : "#94A3B8");

        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 },
        });
        this.sendToSD({
          event: "setState",
          context: inst.context,
          payload: { state: enabled ? 1 : 0 },
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
          payload: { image, target: 0 },
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
          payload: { image, target: 0 },
        });
        break;
      }

      case ACTION_CALIBRATE: {
        const op = String(inst.settings.operation ?? "calibrate").toLowerCase();
        const isFlash = s.calibratedFlash;
        const top = op === "reset" ? "RESET POSE" : "CALIBRATE";
        const bottom = isFlash ? "✓ DONE!" : op === "reset" ? "DEFAULT" : "NEUTRAL";
        const accent = isFlash ? "#22C55E" : "#38BDF8";
        const bg = isFlash ? "#052E16" : "#0F172A";
        const image = svgDataUri(bg, accent, "calibrate", top, bottom, accent);
        this.sendToSD({
          event: "setImage",
          context: inst.context,
          payload: { image, target: 0 },
        });
        break;
      }
    }
  }
}

if (typeof process !== "undefined" && Array.isArray(process.argv) && process.argv.includes("-port")) {
  const plugin = new SVGTuberStreamDeckPlugin();
  plugin.startFromArgs(process.argv.slice(2));
}
