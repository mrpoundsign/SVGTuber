/**
 * Guided Fullscreen Pop-Out Calibration Wizard & Glasses/Setup Analyzer
 */

import type { CalibrationProfile } from "../shared/types.ts";

export interface CalibrationSample {
  timestamp: number;
  present: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
  blendshapes: Record<string, number>;
  audioVolume: number;
}

export interface NeutralStepResult {
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
  neutralPucker: number;
  neutralFrown: number;
  neutralCheekPuff: number;
  neutralNoseSneer: number;
  neutralJawX: number;
  neutralSquintL: number;
  neutralSquintR: number;
  blinkOpenL: number;
  blinkOpenR: number;
  noiseGate: number;
}

export interface BlinkStepResult {
  blinkClosedL: number;
  blinkClosedR: number;
  glareAssist: boolean;
  blinkThresholdL: number;
  blinkThresholdR: number;
}

export interface HeadTurnStepResult {
  blinkMaxHeadYaw: number;
  yawMultiplier: number;
  pitchMultiplier: number;
  earlyOcclusionDetected: boolean;
}

export interface VoiceSmileStepResult {
  smileWeightL: number;
  smileWeightR: number;
  smileThreshold: number;
  mouthGain: number;
  micGain: number;
  smileBlinkIntrusionL?: number;
  smileBlinkIntrusionR?: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function percentile(values: number[], p: number): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/**
 * Combines MediaPipe ARKit blendshape closure with geometric 3D landmark EAR closure,
 * plus optional eyeSquint/cheekSquint and eyeWide disambiguation:
 * - Suppresses false smile-induced blinks when smiling pushes cheeks into glasses rims
 * - Rescues solo winks behind glasses glare when non-smile orbicularis oculi squint is active
 * - Dampens sympathetic blink bleed on the opposite eye when eyeWide is active
 */
export function fuseBlinkScoreClient(
  blendshapeBlink: number,
  earBlink?: number,
  eyeSquintOrCheek = 0,
  smile = 0,
  eyeWide = 0
): number {
  let b = clamp(blendshapeBlink || 0, 0, 1);
  if (earBlink === undefined || earBlink === null || isNaN(earBlink)) {
    if (smile >= 0.4 && eyeSquintOrCheek >= 0.3 && b < 0.72) {
      b = Math.max(0, b - Math.min(0.14, (smile - 0.35) * eyeSquintOrCheek * 0.35));
    } else if (smile < 0.18 && eyeSquintOrCheek >= 0.35 && b >= 0.22) {
      b = Math.min(1, b + eyeSquintOrCheek * 0.14);
    }
    if (eyeWide >= 0.2 && b < 0.55) {
      b = Math.max(0, b - eyeWide * 0.22);
    }
    return clamp(b, 0, 1);
  }
  const e = clamp(earBlink, 0, 1);
  if (smile >= 0.35 && eyeSquintOrCheek >= 0.25 && e < b - 0.08) {
    return clamp(e * 0.75 + b * 0.25, 0, 1);
  }
  let blended = b * 0.65 + e * 0.35;
  if (e > b + 0.12) {
    blended = Math.max(blended, e * 0.9);
  }
  if (smile < 0.18 && eyeSquintOrCheek >= 0.35 && blended >= 0.22) {
    blended = Math.min(1, blended + eyeSquintOrCheek * 0.12);
  }
  if (eyeWide >= 0.2 && blended < 0.55) {
    blended = Math.max(0, blended - eyeWide * 0.22);
  }
  return clamp(blended, 0, 1);
}

/**
 * Normalizes a raw/fused blink value using the calibrated [openFloor .. closedCeiling] range.
 */
export function remapBlinkClient(
  raw: number,
  openFloor: number = 0,
  closedCeiling: number = 1
): number {
  const r = clamp(raw || 0, 0, 1);
  if (openFloor <= 0 && (closedCeiling <= 0 || closedCeiling >= 0.999)) {
    return r;
  }
  const ceil = closedCeiling <= 0 ? 1.0 : closedCeiling;
  const span = Math.max(0.08, ceil - openFloor);
  return clamp((r - openFloor) / span, 0, 1);
}

function extractRawGazeSample(bs: Record<string, number>): { x: number; y: number } {
  const lookRight = ((bs.eyeLookInLeft || 0) + (bs.eyeLookOutRight || 0)) / 2;
  const lookLeft = ((bs.eyeLookOutLeft || 0) + (bs.eyeLookInRight || 0)) / 2;
  const lookUp = ((bs.eyeLookUpLeft || 0) + (bs.eyeLookUpRight || 0)) / 2;
  const lookDown = ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0)) / 2;
  return {
    x: lookLeft - lookRight,
    y: lookDown - lookUp,
  };
}

