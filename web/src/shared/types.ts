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
  cheekPuff?: number;
  mouthPucker?: number;
  tongueOut?: number;
  frown?: number;
  jawX?: number;
  noseSneer?: number;
  eyeSquintL?: number;
  eyeSquintR?: number;
  eyeSquint?: number;
  mouthThreshold?: number;
  blinkThreshold?: number;
  blinkThresholdL?: number;
  blinkThresholdR?: number;
  blinkSyncDelayMs?: number;
  winkIsBlink?: boolean;
  stabilizeBlink?: boolean;
  blinkMaxHeadYaw?: number;
  smileThreshold?: number;
  audioVolume?: number;
  audioPitch?: number;
  viseme?: string;
  visemeA?: number;
  visemeI?: number;
  visemeU?: number;
  visemeE?: number;
  visemeO?: number;
  bounceAmount?: number;
  physicsEnabled?: boolean;
  physicsAmount?: number;
  depthZoomAmount?: number;
  perspectiveSkewEnabled?: boolean;
  perspectiveSkewAmount?: number;
  isSpeaking?: boolean;
  isShouting?: boolean;
  isLaughing?: boolean;
  isBlinkL?: boolean;
  isBlinkR?: boolean;
  autoBlink?: boolean;
  isMouthOpen?: boolean;
  isSmiling?: boolean;
  isCheekPuff?: boolean;
  isMouthPucker?: boolean;
  isTongueOut?: boolean;
  isFrowning?: boolean;
  isSneering?: boolean;
  expressions?: Record<string, boolean>;
  raw?: Record<string, number>;
}

export interface AudioState {
  volume: number;
  isSpeaking: boolean;
  active: boolean;
  pitch?: number;
  pitchHz?: number;
  f1Hz?: number;
  f2Hz?: number;
  viseme?: string;
  visemeA?: number;
  visemeI?: number;
  visemeU?: number;
  visemeE?: number;
  visemeO?: number;
  isShouting?: boolean;
  isLaughing?: boolean;
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

export interface CalibrationProfile {
  calibrated: boolean;
  neutralYaw: number;
  neutralPitch: number;
  neutralRoll: number;
  neutralX: number;
  neutralY: number;
  neutralZ: number;
  neutralEyeX: number;
  neutralEyeY: number;
  neutralSmile: number;
  neutralMouth: number;
  neutralBrowL: number;
  neutralBrowR: number;
  neutralPucker?: number;
  neutralFrown?: number;
  neutralCheekPuff?: number;
  neutralNoseSneer?: number;
  neutralJawX?: number;
  neutralSquintL?: number;
  neutralSquintR?: number;
  neutralPitchHz?: number;
  vowelFormants?: Record<string, number[]>;
  blinkOpenL: number;
  blinkOpenR: number;
  blinkClosedL: number;
  blinkClosedR: number;
  glareAssist: boolean;
  smileWeightL: number;
  smileWeightR: number;
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
  stabilizeBlink?: boolean;
  blinkMaxHeadYaw?: number;
  enableSmile: boolean;
  smileThreshold: number;
  yawMultiplier: number;
  pitchMultiplier: number;
  rollMultiplier: number;
  poseSmoothing: number;
  eyeGazeGain: number;
  gazeDeadzone?: number;
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
  depthZoomAmount?: number;
  perspectiveSkewEnabled?: boolean;
  perspectiveSkewAmount?: number;
  calibration?: CalibrationProfile;
}
