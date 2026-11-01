import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as http from "node:http";
import type * as net from "node:net";

/**
 * Lightweight RFC 6455 WebSocket client built on Node's standard `node:http` and `node:crypto` modules.
 * Compatible with Node 20+ (Elgato Stream Deck runtime) with zero external dependencies.
 */
export class NodeWebSocketClient extends EventEmitter {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readyState: number = NodeWebSocketClient.CONNECTING;
  private req: http.ClientRequest | null = null;
  private socket: net.Socket | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];

  constructor(urlStr: string) {
    super();
    this.connect(urlStr);
  }

  private connect(urlStr: string): void {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      queueMicrotask(() => this.emit("error", err));
      return;
    }

    const key = crypto.randomBytes(16).toString("base64");
    const port = parsed.port ? parseInt(parsed.port, 10) : 80;
    const path = (parsed.pathname || "/") + (parsed.search || "");

    const req = http.request({
      hostname: parsed.hostname || "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: `http://${parsed.hostname || "127.0.0.1"}:${port}`,
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
      },
    });
    this.req = req;

    req.on("upgrade", (_res, socket, head) => {
      this.socket = socket;
      this.readyState = NodeWebSocketClient.OPEN;
      socket.setNoDelay(true);

      if (head && head.length > 0) {
        this.rxBuffer = Buffer.concat([this.rxBuffer, head]);
      }

      socket.on("data", (chunk: Buffer) => {
        this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
        this.consumeFrames();
      });

      socket.on("close", () => {
        const wasOpen = this.readyState !== NodeWebSocketClient.CLOSED;
        this.readyState = NodeWebSocketClient.CLOSED;
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
      this.readyState = NodeWebSocketClient.CLOSED;
      this.emit("error", new Error(`Unexpected HTTP status ${res.statusCode}`));
      this.emit("close");
    });

    req.on("error", (err) => {
      this.readyState = NodeWebSocketClient.CLOSED;
      this.emit("error", err);
      this.emit("close");
    });

    req.end();
  }

  public send(data: string | Uint8Array): void {
    if (this.readyState !== NodeWebSocketClient.OPEN || !this.socket) {
      return;
    }
    const isText = typeof data === "string";
    const payload = isText ? Buffer.from(data, "utf8") : Buffer.from(data);
    this.writeMaskedFrame(isText ? 0x1 : 0x2, payload);
  }

  public close(): void {
    if (this.readyState === NodeWebSocketClient.CLOSED) {
      return;
    }
    this.readyState = NodeWebSocketClient.CLOSED;
    try {
      this.req?.destroy();
    } catch {
      // ignore
    }
    if (this.socket) {
      try {
        this.writeMaskedFrame(0x8, Buffer.alloc(0));
        this.socket.end();
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.emit("close");
  }

  private writeMaskedFrame(opcode: number, payload: Buffer): void {
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
    frame[0] = 0x80 | (opcode & 0x0f);

    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len <= 65535) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(len, 2);
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
    }

    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payload[i]! ^ mask[i & 3]!;
    }

    this.socket.write(frame);
  }

  private consumeFrames(): void {
    while (this.rxBuffer.length >= 2) {
      const b0 = this.rxBuffer[0]!;
      const b1 = this.rxBuffer[1]!;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
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
          unmasked[i] = payload[i]! ^ mask[i & 3]!;
        }
        payload = unmasked;
      }

      this.rxBuffer = this.rxBuffer.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        this.writeMaskedFrame(0x0a, payload);
      } else if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
        this.fragments.push(Buffer.from(payload));
        if (fin) {
          const full = Buffer.concat(this.fragments);
          this.fragments = [];
          this.emit("message", full.toString("utf8"));
        }
      }
    }
  }
}