function extractRawBrowsSample(bs: Record<string, number>): { l: number; r: number } {
  const inner = bs.browInnerUp || 0;
  const upL = Math.max(bs.browOuterUpLeft || 0, inner);
  const upR = Math.max(bs.browOuterUpRight || 0, inner);
  return {
    l: upL - (bs.browDownLeft || 0),
    r: upR - (bs.browDownRight || 0),
  };
}

export function extractRawFrownClient(
  bs: Record<string, number>,
  wL = 0.5,
  wR = 0.5
): number {
  const rawSmile = (bs.mouthSmileLeft || 0) * wL + (bs.mouthSmileRight || 0) * wR;
  const rawPucker = Math.max(bs.mouthPucker || 0, (bs.mouthFunnel || 0) * 0.75);
  const bsFrown = (bs.mouthFrownLeft || 0) * wL + (bs.mouthFrownRight || 0) * wR;
  const geoFrown = (bs.geoFrownLeft || 0) * wL + (bs.geoFrownRight || 0) * wR;
  const nonSmileGate =
    Math.max(0, 1 - rawSmile * 2.5) *
    Math.max(0, 1 - rawPucker * 1.8) *
    Math.max(0, 1 - (bs.jawOpen || 0) * 2.2);
  const shrugPout = ((bs.mouthShrugLower || 0) * 0.65 + (bs.mouthRollLower || 0) * 0.35) * nonSmileGate;
  return clamp(Math.max(bsFrown, Math.max(geoFrown * 0.85, shrugPout)), 0, 1);
}

/**
 * Step 1 Analyzer: Neutral Posture, Resting Open Eyes Behind Glasses & Ambient Mic Silence
 */
