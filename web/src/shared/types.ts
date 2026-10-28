/**
 * Shared Type Definitions for SVGTuber (Overlay & Studio Tracker)
 */

export interface ParamFrame {
  type: string;
  t: number;
  present: boolean;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  headX: number;
  headY: number;
  headZ: number;
  eyeX: number;
  eyeY: number;
  blinkL: number;
  blinkR: number;
  mouthOpen: number;
  smile: number;
  browUp: number;
  browL?: number;
  browR?: number;
  mouthThreshold?: number;
  blinkThreshold?: number;
  blinkThresholdL?: number;
  blinkThresholdR?: number;
  blinkSyncDelayMs?: number;
  winkIsBlink?: boolean;
  smileThreshold?: number;
  audioVolume?: number;
  bounceAmount?: number;
  physicsEnabled?: boolean;
  physicsAmount?: number;
  isSpeaking?: boolean;
  isBlinkL?: boolean;
  isBlinkR?: boolean;
  autoBlink?: boolean;
  isMouthOpen?: boolean;
  isSmiling?: boolean;
  expressions?: Record<string, boolean>;
  raw?: Record<string, number>;
}

export interface AudioState {
  volume: number;
  isSpeaking: boolean;
  active: boolean;
}

export interface FaceFrame {
  timestamp: number;
  present: boolean;
  yaw?: number;
  pitch?: number;
  roll?: number;
  x?: number;
  y?: number;
  z?: number;
  blendshapes?: Record<string, number>;
  audio?: AudioState;
}

export interface AccessoryConfig {
  id: string;
  file: string;
  name: string;
  target: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  order: "front" | "back";
  enabled: boolean;
  expression: string;
}

export interface RigDirective {
  type: string;
  params: Record<string, any>;
}

export interface RigElement {
  id: string;
  inkscapeLabel: string;
  directives: RigDirective[];
  originalTransform?: string;
  initialBBox?: DOMRect;
}

export interface RigDefinition {
  elements: RigElement[];
  expressions: string[];
}

export interface TrackingSettings {
  mode: "camera" | "audio" | "hybrid";
  mouthGain: number;
  mouthThreshold: number;
  blinkThreshold: number;
  blinkThresholdL: number;
  blinkThresholdR: number;
  blinkSyncDelayMs: number;
  winkIsBlink: boolean;
  enableSmile: boolean;
  smileThreshold: number;
  yawMultiplier: number;
  pitchMultiplier: number;
  rollMultiplier: number;
  poseSmoothing: number;
  eyeGazeGain: number;
  browGain?: number;
  autoBlink: boolean;
  autoBlinkMode: string;
  autoBlinkIntervalSec: number;
  autoGaze: boolean;
  autoGazeMode: string;
  autoGazeRange: number;
  autoTilt: boolean;
  autoTiltMode: string;
  autoTiltAmount: number;
}
