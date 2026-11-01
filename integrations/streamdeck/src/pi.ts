interface ActionInfo {
  action: string;
  context: string;
  payload: {
    settings?: Record<string, unknown>;
  };
}

interface GlobalSettings {
  host?: string;
  port?: number;
}

const DEFAULT_PORT = 7420;

class PropertyInspector {
  private ws: WebSocket | null = null;
  private uuid = "";
  private actionInfo: ActionInfo | null = null;
  private settings: Record<string, unknown> = {};
  private globalSettings: GlobalSettings = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
  };

  public connect(inPort: string, inUUID: string, inRegisterEvent: string, _inInfo: string, inActionInfo: string): void {
    this.uuid = inUUID;
    try {
      this.actionInfo = JSON.parse(inActionInfo) as ActionInfo;
      this.settings = this.actionInfo.payload?.settings ?? {};
    } catch {
      this.settings = {};
    }

    this.renderActionSections();
    this.populateFields();
    this.bindInputListeners();
    void this.fetchAutocompleteLists();

    this.ws = new WebSocket(`ws://127.0.0.1:${inPort}`);
    this.ws.onopen = () => {
      this.send({
        event: inRegisterEvent,
        uuid: this.uuid,
      });
      this.send({
        event: "getGlobalSettings",
        context: this.uuid,
      });
    };

    this.ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(String(evt.data)) as {
          event: string;
          payload?: { settings?: Record<string, unknown> };
        };
        if (msg.event === "didReceiveGlobalSettings") {
          this.globalSettings = {
            ...this.globalSettings,
            ...(msg.payload?.settings as GlobalSettings),
          };
          this.populateGlobalFields();
          void this.fetchAutocompleteLists();
        } else if (msg.event === "didReceiveSettings") {
          this.settings = msg.payload?.settings ?? {};
          this.populateFields();
        }
      } catch {
        // ignore
      }
    };
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private renderActionSections(): void {
    const action = this.actionInfo?.action ?? "";
    const sections = document.querySelectorAll<HTMLElement>("[data-action]");
    sections.forEach((sec) => {
      sec.style.display = sec.dataset.action === action ? "block" : "none";
    });
  }

  private populateGlobalFields(): void {
    const hostEl = document.getElementById("st-host") as HTMLInputElement | null;
    const portEl = document.getElementById("st-port") as HTMLInputElement | null;
    if (hostEl) hostEl.value = this.globalSettings.host ?? "127.0.0.1";
    if (portEl) portEl.value = String(this.globalSettings.port ?? DEFAULT_PORT);
  }

  private populateFields(): void {
    const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]");
    inputs.forEach((el) => {
      const key = el.dataset.setting;
      if (key && this.settings[key] !== undefined && document.activeElement !== el) {
        el.value = String(this.settings[key]);
      }
    });
  }

  private async fetchAutocompleteLists(): Promise<void> {
    const host = this.globalSettings.host || "127.0.0.1";
    const port = this.globalSettings.port || DEFAULT_PORT;
    try {
      const resp = await fetch(`http://${host}:${port}/api/state`);
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        availableExpressions?: string[];
        accessories?: Array<{ id: string; file: string }>;
        avatars?: string[];
      };
      this.fillDatalist("expr-list", data.availableExpressions ?? []);
      this.fillDatalist(
        "acc-list",
        (data.accessories ?? []).map((a) => a.id || a.file),
      );
      this.fillDatalist("avatar-list", data.avatars ?? []);
    } catch {
      // SVGTuber server may not be running yet
    }
  }

  private fillDatalist(id: string, values: string[]): void {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = "";
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      dl.appendChild(opt);
    }
  }

  private bindInputListeners(): void {
    const form = document.getElementById("sd-pi-form");
    form?.addEventListener("submit", (e) => e.preventDefault());

    const inputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]");
    inputs.forEach((el) => {
      const persist = () => {
        const key = el.dataset.setting;
        if (!key) return;
        this.settings[key] = el.type === "number" ? Number(el.value) : el.value;
        this.send({
          event: "setSettings",
          context: this.uuid,
          payload: this.settings,
        });
      };
      el.addEventListener("input", persist);
      el.addEventListener("change", persist);
    });

    const saveGlobal = () => {
      const hostEl = document.getElementById("st-host") as HTMLInputElement | null;
      const portEl = document.getElementById("st-port") as HTMLInputElement | null;
      const parsedPort = Number(portEl?.value || DEFAULT_PORT);
      this.globalSettings = {
        host: hostEl?.value || "127.0.0.1",
        port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
      };
      this.send({
        event: "setGlobalSettings",
        context: this.uuid,
        payload: this.globalSettings,
      });
      void this.fetchAutocompleteLists();
    };

    ["st-host", "st-port"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", saveGlobal);
      el?.addEventListener("change", saveGlobal);
    });
  }
}

const pi = new PropertyInspector();
(window as unknown as Record<string, unknown>).connectElgatoStreamDeckSocket = (
  inPort: string,
  inUUID: string,
  inRegisterEvent: string,
  inInfo: string,
  inActionInfo: string,
) => {
  pi.connect(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo);
};