export function analyzeNeutralStep(samples: CalibrationSample[]): NeutralStepResult {
  const faceSamples = samples.filter((s) => s.present);
  const audioVolumes = samples.map((s) => s.audioVolume || 0).filter((v) => v >= 0);

  const p95Noise = audioVolumes.length > 0 ? percentile(audioVolumes, 0.95) : 0.025;
  const noiseGate = Number(clamp(Math.max(0.02, p95Noise * 1.45), 0.02, 0.25).toFixed(3));

  if (faceSamples.length === 0) {
    return {
      neutralYaw: 0,
      neutralPitch: 0,
      neutralRoll: 0,
      neutralX: 0,
      neutralY: 0,
      neutralZ: 0,
      neutralEyeX: 0,
      neutralEyeY: 0,
      neutralSmile: 0,
      neutralMouth: 0,
      neutralBrowL: 0,
      neutralBrowR: 0,
      neutralPucker: 0,
      neutralFrown: 0,
      neutralCheekPuff: 0,
      neutralNoseSneer: 0,
      neutralJawX: 0,
      neutralSquintL: 0,
      neutralSquintR: 0,
      blinkOpenL: 0,
      blinkOpenR: 0,
      noiseGate,
    };
  }

  const fusedL = faceSamples.map((s) =>
    fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
  );
  const fusedR = faceSamples.map((s) =>
    fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
  );

  // Use 30th percentile for open-eye floor so an accidental blink during the neutral step is ignored
  const blinkOpenL = Number(clamp(percentile(fusedL, 0.3), 0, 0.45).toFixed(3));
  const blinkOpenR = Number(clamp(percentile(fusedR, 0.3), 0, 0.45).toFixed(3));

  const gazes = faceSamples.map((s) => extractRawGazeSample(s.blendshapes));
  const brows = faceSamples.map((s) => extractRawBrowsSample(s.blendshapes));

  return {
    neutralYaw: Number(median(faceSamples.map((s) => s.yaw)).toFixed(2)),
    neutralPitch: Number(median(faceSamples.map((s) => s.pitch)).toFixed(2)),
    neutralRoll: Number(median(faceSamples.map((s) => s.roll)).toFixed(2)),
    neutralX: Number(median(faceSamples.map((s) => s.x)).toFixed(3)),
    neutralY: Number(median(faceSamples.map((s) => s.y)).toFixed(3)),
    neutralZ: Number(median(faceSamples.map((s) => s.z)).toFixed(3)),
    neutralEyeX: Number(median(gazes.map((g) => g.x)).toFixed(3)),
    neutralEyeY: Number(median(gazes.map((g) => g.y)).toFixed(3)),
    neutralSmile: Number(
      median(
        faceSamples.map(
          (s) => ((s.blendshapes.mouthSmileLeft || 0) + (s.blendshapes.mouthSmileRight || 0)) / 2
        )
      ).toFixed(3)
    ),
    neutralMouth: Number(
      percentile(
        faceSamples.map((s) => s.blendshapes.jawOpen || 0),
        0.3
      ).toFixed(3)
    ),
    neutralBrowL: Number(median(brows.map((b) => b.l)).toFixed(3)),
    neutralBrowR: Number(median(brows.map((b) => b.r)).toFixed(3)),
    neutralPucker: Number(
      median(
        faceSamples.map((s) =>
          Math.max(s.blendshapes.mouthPucker || 0, (s.blendshapes.mouthFunnel || 0) * 0.75)
        )
      ).toFixed(3)
    ),
    neutralFrown: Number(
      median(faceSamples.map((s) => extractRawFrownClient(s.blendshapes))).toFixed(3)
    ),
    neutralCheekPuff: Number(
      median(faceSamples.map((s) => s.blendshapes.cheekPuff || 0)).toFixed(3)
    ),
    neutralNoseSneer: Number(
      median(
        faceSamples.map(
          (s) => ((s.blendshapes.noseSneerLeft || 0) + (s.blendshapes.noseSneerRight || 0)) / 2
        )
      ).toFixed(3)
    ),
    neutralJawX: Number(
      median(
        faceSamples.map((s) => (s.blendshapes.jawRight || 0) - (s.blendshapes.jawLeft || 0))
      ).toFixed(3)
    ),
    neutralSquintL: Number(
      percentile(
        faceSamples.map((s) =>
          Math.max(s.blendshapes.eyeSquintLeft || 0, (s.blendshapes.cheekSquintLeft || 0) * 0.85)
        ),
        0.3
      ).toFixed(3)
    ),
    neutralSquintR: Number(
      percentile(
        faceSamples.map((s) =>
          Math.max(s.blendshapes.eyeSquintRight || 0, (s.blendshapes.cheekSquintRight || 0) * 0.85)
        ),
        0.3
      ).toFixed(3)
    ),
    blinkOpenL,
    blinkOpenR,
    noiseGate,
  };
}

/**
 * Step 2 Analyzer: Beep-Synchronized Blinks, Left/Right Winks & Glasses Glare Detection
 */
