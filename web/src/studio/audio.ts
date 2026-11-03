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

export interface OpticalVisemeHints {
  mouthOpen?: number;
  mouthPucker?: number;
  smile?: number;
}

export interface AudioSpectrumAnalysis {
  pitch: number;
  pitchHz: number;
  f1Hz: number;
  f2Hz: number;
  viseme: "sil" | "A" | "I" | "U" | "E" | "O";
  visemeA: number;
  visemeI: number;
  visemeU: number;
  visemeE: number;
  visemeO: number;
}

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

/**
 * Analyzes Web Audio API FFT frequency bins (from AnalyserNode.getByteFrequencyData)
 * to extract 5-vowel viseme weights (A, I, U, E, O), F1/F2 formant centroids, and fundamental voice pitch.
 * In Hybrid mode, optional optical mouth cues (mouthOpen, mouthPucker, smile) and calibrated
 * per-user vowel formants refine classification.
 */
export function analyzeAudioSpectrum(
  freqBins: Uint8Array | Float32Array | number[],
  sampleRate: number = 48000,
  isSpeaking: boolean = true,
  neutralPitchHz: number = 165,
  opticalHints?: OpticalVisemeHints,
  vowelFormants?: Record<string, number[]>
): AudioSpectrumAnalysis {
  if (!isSpeaking || !freqBins || freqBins.length === 0) {
    return {
      pitch: 0,
      pitchHz: 0,
      f1Hz: 0,
      f2Hz: 0,
      viseme: "sil",
      visemeA: 0,
      visemeI: 0,
      visemeU: 0,
      visemeE: 0,
      visemeO: 0,
    };
  }

  const numBins = freqBins.length;
  const fftSize = numBins * 2;
  const binHz = (sampleRate > 0 ? sampleRate : 48000) / fftSize;

  const getNormBin = (idx: number): number => {
    const v = freqBins[idx] || 0;
    return v > 1.0 ? clamp01(v / 255.0) : clamp01(v);
  };

  const bandAvg = (minHz: number, maxHz: number): number => {
    const startIdx = Math.max(1, Math.floor(minHz / binHz));
    const endIdx = Math.min(numBins - 1, Math.ceil(maxHz / binHz));
    if (endIdx < startIdx) return 0;
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      sum += getNormBin(i);
      count++;
    }
    return count > 0 ? sum / count : 0;
  };

  const bandCentroid = (minHz: number, maxHz: number): number => {
    const startIdx = Math.max(1, Math.floor(minHz / binHz));
    const endIdx = Math.min(numBins - 1, Math.ceil(maxHz / binHz));
    let wFreq = 0;
    let wSum = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      const mag = getNormBin(i);
      if (mag > 0.04) {
        const w = mag * mag;
        wFreq += i * binHz * w;
        wSum += w;
      }
    }
    return wSum > 0 ? Number((wFreq / wSum).toFixed(1)) : 0;
  };

  // Fundamental voice pitch estimation in [85 .. 420 Hz] and F1/F2 formant centroids
  const pitchHz = bandCentroid(85, 420);
  const f1Hz = bandCentroid(220, 1100);
  const f2Hz = bandCentroid(850, 3400);
  const basePitch = neutralPitchHz >= 75 && neutralPitchHz <= 400 ? neutralPitchHz : 165;
  const pitch =
    pitchHz > 0
      ? Number(clamp01(0.5 + (pitchHz - basePitch) / 160.0).toFixed(3))
      : 0;

  // Formant frequency bands for 5-vowel classification (A, I, U, E, O)
  const lowBand = bandAvg(90, 380); // Voice bar & close-vowel F1 (/u/, /i/)
  const f1Mid = bandAvg(380, 680); // Mid F1 (/e/, /o/)
  const f1High = bandAvg(680, 1100); // Open F1 (/a/)
  const f2Low = bandAvg(850, 1450); // Back-central F2 (/o/, /a/)
  const f2Mid = bandAvg(1450, 2150); // Front-mid F2 (/e/)
  const f2High = bandAvg(2150, 3500); // High-front F2 (/i/)

  let rawA = f1High * 1.2 + f2Low * 0.55;
  let rawI = f2High * 1.55 + lowBand * 0.4;
  let rawU = lowBand * 1.35 * Math.max(0.15, 1.0 - f2High * 1.3 - f1High * 0.9);
  let rawE = f1Mid * 0.75 + f2Mid * 1.25;
  let rawO = (f1Mid * 1.0 + f2Low * 0.85) * Math.max(0.2, 1.0 - f2High * 1.2 - f2Mid * 0.5);

  // Personalized Step 4B vowel formant matching when user calibrated "AH / EE / OO / EH / OH"
  if (vowelFormants && f1Hz > 0 && f2Hz > 0) {
    const formantBoost = (key: string): number => {
      const pair = vowelFormants[key];
      if (!pair || pair.length < 2 || pair[0] <= 0 || pair[1] <= 0) return 0;
      const df1 = (f1Hz - pair[0]) / 260.0;
      const df2 = (f2Hz - pair[1]) / 550.0;
      return Math.exp(-(df1 * df1 + df2 * df2)) * 0.45;
    };
    rawA += formantBoost("A");
    rawI += formantBoost("I");
    rawU += formantBoost("U");
    rawE += formantBoost("E");
    rawO += formantBoost("O");
  }

  // Hybrid optical mouth synergy when camera blendshapes are available
  if (opticalHints) {
    const mOpen = clamp01(opticalHints.mouthOpen ?? 0);
    const mPucker = clamp01(opticalHints.mouthPucker ?? 0);
    const mSmile = clamp01(opticalHints.smile ?? 0);

    if (mPucker >= 0.22) {
      rawU += mPucker * 0.45 * (1.0 - mOpen * 0.5);
      rawO += mPucker * 0.4 * (0.4 + mOpen * 0.6);
      rawI *= Math.max(0.25, 1.0 - mPucker * 0.8);
      rawE *= Math.max(0.35, 1.0 - mPucker * 0.6);
    }
    if (mSmile >= 0.22) {
      rawI += mSmile * 0.4 * (1.0 - mOpen * 0.4);
      rawE += mSmile * 0.35 * (0.3 + mOpen * 0.7);
      rawU *= Math.max(0.3, 1.0 - mSmile * 0.7);
    }
    if (mOpen >= 0.45) {
      rawA += (mOpen - 0.35) * 0.45;
      rawO += (mOpen - 0.35) * 0.25 * (0.5 + mPucker);
      rawU *= Math.max(0.3, 1.0 - (mOpen - 0.4) * 0.8);
    }
  }

  const maxRaw = Math.max(rawA, rawI, rawU, rawE, rawO);
  if (maxRaw < 0.02) {
    return {
      pitch,
      pitchHz,
      f1Hz,
      f2Hz,
      viseme: "sil",
      visemeA: 0,
      visemeI: 0,
      visemeU: 0,
      visemeE: 0,
      visemeO: 0,
    };
  }

  const normScale = Math.min(1.0, Math.max(0.65, maxRaw * 1.6)) / maxRaw;
  const visemeA = Number(clamp01(rawA * normScale).toFixed(3));
  const visemeI = Number(clamp01(rawI * normScale).toFixed(3));
  const visemeU = Number(clamp01(rawU * normScale).toFixed(3));
  const visemeE = Number(clamp01(rawE * normScale).toFixed(3));
  const visemeO = Number(clamp01(rawO * normScale).toFixed(3));

  let viseme: "A" | "I" | "U" | "E" | "O" = "A";
  let best = visemeA;
  if (visemeI > best) {
    best = visemeI;
    viseme = "I";
  }
  if (visemeU > best) {
    best = visemeU;
    viseme = "U";
  }
  if (visemeE > best) {
    best = visemeE;
    viseme = "E";
  }
  if (visemeO > best) {
    viseme = "O";
  }

  return {
    pitch,
    pitchHz,
    f1Hz,
    f2Hz,
    viseme,
    visemeA,
    visemeI,
    visemeU,
    visemeE,
    visemeO,
  };
}

