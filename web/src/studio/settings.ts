/**
 * Studio Settings State Management & API Persistence
 */

export interface TrackingConfig {
  mouthGain: number;
  mouthThreshold: number;
  enableSmile: boolean;
  smileThreshold: number;
  blinkThreshold: number;
  blinkThresholdL: number;
  blinkThresholdR: number;
  blinkSyncDelayMs: number;
  winkIsBlink: boolean;
  autoBlink: boolean;
  autoBlinkMode: string;
  autoBlinkIntervalSec: number;
  autoGaze: boolean;
  autoGazeMode: string;
  autoGazeRange: number;
  autoTilt: boolean;
  autoTiltMode: string;
  autoTiltAmount: number;
  physicsEnabled: boolean;
  physicsAmount: number;
  eyeGazeGain: number;
  yawMultiplier: number;
  pitchMultiplier: number;
  rollMultiplier: number;
  poseSmoothing: number;
}

export interface AudioConfig {
  mode: string;
  micGain: number;
  noiseGate: number;
  decaySmooth: number;
  bounceAmount: number;
}

export interface SettingsPayload {
  version: number;
  tracking: TrackingConfig;
  audio: AudioConfig;
}

export function createDefaultSettings(): SettingsPayload {
  return {
    version: 1,
    tracking: {
      mouthGain: 1.4,
      mouthThreshold: 0.08,
      enableSmile: true,
      smileThreshold: 0.5,
      blinkThreshold: 0.45,
      blinkThresholdL: 0.45,
      blinkThresholdR: 0.45,
      blinkSyncDelayMs: 50,
      winkIsBlink: false,
      autoBlink: true,
      autoBlinkMode: "always",
      autoBlinkIntervalSec: 4.0,
      autoGaze: true,
      autoGazeMode: "always",
      autoGazeRange: 1.0,
      autoTilt: true,
      autoTiltMode: "always",
      autoTiltAmount: 1.0,
      physicsEnabled: true,
      physicsAmount: 1.0,
      eyeGazeGain: 1.0,
      yawMultiplier: 1.0,
      pitchMultiplier: 1.0,
      rollMultiplier: 1.0,
      poseSmoothing: 1.0,
    },
    audio: {
      mode: "hybrid",
      micGain: 1.5,
      noiseGate: 0.04,
      decaySmooth: 0.1,
      bounceAmount: 1.0,
    },
  };
}

export function mergeSettings(
  base: SettingsPayload,
  partial?: Partial<SettingsPayload>
): SettingsPayload {
  if (!partial) return { ...base };
  return {
    version: partial.version || base.version,
    tracking: {
      ...base.tracking,
      ...(partial.tracking || {}),
    },
    audio: {
      ...base.audio,
      ...(partial.audio || {}),
    },
  };
}

export function createDebouncedSaver(
  saveFn: (payload: SettingsPayload) => Promise<void>,
  delayMs: number = 80
) {
  let timer: any = null;
  return (payload: SettingsPayload) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveFn(payload).catch((err) => {
        console.error("[Settings] Auto-save error:", err);
      });
    }, delayMs);
  };
}