export function analyzeBeepBlinkStep(
  samples: CalibrationSample[],
  beepTimestamps: number[],
  openL: number,
  openR: number,
  winkTimestamps: number[] = []
): BlinkStepResult {
  const faceSamples = samples.filter((s) => s.present);
  if (faceSamples.length === 0) {
    return {
      blinkClosedL: 1.0,
      blinkClosedR: 1.0,
      glareAssist: false,
      blinkThresholdL: 0.45,
      blinkThresholdR: 0.45,
    };
  }

  const windowPeaksL: number[] = [];
  const windowPeaksR: number[] = [];

  for (const tBeep of beepTimestamps) {
    const inWin = faceSamples.filter(
      (s) => s.timestamp >= tBeep + 60 && s.timestamp <= tBeep + 900
    );
    if (inWin.length > 0) {
      const maxL = Math.max(
        ...inWin.map((s) =>
          fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
        )
      );
      const maxR = Math.max(
        ...inWin.map((s) =>
          fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
        )
      );
      if (maxL > openL + 0.05) windowPeaksL.push(maxL);
      if (maxR > openR + 0.05) windowPeaksR.push(maxR);
    }
  }

  // Analyze single-eye wink windows (Left Wink & Right Wink) to measure:
  // 1) Each eye's solo wink closure ceiling (which is often softer than a bilateral blink)
  // 2) The opposite open eye's sympathetic squint (crosstalk) so thresholds sit cleanly above it
  const winkPeaksL: number[] = [];
  const winkPeaksR: number[] = [];
  const crossTalkL: number[] = [];
  const crossTalkR: number[] = [];

  for (const tWink of winkTimestamps) {
    const inWin = faceSamples.filter(
      (s) => s.timestamp >= tWink + 60 && s.timestamp <= tWink + 1250
    );
    if (inWin.length === 0) continue;

    let bestDiff = 0;
    let bestFusedL = openL;
    let bestFusedR = openR;
    for (const s of inWin) {
      const bs = s.blendshapes;
      const smileVal = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) * 0.5;
      const sqL = Math.max(bs.eyeSquintLeft || 0, (bs.cheekSquintLeft || 0) * 0.85);
      const sqR = Math.max(bs.eyeSquintRight || 0, (bs.cheekSquintRight || 0) * 0.85);
      const fL = fuseBlinkScoreClient(
        bs.eyeBlinkLeft || 0,
        bs.earBlinkLeft,
        sqL,
        smileVal,
        bs.eyeWideLeft || 0
      );
      const fR = fuseBlinkScoreClient(
        bs.eyeBlinkRight || 0,
        bs.earBlinkRight,
        sqR,
        smileVal,
        bs.eyeWideRight || 0
      );
      const relL = Math.max(0, fL - openL);
      const relR = Math.max(0, fR - openR);
      const diff = Math.abs(relL - relR);
      if (diff > bestDiff) {
        bestDiff = diff;
        bestFusedL = fL;
        bestFusedR = fR;
      }
    }

    const bestRelL = bestFusedL - openL;
    const bestRelR = bestFusedR - openR;
    if (bestRelL > bestRelR + 0.04 && bestRelL > 0.06) {
      winkPeaksL.push(bestFusedL);
      crossTalkR.push(bestFusedR);
    } else if (bestRelR > bestRelL + 0.04 && bestRelR > 0.06) {
      winkPeaksR.push(bestFusedR);
      crossTalkL.push(bestFusedL);
    }
  }

  const allFusedL = faceSamples.map((s) =>
    fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
  );
  const allFusedR = faceSamples.map((s) =>
    fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
  );

  let rawClosedL =
    windowPeaksL.length > 0 ? median(windowPeaksL) : percentile(allFusedL, 0.92);
  let rawClosedR =
    windowPeaksR.length > 0 ? median(windowPeaksR) : percentile(allFusedR, 0.92);

  // If the user performed solo winks, use the softer of (bilateral, solo wink * 0.96)
  // so that single-eye winks reliably reach ~0.95-1.0 in remapped space without hovering near threshold
  if (winkPeaksL.length > 0) {
    rawClosedL = Math.min(rawClosedL, median(winkPeaksL) * 0.96);
  }
  if (winkPeaksR.length > 0) {
    rawClosedR = Math.min(rawClosedR, median(winkPeaksR) * 0.96);
  }

  let blinkClosedL = Number(clamp(rawClosedL, openL + 0.1, 1.0).toFixed(3));
  let blinkClosedR = Number(clamp(rawClosedR, openR + 0.1, 1.0).toFixed(3));

  const spanL = blinkClosedL - openL;
  const spanR = blinkClosedR - openR;
  const maxSpan = Math.max(spanL, spanR);
  const minSpan = Math.min(spanL, spanR);

  // If both eyes demonstrated independent solo winks, disable GlareAssist so it never
  // couples the open eye closed during a wink. Otherwise enable GlareAssist when glasses
  // reflection compresses or asymmetries the blink span.
  const bothWinkedCleanly = winkPeaksL.length > 0 && winkPeaksR.length > 0;
  const glareAssist = bothWinkedCleanly
    ? false
    : spanL < 0.28 ||
      spanR < 0.28 ||
      (maxSpan > 0.12 && minSpan < maxSpan * 0.68);

  // If one eye was severely blocked by glare (span < 0.12) while the other eye blinked clearly,
  // borrow a reasonable ceiling so noise doesn't false-trigger the glare eye
  if (spanL < 0.12 && spanR >= 0.2) {
    blinkClosedL = Number(clamp(openL + spanR * 0.85, openL + 0.15, 1.0).toFixed(3));
  } else if (spanR < 0.12 && spanL >= 0.2) {
    blinkClosedR = Number(clamp(openR + spanL * 0.85, openR + 0.15, 1.0).toFixed(3));
  }

  let blinkThresholdL = 0.48;
  let blinkThresholdR = 0.48;
  if (crossTalkL.length > 0) {
    const remappedCrossL = remapBlinkClient(Math.max(...crossTalkL), openL, blinkClosedL);
    blinkThresholdL = Number(
      clamp(Math.max(0.45, (remappedCrossL + 0.85) / 2), 0.45, 0.72).toFixed(2)
    );
  }
  if (crossTalkR.length > 0) {
    const remappedCrossR = remapBlinkClient(Math.max(...crossTalkR), openR, blinkClosedR);
    blinkThresholdR = Number(
      clamp(Math.max(0.45, (remappedCrossR + 0.85) / 2), 0.45, 0.72).toFixed(2)
    );
  }

  return {
    blinkClosedL,
    blinkClosedR,
    glareAssist,
    blinkThresholdL,
    blinkThresholdR,
  };
}

