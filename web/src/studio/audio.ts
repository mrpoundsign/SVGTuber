/**
 * Studio Audio Management & Analysis (Web Audio API)
 */

import type { AudioState } from "../shared/types.ts";

export function calculateRMS(data: Float32Array | number[]): number {
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

export function stepAudioVolume(
  currentSmoothed: number,
  rms: number,
  decay: number = 0.1
): number {
  if (rms > currentSmoothed) {
    return rms; // instant attack
  }
  return currentSmoothed * (1 - decay) + rms * decay; // smooth release
}

export function evaluateSpeechGate(
  volume: number,
  micGain: number = 1.5,
  noiseGate: number = 0.04
): boolean {
  return volume * micGain >= noiseGate;
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioDataArray: Float32Array | null = null;
  private micRunning = false;
  private smoothedAudioVol = 0;

  get isRunning(): boolean {
    return this.micRunning;
  }

  getOrCreateAudioContext(): AudioContext | null {
    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.value = 0.0;
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.start();
      }
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }
    } catch (e) {
      console.warn("[AudioManager] Web Audio keep-alive error:", e);
    }
    return this.audioContext;
  }

  async startMic(deviceId?: string): Promise<boolean> {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) return false;

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
      } catch (e) {
        if (deviceId) {
          console.warn("[AudioManager] Exact mic failed, falling back to default:", e);
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw e;
        }
      }

      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.2;
      this.micSource.connect(this.analyserNode);
      this.audioDataArray = new Float32Array(this.analyserNode.fftSize);

      this.micRunning = true;
      localStorage.setItem("svgtuber_mic_active", "true");
      return true;
    } catch (err) {
      console.error("[AudioManager] Microphone access error:", err);
      return false;
    }
  }

  stopMic() {
    this.micRunning = false;
    localStorage.setItem("svgtuber_mic_active", "false");
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch (e) {}
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.analyserNode = null;
    this.audioDataArray = null;
    this.smoothedAudioVol = 0;
  }

  sample(micGain = 1.5, noiseGate = 0.04, decay = 0.1): AudioState | null {
    if (!this.micRunning || !this.analyserNode || !this.audioDataArray) {
      return null;
    }
    this.analyserNode.getFloatTimeDomainData(this.audioDataArray as any);
    const rms = calculateRMS(this.audioDataArray);
    this.smoothedAudioVol = stepAudioVolume(this.smoothedAudioVol, rms, decay);
    const isSpeaking = evaluateSpeechGate(this.smoothedAudioVol, micGain, noiseGate);

    return {
      active: true,
      volume: this.smoothedAudioVol,
      isSpeaking,
    };
  }
}
