"use strict";
(() => {
  // integrations/streamdeck/src/pi.ts
  var DEFAULT_PORT = 7420;
  var PropertyInspector = class {
    ws = null;
    uuid = "";
    actionInfo = null;
    settings = {};
    globalSettings = {
      host: "127.0.0.1",
      port: DEFAULT_PORT
    };
    connect(inPort, inUUID, inRegisterEvent, _inInfo, inActionInfo) {
      this.uuid = inUUID;
      try {
        this.actionInfo = JSON.parse(inActionInfo);
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
          uuid: this.uuid
        });
        this.send({
          event: "getGlobalSettings",
          context: this.uuid
        });
      };
      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg.event === "didReceiveGlobalSettings") {
            this.globalSettings = {
              ...this.globalSettings,
              ...msg.payload?.settings
            };
            this.populateGlobalFields();
            void this.fetchAutocompleteLists();
          } else if (msg.event === "didReceiveSettings") {
            this.settings = msg.payload?.settings ?? {};
            this.populateFields();
          }
        } catch {
        }
      };
    }
    send(msg) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
    renderActionSections() {
      const action = this.actionInfo?.action ?? "";
      const sections = document.querySelectorAll("[data-action]");
      sections.forEach((sec) => {
        sec.style.display = sec.dataset.action === action ? "block" : "none";
      });
    }
    populateGlobalFields() {
      const hostEl = document.getElementById("st-host");
      const portEl = document.getElementById("st-port");
      if (hostEl) hostEl.value = this.globalSettings.host ?? "127.0.0.1";
      if (portEl) portEl.value = String(this.globalSettings.port ?? DEFAULT_PORT);
    }
    populateFields() {
      const inputs = document.querySelectorAll("[data-setting]");
      inputs.forEach((el) => {
        const key = el.dataset.setting;
        if (key && this.settings[key] !== void 0 && document.activeElement !== el) {
          el.value = String(this.settings[key]);
        }
      });
    }
    async fetchAutocompleteLists() {
      const host = this.globalSettings.host || "127.0.0.1";
      const port = this.globalSettings.port || DEFAULT_PORT;
      try {
        const resp = await fetch(`http://${host}:${port}/api/state`);
        if (!resp.ok) return;
        const data = await resp.json();
        this.fillDatalist("expr-list", data.availableExpressions ?? []);
        this.fillDatalist(
          "acc-list",
          (data.accessories ?? []).map((a) => a.id || a.file)
        );
        this.fillDatalist("avatar-list", data.avatars ?? []);
      } catch {
      }
    }
    fillDatalist(id, values) {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.innerHTML = "";
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v;
        dl.appendChild(opt);
      }
    }
    bindInputListeners() {
      const form = document.getElementById("sd-pi-form");
      form?.addEventListener("submit", (e) => e.preventDefault());
      const inputs = document.querySelectorAll("[data-setting]");
      inputs.forEach((el) => {
        const persist = () => {
          const key = el.dataset.setting;
          if (!key) return;
          this.settings[key] = el.type === "number" ? Number(el.value) : el.value;
          this.send({
            event: "setSettings",
            context: this.uuid,
            payload: this.settings
          });
        };
        el.addEventListener("input", persist);
        el.addEventListener("change", persist);
      });
      const saveGlobal = () => {
        const hostEl = document.getElementById("st-host");
        const portEl = document.getElementById("st-port");
        const parsedPort = Number(portEl?.value || DEFAULT_PORT);
        this.globalSettings = {
          host: hostEl?.value || "127.0.0.1",
          port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT
        };
        this.send({
          event: "setGlobalSettings",
          context: this.uuid,
          payload: this.globalSettings
        });
        void this.fetchAutocompleteLists();
      };
      ["st-host", "st-port"].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener("input", saveGlobal);
        el?.addEventListener("change", saveGlobal);
      });
    }
  };
  var pi = new PropertyInspector();
  window.connectElgatoStreamDeckSocket = (inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) => {
    pi.connect(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo);
  };
})();