/**
 * Detects high-energy shouting (isShouting) and rhythmic staccato laughter bursts (isLaughing)
 * from recent RMS volume history and optional optical smile intensity.
 */
export function detectShoutAndLaugh(
  volume: number,
  micGain: number = 1.5,
  noiseGate: number = 0.04,
  rmsHistory: number[] = [],
  smile: number = 0
): { isShouting: boolean; isLaughing: boolean } {
  const amplified = volume * micGain;
  const isSpeaking = amplified >= noiseGate;
  const isShouting = Boolean(isSpeaking && amplified >= 0.82);

  let isLaughing = false;
  if (rmsHistory && rmsHistory.length >= 6) {
    const gateRaw = noiseGate / Math.max(0.1, micGain);
    let peaks = 0;
    let valleys = 0;
    for (let i = 1; i < rmsHistory.length - 1; i++) {
      const prev = rmsHistory[i - 1];
      const cur = rmsHistory[i];
      const next = rmsHistory[i + 1];
      if (cur > gateRaw * 1.4 && cur >= prev + 0.012 && cur >= next + 0.012) {
        peaks++;
      } else if (cur < prev - 0.01 && cur <= next - 0.01) {
        valleys++;
      }
    }
    // Pure audio staccato laugh ("ha-ha-ha": 3+ rhythmic peaks with dips between them)
    // OR smile-assisted chuckle (2+ rhythmic voice bursts while visibly smiling)
    if ((peaks >= 3 && valleys >= 2) || (smile >= 0.38 && isSpeaking && peaks >= 2 && valleys >= 1)) {
      isLaughing = true;
    }
  }

  return { isShouting, isLaughing };
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioDataArray: Float32Array | null = null;
  private freqDataArray: Uint8Array | null = null;
  private rmsHistory: number[] = [];
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
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.25;
      this.micSource.connect(this.analyserNode);
      this.audioDataArray = new Float32Array(this.analyserNode.fftSize);
      this.freqDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.rmsHistory = [];

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
    this.freqDataArray = null;
    this.rmsHistory = [];
    this.smoothedAudioVol = 0;
  }

  sample(
    micGain = 1.5,
    noiseGate = 0.04,
    decay = 0.1,
    neutralPitchHz = 165,
    opticalHints?: OpticalVisemeHints
  ): AudioState | null {
    if (!this.micRunning || !this.analyserNode || !this.audioDataArray) {
      return null;
    }
    this.analyserNode.getFloatTimeDomainData(this.audioDataArray as any);
    const rms = calculateRMS(this.audioDataArray);
    this.smoothedAudioVol = stepAudioVolume(this.smoothedAudioVol, rms, decay);
    const isSpeaking = evaluateSpeechGate(this.smoothedAudioVol, micGain, noiseGate);

    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > 24) {
      this.rmsHistory.shift();
    }

    let spec: AudioSpectrumAnalysis = {
      pitch: 0,
      pitchHz: 0,
      f1Hz: 0,
      f2Hz: 0,
      viseme: "sil",
      visemeA: 0,
      visemeI: 0,
      visemeU: 0,
      visemeE: 0,
      visemeO: 0,
    };
    if (isSpeaking && this.freqDataArray) {
      this.analyserNode.getByteFrequencyData(this.freqDataArray as any);
      spec = analyzeAudioSpectrum(
        this.freqDataArray,
        this.audioContext?.sampleRate || 48000,
        isSpeaking,
        neutralPitchHz,
        opticalHints
      );
    }

    const { isShouting, isLaughing } = detectShoutAndLaugh(
      this.smoothedAudioVol,
      micGain,
      noiseGate,
      this.rmsHistory,
      opticalHints?.smile || 0
    );

    return {
      active: true,
      volume: this.smoothedAudioVol,
      isSpeaking,
      pitch: spec.pitch,
      pitchHz: spec.pitchHz,
      viseme: spec.viseme,
      visemeA: spec.visemeA,
      visemeI: spec.visemeI,
      visemeU: spec.visemeU,
      visemeE: spec.visemeE,
      visemeO: spec.visemeO,
      isShouting,
      isLaughing,
    };
  }
}