/**
 * Step 3 Analyzer: Head Turn Multipliers & Early Glasses/Headphone Occlusion Detection
 */
export function analyzeHeadTurnStep(
  samples: CalibrationSample[],
  neutralYaw: number,
  neutralPitch: number,
  openL: number,
  openR: number,
  closedL: number,
  closedR: number
): HeadTurnStepResult {
  const faceSamples = samples.filter((s) => s.present);
  if (faceSamples.length === 0) {
    return {
      blinkMaxHeadYaw: 25,
      yawMultiplier: 1.0,
      pitchMultiplier: 1.0,
      earlyOcclusionDetected: false,
    };
  }

  const absYaws = faceSamples.map((s) => Math.abs(s.yaw - neutralYaw));
  const absPitches = faceSamples.map((s) => Math.abs(s.pitch - neutralPitch));

  const p90Yaw = percentile(absYaws, 0.9);
  const p90Pitch = percentile(absPitches, 0.9);

  // Scale natural directional head turns (including side-monitor / off-screen looks) to ~22 deg yaw and ~14 deg pitch
  const yawMultiplier =
    p90Yaw >= 6 ? Number(clamp(22 / p90Yaw, 0.7, 2.0).toFixed(2)) : 1.0;
  const pitchMultiplier =
    p90Pitch >= 4 ? Number(clamp(14 / p90Pitch, 0.7, 2.0).toFixed(2)) : 1.0;

  // Detect the lowest yaw angle (>= 12 deg) where the far-side eye is occluded by glasses rim or headphone cup
  let earliestOcclusionYaw = 27;
  let earlyOcclusionDetected = false;

  for (const s of faceSamples) {
    const calYaw = s.yaw - neutralYaw;
    const absYaw = Math.abs(calYaw);
    if (absYaw < 12 || absYaw >= earliestOcclusionYaw) continue;

    const remappedL = remapBlinkClient(
      fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft),
      openL,
      closedL
    );
    const remappedR = remapBlinkClient(
      fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight),
      openR,
      closedR
    );

    // Turning right (+calYaw): Left eye is far-side, Right eye is camera-facing
    if (calYaw > 12 && remappedL >= 0.48 && remappedR < 0.28) {
      earliestOcclusionYaw = absYaw;
      earlyOcclusionDetected = true;
    }
    // Turning left (-calYaw): Right eye is far-side, Left eye is camera-facing
    if (calYaw < -12 && remappedR >= 0.48 && remappedL < 0.28) {
      earliestOcclusionYaw = absYaw;
      earlyOcclusionDetected = true;
    }
  }

  const blinkMaxHeadYaw = earlyOcclusionDetected
    ? Math.round(clamp(earliestOcclusionYaw - 2, 12, 25))
    : 25;

  return {
    blinkMaxHeadYaw,
    yawMultiplier,
    pitchMultiplier,
    earlyOcclusionDetected,
  };
}

/**
 * Step 4 Analyzer: Smile Asymmetry (Boom Mic Check) & Voice Auto-Gain
 */
export function analyzeVoiceAndSmileStep(
  samples: CalibrationSample[],
  neutralMouth: number,
  neutralSmile: number,
  noiseGate: number
): VoiceSmileStepResult {
  const faceSamples = samples.filter((s) => s.present);
  const audioVolumes = samples.map((s) => s.audioVolume || 0);

  let smileWeightL = 0.5;
  let smileWeightR = 0.5;
  let smileThreshold = 0.5;
  let mouthGain = 1.4;
  let smileBlinkIntrusionL = 0;
  let smileBlinkIntrusionR = 0;

  if (faceSamples.length > 0) {
    const p90SmileL = percentile(
      faceSamples.map(
        (s) =>
          (s.blendshapes.mouthSmileLeft || 0) +
          (s.blendshapes.cheekSquintLeft || 0) * 0.18
      ),
      0.9
    );
    const p90SmileR = percentile(
      faceSamples.map(
        (s) =>
          (s.blendshapes.mouthSmileRight || 0) +
          (s.blendshapes.cheekSquintRight || 0) * 0.18
      ),
      0.9
    );

    const maxSide = Math.max(p90SmileL, p90SmileR);
    const minSide = Math.min(p90SmileL, p90SmileR);

    // If a boom mic occludes one corner of the mouth during a smile, weight the clearer side higher
    if (maxSide >= 0.25 && minSide < maxSide * 0.65) {
      if (p90SmileL > p90SmileR) {
        smileWeightL = 0.75;
        smileWeightR = 0.25;
      } else {
        smileWeightL = 0.25;
        smileWeightR = 0.75;
      }
    }

    const weightedPeakSmile = p90SmileL * smileWeightL + p90SmileR * smileWeightR;
    const calSmileSpan = Math.max(0, weightedPeakSmile - neutralSmile);
    if (calSmileSpan >= 0.15) {
      const normalizedPeak =
        neutralSmile > 0 && neutralSmile < 0.95
          ? calSmileSpan / (1 - neutralSmile)
          : weightedPeakSmile;
      smileThreshold = Number(clamp(normalizedPeak * 0.62, 0.25, 0.75).toFixed(2));
    }

    // Measure smile-induced cheek/eyelid blink intrusion during active smiling frames
    // so blink thresholds sit safely above open-eye cheek compression behind glasses
    const smilingOpenFrames = faceSamples.filter((s) => {
      const bs = s.blendshapes;
      const sm = (bs.mouthSmileLeft || 0) * smileWeightL + (bs.mouthSmileRight || 0) * smileWeightR;
      const earOpen =
        (bs.earBlinkLeft === undefined || bs.earBlinkLeft < 0.5) &&
        (bs.earBlinkRight === undefined || bs.earBlinkRight < 0.5);
      return sm >= neutralSmile + 0.15 && earOpen;
    });
    if (smilingOpenFrames.length > 0) {
      smileBlinkIntrusionL = Number(
        percentile(
          smilingOpenFrames.map((s) => {
            const bs = s.blendshapes;
            const sm = (bs.mouthSmileLeft || 0) * smileWeightL + (bs.mouthSmileRight || 0) * smileWeightR;
            const sqL = Math.max(bs.eyeSquintLeft || 0, (bs.cheekSquintLeft || 0) * 0.85);
            return fuseBlinkScoreClient(bs.eyeBlinkLeft || 0, bs.earBlinkLeft, sqL, sm, bs.eyeWideLeft || 0);
          }),
          0.75
        ).toFixed(3)
      );
      smileBlinkIntrusionR = Number(
        percentile(
          smilingOpenFrames.map((s) => {
            const bs = s.blendshapes;
            const sm = (bs.mouthSmileLeft || 0) * smileWeightL + (bs.mouthSmileRight || 0) * smileWeightR;
            const sqR = Math.max(bs.eyeSquintRight || 0, (bs.cheekSquintRight || 0) * 0.85);
            return fuseBlinkScoreClient(bs.eyeBlinkRight || 0, bs.earBlinkRight, sqR, sm, bs.eyeWideRight || 0);
          }),
          0.75
        ).toFixed(3)
      );
    }

    const p90Jaw = percentile(
      faceSamples.map((s) => s.blendshapes.jawOpen || 0),
      0.9
    );
    const jawSpan = Math.max(0, p90Jaw - neutralMouth);
    if (jawSpan >= 0.08) {
      mouthGain = Number(clamp(0.75 / jawSpan, 0.9, 2.8).toFixed(1));
    }
  }

  // Speaking volume auto-gain
  const activeSpeechVols = audioVolumes.filter((v) => v > noiseGate * 0.8);
  let micGain = 1.5;
  if (activeSpeechVols.length > 0) {
    const p85Vol = percentile(activeSpeechVols, 0.85);
    if (p85Vol > 0.015) {
      micGain = Number(clamp(0.65 / p85Vol, 0.5, 4.0).toFixed(1));
    }
  }

  return {
    smileWeightL,
    smileWeightR,
    smileThreshold,
    mouthGain,
    micGain,
    smileBlinkIntrusionL,
    smileBlinkIntrusionR,
  };
}

/**
 * Combines step results into a complete CalibrationProfile
 */
export function buildCalibrationProfile(
  neutral: NeutralStepResult,
  blink: BlinkStepResult,
  voiceSmile: VoiceSmileStepResult
): CalibrationProfile {
  return {
    calibrated: true,
    neutralYaw: neutral.neutralYaw,
    neutralPitch: neutral.neutralPitch,
    neutralRoll: neutral.neutralRoll,
    neutralX: neutral.neutralX,
    neutralY: neutral.neutralY,
    neutralZ: neutral.neutralZ,
    neutralEyeX: neutral.neutralEyeX,
    neutralEyeY: neutral.neutralEyeY,
    neutralSmile: neutral.neutralSmile,
    neutralMouth: neutral.neutralMouth,
    neutralBrowL: neutral.neutralBrowL,
    neutralBrowR: neutral.neutralBrowR,
    neutralPucker: neutral.neutralPucker,
    neutralFrown: neutral.neutralFrown,
    neutralCheekPuff: neutral.neutralCheekPuff,
    neutralNoseSneer: neutral.neutralNoseSneer,
    neutralJawX: neutral.neutralJawX,
    neutralSquintL: neutral.neutralSquintL,
    neutralSquintR: neutral.neutralSquintR,
    blinkOpenL: neutral.blinkOpenL,
    blinkOpenR: neutral.blinkOpenR,
    blinkClosedL: blink.blinkClosedL,
    blinkClosedR: blink.blinkClosedR,
    glareAssist: blink.glareAssist,
    smileWeightL: voiceSmile.smileWeightL,
    smileWeightR: voiceSmile.smileWeightR,
  };
}

/**
 * Procedural Web Audio API synthesizer cues for eyes-free / text-free guided calibration.
 */
export function playCalibrationCue(
  ctx: AudioContext | null | undefined,
  cue: "tick" | "beep" | "step_done" | "complete"
): void {
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const now = ctx.currentTime;

    const playNote = (
      freq: number,
      startOffset: number,
      duration: number,
      peakGain = 0.14,
      type: OscillatorType = "sine"
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.01);
    };

    if (cue === "tick") {
      playNote(440, 0, 0.055, 0.08, "sine");
    } else if (cue === "beep") {
      playNote(880, 0, 0.11, 0.18, "triangle");
    } else if (cue === "step_done") {
      playNote(523.25, 0, 0.11, 0.14, "sine"); // C5
      playNote(659.25, 0.1, 0.16, 0.15, "sine"); // E5
    } else if (cue === "complete") {
      playNote(523.25, 0, 0.11, 0.14, "sine"); // C5
      playNote(659.25, 0.1, 0.11, 0.15, "sine"); // E5
      playNote(783.99, 0.2, 0.24, 0.16, "sine"); // G5
    }
  } catch (e) {
    // Ignore audio context errors in headless/restricted environments
  }
}
