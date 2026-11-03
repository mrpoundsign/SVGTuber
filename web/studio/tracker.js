// web/src/studio/index.ts
import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// web/src/studio/pose.ts
function extractEulerAngles(matrix) {
  if (!matrix || matrix.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  }
  const m00 = matrix[0], m10 = matrix[1], m20 = matrix[2];
  const m01 = matrix[4], m11 = matrix[5], m21 = matrix[6];
  const m02 = matrix[8], m12 = matrix[9], m22 = matrix[10];
  const m03 = matrix[12], m13 = matrix[13], m23 = matrix[14];
  const pitchRad = Math.asin(-Math.max(-1, Math.min(1, m12)));
  const yawRad = Math.atan2(m02, m22);
  const rollRad = Math.atan2(m10, m11);
  const radToDeg = 180 / Math.PI;
  const normalizeZero = (v) => Math.abs(v) < 1e-9 ? 0 : v;
  return {
    yaw: normalizeZero(yawRad * radToDeg),
    pitch: normalizeZero(pitchRad * radToDeg),
    roll: normalizeZero(rollRad * radToDeg),
    x: normalizeZero(m03),
    y: normalizeZero(m13),
    z: normalizeZero(m23)
  };
}
function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function earToBlinkClosure(ear, openEar = 0.28, closedEar = 0.11) {
  const span = Math.max(0.05, openEar - closedEar);
  const closure = (openEar - ear) / span;
  return Math.max(0, Math.min(1, closure));
}
function computeEyeAspectRatios(landmarks) {
  if (!landmarks || landmarks.length < 387) {
    return null;
  }
  const lOuter = landmarks[263];
  const lInner = landmarks[362];
  const lUp1 = landmarks[386];
  const lLow1 = landmarks[374];
  const lUp2 = landmarks[385];
  const lLow2 = landmarks[380];
  const rOuter = landmarks[33];
  const rInner = landmarks[133];
  const rUp1 = landmarks[159];
  const rLow1 = landmarks[145];
  const rUp2 = landmarks[158];
  const rLow2 = landmarks[153];
  if (!lOuter || !lInner || !lUp1 || !lLow1 || !lUp2 || !lLow2 || !rOuter || !rInner || !rUp1 || !rLow1 || !rUp2 || !rLow2) {
    return null;
  }
  const horizL = dist3D(lOuter, lInner);
  const horizR = dist3D(rOuter, rInner);
  if (horizL < 1e-5 || horizR < 1e-5) {
    return null;
  }
  const earL = (dist3D(lUp1, lLow1) + dist3D(lUp2, lLow2)) / (2 * horizL);
  const earR = (dist3D(rUp1, rLow1) + dist3D(rUp2, rLow2)) / (2 * horizR);
  return {
    earL,
    earR,
    earBlinkLeft: earToBlinkClosure(earL),
    earBlinkRight: earToBlinkClosure(earR)
  };
}
function computeMouthGeometry(landmarks) {
  if (!landmarks || landmarks.length < 309) {
    return null;
  }
  const rEye = landmarks[33];
  const lEye = landmarks[263];
  const rCorner = landmarks[61];
  const lCorner = landmarks[291];
  const upperInner = landmarks[13];
  const lowerInner = landmarks[14];
  if (!rEye || !lEye || !rCorner || !lCorner || !upperInner || !lowerInner) {
    return null;
  }
  const mouthWidth = dist3D(rCorner, lCorner);
  if (mouthWidth < 1e-5) {
    return null;
  }
  const rollAngle = Math.atan2(lEye.y - rEye.y, lEye.x - rEye.x);
  const downX = -Math.sin(rollAngle);
  const downY = Math.cos(rollAngle);
  const centerX = (upperInner.x + lowerInner.x) * 0.5;
  const centerY = (upperInner.y + lowerInner.y) * 0.5;
  const dropL = ((lCorner.x - centerX) * downX + (lCorner.y - centerY) * downY) / mouthWidth;
  const dropR = ((rCorner.x - centerX) * downX + (rCorner.y - centerY) * downY) / mouthWidth;
  const mapDropToFrown = (drop) => {
    const norm = (drop - 0.01) / 0.095;
    return Math.max(0, Math.min(1, norm));
  };
  const gap = dist3D(upperInner, lowerInner) / mouthWidth;
  return {
    geoFrownLeft: mapDropToFrown(dropL),
    geoFrownRight: mapDropToFrown(dropR),
    mouthGapRatio: Math.max(0, Math.min(1, gap))
  };
}
function evaluateOpticalTongue(cavity, skin, mouthGapRatio, jawOpen) {
  const effectiveOpen = Math.max(jawOpen, mouthGapRatio * 2.2);
  if (effectiveOpen < 0.1) {
    return 0;
  }
  const cavityLuma = 0.299 * cavity.r + 0.587 * cavity.g + 0.114 * cavity.b;
  const skinLuma = Math.max(20, 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b);
  const lumaRatio = cavityLuma / skinLuma;
  if (lumaRatio < 0.46) {
    return 0;
  }
  const cavityRedGreen = (cavity.r - cavity.g) / Math.max(30, cavity.r + cavity.g);
  const skinRedGreen = (skin.r - skin.g) / Math.max(30, skin.r + skin.g);
  const cavityRedBlue = (cavity.r - cavity.b) / Math.max(30, cavity.r + cavity.b);
  if (cavity.r < 65 || cavityRedGreen < 0.08 || cavityRedBlue < 0.06) {
    return 0;
  }
  const pinkBoost = Math.max(0, cavityRedGreen - skinRedGreen * 0.82);
  const rawScore = ((lumaRatio - 0.44) * 1.4 + pinkBoost * 4.5) * Math.min(1, (effectiveOpen - 0.08) / 0.18);
  return Math.max(0, Math.min(1, rawScore));
}

// web/src/studio/calibration-wizard.ts
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
function median(values) {
  return percentile(values, 0.5);
}
function fuseBlinkScoreClient(blendshapeBlink, earBlink, eyeSquintOrCheek = 0, smile = 0, eyeWide = 0) {
  let b = clamp(blendshapeBlink || 0, 0, 1);
  if (earBlink === void 0 || earBlink === null || isNaN(earBlink)) {
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
function remapBlinkClient(raw, openFloor = 0, closedCeiling = 1) {
  const r = clamp(raw || 0, 0, 1);
  if (openFloor <= 0 && (closedCeiling <= 0 || closedCeiling >= 0.999)) {
    return r;
  }
  const ceil = closedCeiling <= 0 ? 1 : closedCeiling;
  const span = Math.max(0.08, ceil - openFloor);
  return clamp((r - openFloor) / span, 0, 1);
}
function extractRawGazeSample(bs) {
  const lookRight = ((bs.eyeLookInLeft || 0) + (bs.eyeLookOutRight || 0)) / 2;
  const lookLeft = ((bs.eyeLookOutLeft || 0) + (bs.eyeLookInRight || 0)) / 2;
  const lookUp = ((bs.eyeLookUpLeft || 0) + (bs.eyeLookUpRight || 0)) / 2;
  const lookDown = ((bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0)) / 2;
  return {
    x: lookLeft - lookRight,
    y: lookDown - lookUp
  };
}
function extractRawBrowsSample(bs) {
  const inner = bs.browInnerUp || 0;
  const upL = Math.max(bs.browOuterUpLeft || 0, inner);
  const upR = Math.max(bs.browOuterUpRight || 0, inner);
  return {
    l: upL - (bs.browDownLeft || 0),
    r: upR - (bs.browDownRight || 0)
  };
}
function extractRawFrownClient(bs, wL = 0.5, wR = 0.5) {
  const rawSmile = (bs.mouthSmileLeft || 0) * wL + (bs.mouthSmileRight || 0) * wR;
  const rawPucker = Math.max(bs.mouthPucker || 0, (bs.mouthFunnel || 0) * 0.75);
  const bsFrown = (bs.mouthFrownLeft || 0) * wL + (bs.mouthFrownRight || 0) * wR;
  const geoFrown = (bs.geoFrownLeft || 0) * wL + (bs.geoFrownRight || 0) * wR;
  const nonSmileGate = Math.max(0, 1 - rawSmile * 2.5) * Math.max(0, 1 - rawPucker * 1.8) * Math.max(0, 1 - (bs.jawOpen || 0) * 2.2);
  const shrugPout = ((bs.mouthShrugLower || 0) * 0.65 + (bs.mouthRollLower || 0) * 0.35) * nonSmileGate;
  return clamp(Math.max(bsFrown, Math.max(geoFrown * 0.85, shrugPout)), 0, 1);
}
function analyzeNeutralStep(samples) {
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
      noiseGate
    };
  }
  const fusedL = faceSamples.map(
    (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
  );
  const fusedR = faceSamples.map(
    (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
  );
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
        faceSamples.map(
          (s) => Math.max(s.blendshapes.mouthPucker || 0, (s.blendshapes.mouthFunnel || 0) * 0.75)
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
        faceSamples.map(
          (s) => Math.max(s.blendshapes.eyeSquintLeft || 0, (s.blendshapes.cheekSquintLeft || 0) * 0.85)
        ),
        0.3
      ).toFixed(3)
    ),
    neutralSquintR: Number(
      percentile(
        faceSamples.map(
          (s) => Math.max(s.blendshapes.eyeSquintRight || 0, (s.blendshapes.cheekSquintRight || 0) * 0.85)
        ),
        0.3
      ).toFixed(3)
    ),
    blinkOpenL,
    blinkOpenR,
    noiseGate
  };
}
function analyzeBeepBlinkStep(samples, beepTimestamps, openL, openR, winkTimestamps = []) {
  const faceSamples = samples.filter((s) => s.present);
  if (faceSamples.length === 0) {
    return {
      blinkClosedL: 1,
      blinkClosedR: 1,
      glareAssist: false,
      blinkThresholdL: 0.45,
      blinkThresholdR: 0.45
    };
  }
  const windowPeaksL = [];
  const windowPeaksR = [];
  for (const tBeep of beepTimestamps) {
    const inWin = faceSamples.filter(
      (s) => s.timestamp >= tBeep + 60 && s.timestamp <= tBeep + 900
    );
    if (inWin.length > 0) {
      const maxL = Math.max(
        ...inWin.map(
          (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
        )
      );
      const maxR = Math.max(
        ...inWin.map(
          (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
        )
      );
      if (maxL > openL + 0.05) windowPeaksL.push(maxL);
      if (maxR > openR + 0.05) windowPeaksR.push(maxR);
    }
  }
  const winkPeaksL = [];
  const winkPeaksR = [];
  const crossTalkL = [];
  const crossTalkR = [];
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
  const allFusedL = faceSamples.map(
    (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkLeft || 0, s.blendshapes.earBlinkLeft)
  );
  const allFusedR = faceSamples.map(
    (s) => fuseBlinkScoreClient(s.blendshapes.eyeBlinkRight || 0, s.blendshapes.earBlinkRight)
  );
  let rawClosedL = windowPeaksL.length > 0 ? median(windowPeaksL) : percentile(allFusedL, 0.92);
  let rawClosedR = windowPeaksR.length > 0 ? median(windowPeaksR) : percentile(allFusedR, 0.92);
  if (winkPeaksL.length > 0) {
    rawClosedL = Math.min(rawClosedL, median(winkPeaksL) * 0.96);
  }
  if (winkPeaksR.length > 0) {
    rawClosedR = Math.min(rawClosedR, median(winkPeaksR) * 0.96);
  }
  let blinkClosedL = Number(clamp(rawClosedL, openL + 0.1, 1).toFixed(3));
  let blinkClosedR = Number(clamp(rawClosedR, openR + 0.1, 1).toFixed(3));
  const spanL = blinkClosedL - openL;
  const spanR = blinkClosedR - openR;
  const maxSpan = Math.max(spanL, spanR);
  const minSpan = Math.min(spanL, spanR);
  const bothWinkedCleanly = winkPeaksL.length > 0 && winkPeaksR.length > 0;
  const glareAssist = bothWinkedCleanly ? false : spanL < 0.28 || spanR < 0.28 || maxSpan > 0.12 && minSpan < maxSpan * 0.68;
  if (spanL < 0.12 && spanR >= 0.2) {
    blinkClosedL = Number(clamp(openL + spanR * 0.85, openL + 0.15, 1).toFixed(3));
  } else if (spanR < 0.12 && spanL >= 0.2) {
    blinkClosedR = Number(clamp(openR + spanL * 0.85, openR + 0.15, 1).toFixed(3));
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
    blinkThresholdR
  };
}
function analyzeHeadTurnStep(samples, neutralYaw, neutralPitch, openL, openR, closedL, closedR) {
  const faceSamples = samples.filter((s) => s.present);
  if (faceSamples.length === 0) {
    return {
      blinkMaxHeadYaw: 25,
      yawMultiplier: 1,
      pitchMultiplier: 1,
      earlyOcclusionDetected: false
    };
  }
  const absYaws = faceSamples.map((s) => Math.abs(s.yaw - neutralYaw));
  const absPitches = faceSamples.map((s) => Math.abs(s.pitch - neutralPitch));
  const p90Yaw = percentile(absYaws, 0.9);
  const p90Pitch = percentile(absPitches, 0.9);
  const yawMultiplier = p90Yaw >= 6 ? Number(clamp(22 / p90Yaw, 0.7, 2).toFixed(2)) : 1;
  const pitchMultiplier = p90Pitch >= 4 ? Number(clamp(14 / p90Pitch, 0.7, 2).toFixed(2)) : 1;
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
    if (calYaw > 12 && remappedL >= 0.48 && remappedR < 0.28) {
      earliestOcclusionYaw = absYaw;
      earlyOcclusionDetected = true;
    }
    if (calYaw < -12 && remappedR >= 0.48 && remappedL < 0.28) {
      earliestOcclusionYaw = absYaw;
      earlyOcclusionDetected = true;
    }
  }
  const blinkMaxHeadYaw = earlyOcclusionDetected ? Math.round(clamp(earliestOcclusionYaw - 2, 12, 25)) : 25;
  return {
    blinkMaxHeadYaw,
    yawMultiplier,
    pitchMultiplier,
    earlyOcclusionDetected
  };
}
function analyzeVoiceAndSmileStep(samples, neutralMouth, neutralSmile, noiseGate) {
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
        (s) => (s.blendshapes.mouthSmileLeft || 0) + (s.blendshapes.cheekSquintLeft || 0) * 0.18
      ),
      0.9
    );
    const p90SmileR = percentile(
      faceSamples.map(
        (s) => (s.blendshapes.mouthSmileRight || 0) + (s.blendshapes.cheekSquintRight || 0) * 0.18
      ),
      0.9
    );
    const maxSide = Math.max(p90SmileL, p90SmileR);
    const minSide = Math.min(p90SmileL, p90SmileR);
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
      const normalizedPeak = neutralSmile > 0 && neutralSmile < 0.95 ? calSmileSpan / (1 - neutralSmile) : weightedPeakSmile;
      smileThreshold = Number(clamp(normalizedPeak * 0.62, 0.25, 0.75).toFixed(2));
    }
    const smilingOpenFrames = faceSamples.filter((s) => {
      const bs = s.blendshapes;
      const sm = (bs.mouthSmileLeft || 0) * smileWeightL + (bs.mouthSmileRight || 0) * smileWeightR;
      const earOpen = (bs.earBlinkLeft === void 0 || bs.earBlinkLeft < 0.5) && (bs.earBlinkRight === void 0 || bs.earBlinkRight < 0.5);
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
  const activeSpeechVols = audioVolumes.filter((v) => v > noiseGate * 0.8);
  let micGain = 1.5;
  if (activeSpeechVols.length > 0) {
    const p85Vol = percentile(activeSpeechVols, 0.85);
    if (p85Vol > 0.015) {
      micGain = Number(clamp(0.65 / p85Vol, 0.5, 4).toFixed(1));
    }
  }
  const activePitchSamples = samples.filter((s) => (s.audioVolume || 0) > noiseGate * 0.8 && (s.audioPitchHz || 0) >= 75).map((s) => s.audioPitchHz);
  const neutralPitchHz = activePitchSamples.length > 0 ? Number(clamp(median(activePitchSamples), 80, 380).toFixed(1)) : 165;
  return {
    smileWeightL,
    smileWeightR,
    smileThreshold,
    mouthGain,
    micGain,
    neutralPitchHz,
    smileBlinkIntrusionL,
    smileBlinkIntrusionR
  };
}
function buildCalibrationProfile(neutral, blink, voiceSmile) {
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
    neutralPitchHz: voiceSmile.neutralPitchHz || 165,
    blinkOpenL: neutral.blinkOpenL,
    blinkOpenR: neutral.blinkOpenR,
    blinkClosedL: blink.blinkClosedL,
    blinkClosedR: blink.blinkClosedR,
    glareAssist: blink.glareAssist,
    smileWeightL: voiceSmile.smileWeightL,
    smileWeightR: voiceSmile.smileWeightR
  };
}
function playCalibrationCue(ctx, cue) {
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const now = ctx.currentTime;
    const playNote = (freq, startOffset, duration, peakGain = 0.14, type = "sine") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(1e-4, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(1e-4, now + startOffset + duration);
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
      playNote(523.25, 0, 0.11, 0.14, "sine");
      playNote(659.25, 0.1, 0.16, 0.15, "sine");
    } else if (cue === "complete") {
      playNote(523.25, 0, 0.11, 0.14, "sine");
      playNote(659.25, 0.1, 0.11, 0.15, "sine");
      playNote(783.99, 0.2, 0.24, 0.16, "sine");
    }
  } catch (e) {
  }
}

// web/src/studio/audio.ts
function calculateRMS(data) {
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}
function stepAudioVolume(currentSmoothed, rms, decay = 0.1) {
  if (rms > currentSmoothed) {
    return rms;
  }
  return currentSmoothed * (1 - decay) + rms * decay;
}
function evaluateSpeechGate(volume, micGain = 1.5, noiseGate = 0.04) {
  return volume * micGain >= noiseGate;
}
function clamp01(val) {
  return Math.max(0, Math.min(1, val));
}
function analyzeAudioSpectrum(freqBins, sampleRate = 48e3, isSpeaking = true, neutralPitchHz = 165, opticalHints) {
  if (!isSpeaking || !freqBins || freqBins.length === 0) {
    return {
      pitch: 0,
      pitchHz: 0,
      viseme: "sil",
      visemeA: 0,
      visemeI: 0,
      visemeU: 0,
      visemeE: 0,
      visemeO: 0
    };
  }
  const numBins = freqBins.length;
  const fftSize = numBins * 2;
  const binHz = (sampleRate > 0 ? sampleRate : 48e3) / fftSize;
  const getNormBin = (idx) => {
    const v = freqBins[idx] || 0;
    return v > 1 ? clamp01(v / 255) : clamp01(v);
  };
  const bandAvg = (minHz, maxHz) => {
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
  const f0Start = Math.max(1, Math.floor(85 / binHz));
  const f0End = Math.min(numBins - 1, Math.ceil(420 / binHz));
  let weightedFreqSum = 0;
  let weightSum = 0;
  for (let i = f0Start; i <= f0End; i++) {
    const mag = getNormBin(i);
    if (mag > 0.05) {
      const w = mag * mag;
      weightedFreqSum += i * binHz * w;
      weightSum += w;
    }
  }
  const pitchHz = weightSum > 0 ? Number((weightedFreqSum / weightSum).toFixed(1)) : 0;
  const basePitch = neutralPitchHz >= 75 && neutralPitchHz <= 400 ? neutralPitchHz : 165;
  const pitch = pitchHz > 0 ? Number(clamp01(0.5 + (pitchHz - basePitch) / 160).toFixed(3)) : 0;
  const lowBand = bandAvg(90, 380);
  const f1Mid = bandAvg(380, 680);
  const f1High = bandAvg(680, 1100);
  const f2Low = bandAvg(850, 1450);
  const f2Mid = bandAvg(1450, 2150);
  const f2High = bandAvg(2150, 3500);
  let rawA = f1High * 1.2 + f2Low * 0.55;
  let rawI = f2High * 1.55 + lowBand * 0.4;
  let rawU = lowBand * 1.35 * Math.max(0.15, 1 - f2High * 1.3 - f1High * 0.9);
  let rawE = f1Mid * 0.75 + f2Mid * 1.25;
  let rawO = (f1Mid * 1 + f2Low * 0.85) * Math.max(0.2, 1 - f2High * 1.2 - f2Mid * 0.5);
  if (opticalHints) {
    const mOpen = clamp01(opticalHints.mouthOpen ?? 0);
    const mPucker = clamp01(opticalHints.mouthPucker ?? 0);
    const mSmile = clamp01(opticalHints.smile ?? 0);
    if (mPucker >= 0.22) {
      rawU += mPucker * 0.45 * (1 - mOpen * 0.5);
      rawO += mPucker * 0.4 * (0.4 + mOpen * 0.6);
      rawI *= Math.max(0.25, 1 - mPucker * 0.8);
      rawE *= Math.max(0.35, 1 - mPucker * 0.6);
    }
    if (mSmile >= 0.22) {
      rawI += mSmile * 0.4 * (1 - mOpen * 0.4);
      rawE += mSmile * 0.35 * (0.3 + mOpen * 0.7);
      rawU *= Math.max(0.3, 1 - mSmile * 0.7);
    }
    if (mOpen >= 0.45) {
      rawA += (mOpen - 0.35) * 0.45;
      rawO += (mOpen - 0.35) * 0.25 * (0.5 + mPucker);
      rawU *= Math.max(0.3, 1 - (mOpen - 0.4) * 0.8);
    }
  }
  const maxRaw = Math.max(rawA, rawI, rawU, rawE, rawO);
  if (maxRaw < 0.02) {
    return {
      pitch,
      pitchHz,
      viseme: "sil",
      visemeA: 0,
      visemeI: 0,
      visemeU: 0,
      visemeE: 0,
      visemeO: 0
    };
  }
  const normScale = Math.min(1, Math.max(0.65, maxRaw * 1.6)) / maxRaw;
  const visemeA = Number(clamp01(rawA * normScale).toFixed(3));
  const visemeI = Number(clamp01(rawI * normScale).toFixed(3));
  const visemeU = Number(clamp01(rawU * normScale).toFixed(3));
  const visemeE = Number(clamp01(rawE * normScale).toFixed(3));
  const visemeO = Number(clamp01(rawO * normScale).toFixed(3));
  let viseme = "A";
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
    viseme,
    visemeA,
    visemeI,
    visemeU,
    visemeE,
    visemeO
  };
}
function detectShoutAndLaugh(volume, micGain = 1.5, noiseGate = 0.04, rmsHistory2 = [], smile = 0) {
  const amplified = volume * micGain;
  const isSpeaking = amplified >= noiseGate;
  const isShouting = Boolean(isSpeaking && amplified >= 0.82);
  let isLaughing = false;
  if (rmsHistory2 && rmsHistory2.length >= 6) {
    const gateRaw = noiseGate / Math.max(0.1, micGain);
    let peaks = 0;
    let valleys = 0;
    for (let i = 1; i < rmsHistory2.length - 1; i++) {
      const prev = rmsHistory2[i - 1];
      const cur = rmsHistory2[i];
      const next = rmsHistory2[i + 1];
      if (cur > gateRaw * 1.4 && cur >= prev + 0.012 && cur >= next + 0.012) {
        peaks++;
      } else if (cur < prev - 0.01 && cur <= next - 0.01) {
        valleys++;
      }
    }
    if (peaks >= 3 && valleys >= 2 || smile >= 0.38 && isSpeaking && peaks >= 2 && valleys >= 1) {
      isLaughing = true;
    }
  }
  return { isShouting, isLaughing };
}

// web/src/studio/settings.ts
function createDebouncedSaver(saveFn, delayMs = 80) {
  let timer = null;
  return (payload) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveFn(payload).catch((err) => {
        console.error("[Settings] Auto-save error:", err);
      });
    }, delayMs);
  };
}

// web/src/studio/expressions.ts
function shouldIgnoreHotkey(targetTagName) {
  if (!targetTagName) return false;
  const upper = targetTagName.toUpperCase();
  return upper === "INPUT" || upper === "TEXTAREA" || upper === "SELECT";
}
function resolveHotkeyIndex(key, availableExpressions2) {
  const keyNum = parseInt(key, 10);
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
    const idx = keyNum - 1;
    if (availableExpressions2 && availableExpressions2[idx]) {
      return availableExpressions2[idx];
    }
  }
  return null;
}

// web/src/studio/dressing-room.ts
function nudgePosition(x, y, dx, dy, step = 1) {
  return {
    x: Math.round((x + dx * step) * 100) / 100,
    y: Math.round((y + dy * step) * 100) / 100
  };
}
function nudgeRotation(currentRot, deltaRot) {
  let rot = (currentRot + deltaRot) % 360;
  if (rot > 180) rot -= 360;
  if (rot < -180) rot += 360;
  return rot;
}
function computeLinkedScale(newScale, isLinked, axis, currentSX, currentSY) {
  if (isLinked) {
    return { scaleX: newScale, scaleY: newScale };
  }
  return {
    scaleX: axis === "x" ? newScale : currentSX,
    scaleY: axis === "y" ? newScale : currentSY
  };
}
function formatFittingMirrorUrl(isFrozen) {
  const freezeParam = isFrozen ? "&freeze=1" : "";
  return `/overlay?t=${Date.now()}${freezeParam}`;
}

// web/src/studio/camera.ts
function isCameraAllowedInMode(mode) {
  return mode !== "audio";
}
function shouldAutoStartCamera(mode, cameraActiveStorage) {
  if (!isCameraAllowedInMode(mode)) {
    return false;
  }
  return cameraActiveStorage === "true" || cameraActiveStorage === null;
}
function getCameraStatus(webcamRunning2, micRunning2, mode) {
  if (!isCameraAllowedInMode(mode)) {
    return {
      text: micRunning2 ? "Audio Only (Mic Active)" : "Audio Only (Mic Off)",
      className: micRunning2 ? "status-ok" : "status-warn"
    };
  }
  if (webcamRunning2) {
    return {
      text: "Tracking Active",
      className: "status-ok"
    };
  }
  return {
    text: micRunning2 ? "Camera Off (Face Lost) - Audio Active" : "Camera Off (Face Lost)",
    className: "status-warn"
  };
}
function getCameraButtonState(webcamRunning2, mode) {
  if (!isCameraAllowedInMode(mode)) {
    return {
      text: "Camera Disabled (Audio Only)",
      disabled: true,
      isDanger: false,
      title: "Camera is disabled in Audio Only mode"
    };
  }
  if (webcamRunning2) {
    return {
      text: "Stop Camera",
      disabled: false,
      isDanger: true,
      title: ""
    };
  }
  return {
    text: "Start Camera",
    disabled: false,
    isDanger: false,
    title: ""
  };
}
function computeSessionBannerState(isActive, connectedTabs) {
  if (connectedTabs <= 1) {
    return {
      showBanner: false,
      message: "",
      showTakeOver: false
    };
  }
  if (isActive) {
    return {
      showBanner: true,
      message: `Multiple Studio tabs open (${connectedTabs} connected). Tracking is active in this tab.`,
      showTakeOver: false
    };
  }
  return {
    showBanner: true,
    message: `Multiple Studio tabs open (${connectedTabs} connected). Tracking locked to another tab to prevent jitter.`,
    showTakeOver: true,
    statusText: "Tracking Inactive (Other Tab Active)",
    statusClass: "status-warn"
  };
}

// web/src/studio/updater.ts
function normalizeVersionTag(ver) {
  const clean = (ver || "").trim();
  if (!clean) return "v0.0.8";
  return clean.startsWith("v") || clean.startsWith("V") ? `v${clean.slice(1)}` : `v${clean}`;
}
function formatUpdateBadgeText(latestVersion) {
  return `\u2B06 Update ${normalizeVersionTag(latestVersion)}`;
}
function formatAssetSize(bytes) {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) {
    return "Unknown size";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}
function formatInstallModeLabel(mode) {
  switch (mode) {
    case "installed_windows":
      return "Windows Setup Installer (Silent Upgrade)";
    case "portable_windows":
      return "Portable Binary (Atomic Swap)";
    case "portable_unix":
      return "Portable Archive (Atomic Swap)";
    default:
      return "Automatic Verified Update";
  }
}
function computeDownloadPercent(downloaded, total) {
  const cur = Number(downloaded) || 0;
  const max = Number(total) || 0;
  if (cur <= 0 || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(cur / max * 100)));
}

// web/src/studio/studio-modes.ts
var VALID_STUDIO_MODES = [
  "live",
  "wardrobe",
  "tuning"
];
var VALID_TUNING_TABS = [
  "mouth-audio",
  "eyes-head",
  "life-physics"
];
function normalizeStudioMode(raw) {
  const cleaned = (raw || "").trim().toLowerCase();
  if (cleaned === "automations") {
    return "tuning";
  }
  if (VALID_STUDIO_MODES.includes(cleaned)) {
    return cleaned;
  }
  return "live";
}
function normalizeTuningTab(raw) {
  const cleaned = (raw || "").trim().toLowerCase();
  if (VALID_TUNING_TABS.includes(cleaned)) {
    return cleaned;
  }
  return "mouth-audio";
}
function parseStreamerMode(raw) {
  const cleaned = (raw || "").trim().toLowerCase();
  return cleaned === "true" || cleaned === "1" || cleaned === "on";
}
function formatStreamerModeButtonState(enabled) {
  if (enabled) {
    return {
      text: "\u{1F6E1}\uFE0F Streamer Mode: ON",
      title: "Streamer Mode is ON (Webcam video, URLs, ports, webhook links, and local file paths are hidden). Click to turn OFF.",
      activeClass: true
    };
  }
  return {
    text: "\u{1F6E1}\uFE0F Streamer Mode: OFF",
    title: "Turn ON Streamer Mode to hide your raw webcam feed, local file paths, server ports, and webhook URLs on stream.",
    activeClass: false
  };
}
function maskSensitivePath(pathStr, streamerMode, prefix = "") {
  if (!pathStr) {
    return "";
  }
  if (streamerMode) {
    return `${prefix}[Path Hidden in Streamer Mode]`;
  }
  return `${prefix}${pathStr}`;
}
function computeFaceCropTransform(landmarks, prev = null, smoothing = 0.28) {
  const defaultState = {
    cx: 0.5,
    cy: 0.5,
    scale: 1,
    boxW: 0.4,
    boxH: 0.5
  };
  if (!landmarks || landmarks.length === 0) {
    const base = prev ? {
      cx: prev.cx + (0.5 - prev.cx) * smoothing,
      cy: prev.cy + (0.5 - prev.cy) * smoothing,
      scale: prev.scale + (1 - prev.scale) * smoothing,
      boxW: prev.boxW + (0.4 - prev.boxW) * smoothing,
      boxH: prev.boxH + (0.5 - prev.boxH) * smoothing
    } : defaultState;
    return {
      state: base,
      cssTransform: formatMirroredCropCss(base)
    };
  }
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (let i = 0; i < landmarks.length; i++) {
    const pt = landmarks[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const rawCx = Math.max(0.05, Math.min(0.95, (minX + maxX) * 0.5));
  const rawCy = Math.max(0.05, Math.min(0.95, (minY + maxY) * 0.5));
  const rawBoxW = Math.max(0.08, Math.min(1, maxX - minX));
  const rawBoxH = Math.max(0.1, Math.min(1, maxY - minY));
  const boxSpan = Math.max(rawBoxW, rawBoxH, 0.12);
  const rawScale = Math.max(1.2, Math.min(2.8, 0.68 / boxSpan));
  const alpha = Math.max(0.01, Math.min(1, smoothing));
  const next = prev ? {
    cx: prev.cx + (rawCx - prev.cx) * alpha,
    cy: prev.cy + (rawCy - prev.cy) * alpha,
    scale: prev.scale + (rawScale - prev.scale) * alpha,
    boxW: prev.boxW + (rawBoxW - prev.boxW) * alpha,
    boxH: prev.boxH + (rawBoxH - prev.boxH) * alpha
  } : {
    cx: rawCx,
    cy: rawCy,
    scale: rawScale,
    boxW: rawBoxW,
    boxH: rawBoxH
  };
  return {
    state: next,
    cssTransform: formatMirroredCropCss(next)
  };
}
function formatMirroredCropCss(state) {
  const txPct = (0.5 - state.cx) * 100;
  const tyPct = (0.5 - state.cy) * 100;
  const s = Number(state.scale.toFixed(3));
  const tx = Number(txPct.toFixed(2));
  const ty = Number(tyPct.toFixed(2));
  return `scale(${-s}, ${s}) translate(${tx}%, ${ty}%)`;
}

// web/src/studio/index.ts
var multiTabBanner = document.getElementById("multi-tab-banner");
var multiTabMessage = document.getElementById("multi-tab-message");
var multiTabIcon = document.getElementById("multi-tab-icon");
var btnTakeControl = document.getElementById("btn-take-control");
var isSessionActive = true;
var connectedTabsCount = 1;
var video = document.getElementById("webcam");
var canvas = document.getElementById("landmark-canvas");
var canvasCtx = canvas ? canvas.getContext("2d") : null;
var cameraSelect = document.getElementById("camera-select");
var btnToggleCamera = document.getElementById("btn-toggle-camera");
var btnCalibrate = document.getElementById("btn-calibrate");
var btnFaceAutocrop = document.getElementById("btn-face-autocrop");
var trackingStatus = document.getElementById("tracking-status");
var faceAutoCropEnabled = true;
var faceCropState = null;
function applyFaceCropTransform(landmarks) {
  if (!video || !canvas) return;
  if (!faceAutoCropEnabled || !webcamRunning) {
    faceCropState = null;
    video.style.transform = "scale(-1, 1)";
    canvas.style.transform = "scale(-1, 1)";
    return;
  }
  const crop = computeFaceCropTransform(landmarks, faceCropState, 0.28);
  faceCropState = crop.state;
  video.style.transform = crop.cssTransform;
  canvas.style.transform = crop.cssTransform;
}
function updateFaceAutocropButtonUI() {
  if (!btnFaceAutocrop) return;
  btnFaceAutocrop.textContent = faceAutoCropEnabled ? "\u{1F50D} Auto-Zoom: ON" : "\u{1F50D} Auto-Zoom: OFF";
  btnFaceAutocrop.setAttribute("aria-pressed", String(faceAutoCropEnabled));
}
var fpsDisplay = document.getElementById("fps-display");
var micSelect = document.getElementById("mic-select");
var btnToggleMic = document.getElementById("btn-toggle-mic");
var modeSelect = document.getElementById("mode-select");
var settingsModeSelect = document.getElementById("settings-mode-select");
var vuMeterBar = document.getElementById("vu-meter-bar");
var noiseGateMarker = document.getElementById("noise-gate-marker");
var valVuMeter = document.getElementById("val-vu-meter");
var gaugeYaw = document.getElementById("gauge-yaw");
var gaugePitch = document.getElementById("gauge-pitch");
var gaugeRoll = document.getElementById("gauge-roll");
var gaugeDepthZ = document.getElementById("gauge-depth-z");
var valYaw = document.getElementById("val-yaw");
var valPitch = document.getElementById("val-pitch");
var valRoll = document.getElementById("val-roll");
var valDepthZ = document.getElementById("val-depth-z");
var gaugeBlinkL = document.getElementById("gauge-blink-l");
var gaugeBlinkR = document.getElementById("gauge-blink-r");
var valBlinkL = document.getElementById("val-blink-l");
var valBlinkR = document.getElementById("val-blink-r");
var blinkThresholdMarkerL = document.getElementById("blink-threshold-marker-l");
var blinkThresholdMarkerR = document.getElementById("blink-threshold-marker-r");
var gaugeBrowL = document.getElementById("gauge-brow-l");
var gaugeBrowR = document.getElementById("gauge-brow-r");
var valBrowL = document.getElementById("val-brow-l");
var valBrowR = document.getElementById("val-brow-r");
var gaugeMouthOpen = document.getElementById("gauge-mouth-open");
var gaugeSmile = document.getElementById("gauge-smile");
var valSmile = document.getElementById("val-smile");
var smileThresholdMarker = document.getElementById("smile-threshold-marker");
var gaugePuckerPuff = document.getElementById("gauge-pucker-puff");
var valPuckerPuff = document.getElementById("val-pucker-puff");
var gaugeFrownTongue = document.getElementById("gauge-frown-tongue");
var valFrownTongue = document.getElementById("val-frown-tongue");
var sliderMouthGain = document.getElementById("slider-mouth-gain");
var sliderMouthThreshold = document.getElementById("slider-mouth-threshold");
var checkboxEnableSmile = document.getElementById("check-enable-smile");
var sliderSmileThreshold = document.getElementById("slider-smile-threshold");
var checkboxWinkIsBlink = document.getElementById("checkbox-wink-is-blink") || document.getElementById("check-wink-is-blink");
var checkboxStabilizeBlink = document.getElementById("checkbox-stabilize-blink");
var sliderBlinkMaxYaw = document.getElementById("slider-blink-max-yaw");
var valBlinkMaxYaw = document.getElementById("val-blink-max-yaw");
var checkboxAutoBlink = document.getElementById("check-auto-blink");
var selectAutoBlinkMode = document.getElementById("select-auto-blink-mode");
var sliderAutoBlinkInterval = document.getElementById("slider-auto-blink-interval");
var valAutoBlinkInterval = document.getElementById("val-auto-blink-interval");
var checkboxAutoGaze = document.getElementById("check-auto-gaze");
var selectAutoGazeMode = document.getElementById("select-auto-gaze-mode");
var sliderAutoGazeRange = document.getElementById("slider-auto-gaze-range");
var valAutoGazeRange = document.getElementById("val-auto-gaze-range");
var checkboxAutoTilt = document.getElementById("check-auto-tilt");
var selectAutoTiltMode = document.getElementById("select-auto-tilt-mode");
var sliderAutoTiltAmount = document.getElementById("slider-auto-tilt-amount");
var valAutoTiltAmount = document.getElementById("val-auto-tilt-amount");
var checkboxPhysicsEnabled = document.getElementById("check-physics-enabled");
var sliderPhysicsAmount = document.getElementById("slider-physics-amount");
var valPhysicsAmount = document.getElementById("val-physics-amount");
var sliderBlinkThresholdL = document.getElementById("slider-blink-threshold-l");
var sliderBlinkThresholdR = document.getElementById("slider-blink-threshold-r");
var sliderBlinkSyncDelay = document.getElementById("slider-blink-sync-delay");
var sliderEyeGain = document.getElementById("slider-eye-gain");
var sliderBrowGain = document.getElementById("slider-brow-gain");
var sliderYawMultiplier = document.getElementById("slider-yaw-multiplier");
var sliderPitchMultiplier = document.getElementById("slider-pitch-multiplier");
var sliderDepthZoom = document.getElementById("slider-depth-zoom");
var sliderMicGain = document.getElementById("slider-mic-gain");
var sliderNoiseGate = document.getElementById("slider-noise-gate");
var sliderDecaySmooth = document.getElementById("slider-decay-smooth");
var sliderBounceAmount = document.getElementById("slider-bounce-amount");
var valMicGain = document.getElementById("val-mic-gain");
var valNoiseGate = document.getElementById("val-noise-gate");
var valDecaySmooth = document.getElementById("val-decay-smooth");
var valBounceAmount = document.getElementById("val-bounce-amount");
var valMouthGain = document.getElementById("val-mouth-gain");
var valMouthThreshold = document.getElementById("val-mouth-threshold");
var valSmileThreshold = document.getElementById("val-smile-threshold");
var valBlinkThresholdL = document.getElementById("val-blink-threshold-l");
var valBlinkThresholdR = document.getElementById("val-blink-threshold-r");
var valBlinkSyncDelay = document.getElementById("val-blink-sync-delay");
var valEyeGain = document.getElementById("val-eye-gain");
var valBrowGain = document.getElementById("val-brow-gain");
var valYawMultiplier = document.getElementById("val-yaw-multiplier");
var valPitchMultiplier = document.getElementById("val-pitch-multiplier");
var valDepthZoom = document.getElementById("val-depth-zoom");
var btnSaveSettings = document.getElementById("btn-save-settings");
var btnResetSettings = document.getElementById("btn-reset-settings");
var saveStatus = document.getElementById("save-status");
var configPathDisplay = document.getElementById("config-path-display");
var faceLandmarker = null;
var webcamRunning = false;
var currentVideoStream = null;
var pendingLoadedDataHandler = null;
var socket = null;
var reconnectTimer = null;
var lastVideoTime = -1;
var frameCount = 0;
var lastFpsTime = performance.now();
var drawingUtils = null;
var isProcessing = false;
var animFrameId = null;
var tickerWorker = null;
var audioContext = null;
var micStream = null;
var micSource = null;
var analyserNode = null;
var audioDataArray = null;
var freqDataArray = null;
var rmsHistory = [];
var micRunning = false;
var smoothedAudioVol = 0;
var gaugeVoicePitch = document.getElementById("gauge-voice-pitch");
var valVoiceViseme = document.getElementById("val-voice-viseme");
var latestRawPose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
var latestRawBlendshapes = {};
var lastRafProcessTime = 0;
function initTickerWorker() {
  if (tickerWorker) return;
  try {
    const workerBlob = new Blob(
      [
        `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (!timer) {
            timer = setInterval(function() {
              self.postMessage('tick');
            }, 16);
          }
        } else if (e.data === 'stop') {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      };
    `
      ],
      { type: "application/javascript" }
    );
    tickerWorker = new Worker(URL.createObjectURL(workerBlob));
    tickerWorker.onmessage = () => {
      const rafStalled = performance.now() - lastRafProcessTime > 45;
      if (webcamRunning) {
        if (document.hidden || rafStalled) {
          processFrame(false);
        }
      } else {
        if (document.hidden || rafStalled) {
          processCameraOffFrame(false);
        }
      }
    };
    tickerWorker.postMessage("start");
  } catch (err) {
    console.warn("[Studio Tracker] Could not initialize background worker ticker:", err);
  }
}
function getOrCreateAudioContext() {
  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
  } catch (e) {
    console.warn("[Studio Tracker] Web Audio keep-alive error:", e);
  }
  return audioContext;
}
async function populateAudioDevices() {
  try {
    const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
    const currentVal = micSelect && micSelect.value ? micSelect.value : savedMic;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter((d) => d.kind === "audioinput");
    if (!micSelect) return;
    if (audioDevices.length === 0) {
      micSelect.innerHTML = '<option value="">Default Microphone</option>';
      return;
    }
    const hasRealLabels = micSelect.options.length > 0 && micSelect.options[0].textContent && !micSelect.options[0].textContent.startsWith("Microphone 1");
    if (micSelect.options.length === audioDevices.length && hasRealLabels) {
      if (currentVal) micSelect.value = currentVal;
      return;
    }
    micSelect.innerHTML = "";
    audioDevices.forEach((device, i) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${i + 1}`;
      if (currentVal && device.deviceId === currentVal) {
        option.selected = true;
      }
      micSelect.appendChild(option);
    });
    if (currentVal) {
      micSelect.value = currentVal;
    }
  } catch (err) {
    console.warn("[Studio Tracker] Could not enumerate audio devices:", err);
  }
}
function getCurrentMode() {
  const val = modeSelect?.value || settingsModeSelect?.value || activeSettings?.audio?.mode;
  if (val === "camera" || val === "audio") return val;
  return "hybrid";
}
function updateCameraUI() {
  const mode = getCurrentMode();
  const btnState = getCameraButtonState(webcamRunning, mode);
  if (btnToggleCamera) {
    btnToggleCamera.textContent = btnState.text;
    btnToggleCamera.disabled = btnState.disabled;
    btnToggleCamera.title = btnState.title;
    if (btnState.isDanger) {
      btnToggleCamera.classList.add("btn-danger");
    } else {
      btnToggleCamera.classList.remove("btn-danger");
    }
  }
  const bannerState = computeSessionBannerState(isSessionActive, connectedTabsCount);
  if (bannerState.statusText && bannerState.statusClass) {
    updateStatus(bannerState.statusText, bannerState.statusClass);
  } else {
    const status = getCameraStatus(webcamRunning, micRunning, mode);
    updateStatus(status.text, status.className);
  }
}
function applyMode(mode, save = true) {
  if (modeSelect) modeSelect.value = mode;
  if (settingsModeSelect) settingsModeSelect.value = mode;
  const isAudio = mode === "audio";
  if (isAudio) {
    if (webcamRunning) {
      stopCamera();
    } else {
      updateCameraUI();
    }
    if (cameraSelect) cameraSelect.disabled = true;
  } else {
    if (cameraSelect) cameraSelect.disabled = false;
    updateCameraUI();
  }
  if (save) {
    const current = collectSettingsFromUI();
    debouncedSaveSettings(current);
  }
}
async function toggleMic() {
  if (micRunning) {
    stopMic();
    return;
  }
  await startMic();
}
async function startMic() {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  const savedMic = localStorage.getItem("svgtuber_mic_id") || "";
  const deviceId = micSelect && micSelect.value ? micSelect.value : savedMic;
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      });
    } catch (e) {
      if (deviceId) {
        console.warn("[Studio Tracker] Exact mic failed, falling back to default:", e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        throw e;
      }
    }
    micStream = stream;
    micSource = ctx.createMediaStreamSource(micStream);
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.25;
    micSource.connect(analyserNode);
    audioDataArray = new Float32Array(analyserNode.fftSize);
    freqDataArray = new Uint8Array(analyserNode.frequencyBinCount);
    rmsHistory = [];
    micRunning = true;
    localStorage.setItem("svgtuber_mic_active", "true");
    if (micSelect && micSelect.value) {
      localStorage.setItem("svgtuber_mic_id", micSelect.value);
    }
    if (btnToggleMic) {
      btnToggleMic.textContent = "Stop Mic";
      btnToggleMic.classList.add("btn-danger");
    }
    await populateAudioDevices();
    if (tickerWorker) {
      tickerWorker.postMessage("start");
    }
    if (!webcamRunning) {
      updateCameraUI();
      startCameraOffLoop();
    }
  } catch (err) {
    console.error("[Studio Tracker] Microphone access error:", err);
    updateStatus(`Mic error: ${err.message}`, "status-warn");
  }
}
function stopMic() {
  micRunning = false;
  localStorage.setItem("svgtuber_mic_active", "false");
  if (micSource) {
    try {
      micSource.disconnect();
    } catch (e) {
    }
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  analyserNode = null;
  audioDataArray = null;
  freqDataArray = null;
  rmsHistory = [];
  smoothedAudioVol = 0;
  if (btnToggleMic) {
    btnToggleMic.textContent = "Start Mic";
    btnToggleMic.classList.remove("btn-danger");
  }
  if (vuMeterBar) vuMeterBar.style.width = "0%";
  if (valVuMeter) valVuMeter.textContent = "0%";
  if (gaugeVoicePitch) gaugeVoicePitch.style.width = "0%";
  if (valVoiceViseme) valVoiceViseme.textContent = "SIL";
  if (!webcamRunning) {
    updateCameraUI();
    startCameraOffLoop();
  }
}
function sampleAudio(opticalHints) {
  if (!micRunning || !analyserNode || !audioDataArray) {
    return null;
  }
  analyserNode.getFloatTimeDomainData(audioDataArray);
  const rms = calculateRMS(audioDataArray);
  const decay = parseFloat(sliderDecaySmooth?.value || "0.10");
  smoothedAudioVol = stepAudioVolume(smoothedAudioVol, rms, decay);
  const micGain = parseFloat(sliderMicGain?.value || "1.5");
  const noiseGate = parseFloat(sliderNoiseGate?.value || "0.04");
  const isSpeaking = evaluateSpeechGate(smoothedAudioVol, micGain, noiseGate);
  rmsHistory.push(rms);
  if (rmsHistory.length > 24) {
    rmsHistory.shift();
  }
  let pitch = 0;
  let pitchHz = 0;
  let viseme = "sil";
  let visemeA = 0;
  let visemeI = 0;
  let visemeU = 0;
  let visemeE = 0;
  let visemeO = 0;
  if (isSpeaking && freqDataArray) {
    analyserNode.getByteFrequencyData(freqDataArray);
    const neutralPitchHz = activeSettings?.tracking?.calibration?.neutralPitchHz || 165;
    const spec = analyzeAudioSpectrum(
      freqDataArray,
      audioContext?.sampleRate || 48e3,
      isSpeaking,
      neutralPitchHz,
      opticalHints
    );
    pitch = spec.pitch;
    pitchHz = spec.pitchHz;
    viseme = spec.viseme;
    visemeA = spec.visemeA;
    visemeI = spec.visemeI;
    visemeU = spec.visemeU;
    visemeE = spec.visemeE;
    visemeO = spec.visemeO;
  }
  const { isShouting, isLaughing } = detectShoutAndLaugh(
    smoothedAudioVol,
    micGain,
    noiseGate,
    rmsHistory,
    opticalHints?.smile || 0
  );
  return {
    active: true,
    volume: smoothedAudioVol,
    isSpeaking,
    pitch,
    pitchHz,
    viseme,
    visemeA,
    visemeI,
    visemeU,
    visemeE,
    visemeO,
    isShouting,
    isLaughing
  };
}
function updateAudioUI(audioState) {
  if (!vuMeterBar || !valVuMeter) return;
  if (!audioState || !audioState.active) {
    vuMeterBar.style.width = "0%";
    valVuMeter.textContent = "0%";
    vuMeterBar.style.background = "#4b5563";
    if (gaugeVoicePitch) gaugeVoicePitch.style.width = "0%";
    if (valVoiceViseme) valVoiceViseme.textContent = "SIL";
    return;
  }
  const micGain = parseFloat(sliderMicGain?.value || "1.5");
  const noiseGate = parseFloat(sliderNoiseGate?.value || "0.04");
  const displayPercent = Math.min(100, Math.round(audioState.volume * micGain * 100));
  vuMeterBar.style.width = `${displayPercent}%`;
  valVuMeter.textContent = `${displayPercent}%`;
  if (audioState.isShouting) {
    vuMeterBar.style.background = "#f43f5e";
  } else if (audioState.isSpeaking) {
    vuMeterBar.style.background = "#22c55e";
  } else {
    vuMeterBar.style.background = "#4b5563";
  }
  if (gaugeVoicePitch) {
    const pitchPct = audioState.isSpeaking ? Math.round((audioState.pitch || 0) * 100) : 0;
    gaugeVoicePitch.style.width = `${pitchPct}%`;
  }
  if (valVoiceViseme) {
    if (!audioState.isSpeaking) {
      valVoiceViseme.textContent = "SIL";
    } else {
      const vLabel = (audioState.viseme || "A").toUpperCase();
      const tag = audioState.isLaughing ? "\u{1F602} " : audioState.isShouting ? "\u{1F525} " : "";
      valVoiceViseme.textContent = `${tag}${vLabel}`;
    }
  }
  if (noiseGateMarker) {
    const gatePercent = Math.min(100, Math.round(noiseGate * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}
var cameraOffAnimId = null;
function startCameraOffLoop() {
  if (cameraOffAnimId) cancelAnimationFrame(cameraOffAnimId);
  function cameraOffLoop() {
    if (webcamRunning) {
      cameraOffAnimId = null;
      return;
    }
    if (!document.hidden) {
      processCameraOffFrame(true);
    }
    cameraOffAnimId = requestAnimationFrame(cameraOffLoop);
  }
  cameraOffAnimId = requestAnimationFrame(cameraOffLoop);
}
function processCameraOffFrame(renderUI = true) {
  const now = performance.now();
  const audioState = sampleAudio();
  if (renderUI && audioState) {
    updateAudioUI(audioState);
  }
  if (isSessionActive && socket && socket.readyState === WebSocket.OPEN) {
    const frame = {
      timestamp: now,
      present: false,
      audio: audioState
    };
    socket.send(JSON.stringify(frame));
  }
}
var isCalibratePopout = new URLSearchParams(window.location.search).has("calibrate");
var calibrationChannel = null;
var lastBroadcastSampleTime = 0;
try {
  if (typeof BroadcastChannel !== "undefined") {
    calibrationChannel = new BroadcastChannel("svgtuber_calibration");
  }
} catch {
}
function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const roleParam = isCalibratePopout && !webcamRunning ? "?role=control" : "";
  const wsUrl = `${protocol}//${location.host}/ws/tracker${roleParam}`;
  socket = new WebSocket(wsUrl);
  socket.onopen = () => {
    console.log("[Studio Tracker] Connected to Go server.");
    if (!webcamRunning) {
      updateCameraUI();
      startCameraOffLoop();
    }
  };
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "calibrated") {
        console.log("[Studio Tracker] Calibration confirmed by server.");
        showCalibratedFlash();
      } else if (msg.type === "expression_update") {
        activeExpressions = msg.expressions || {};
        updateExpressionButtonsUI();
      } else if (msg.type === "accessory_update") {
        configuredAccessories = msg.accessories || [];
        renderAccessoriesUI();
        loadExpressions();
      } else if (msg.type === "rig_update") {
        loadExpressions();
        loadAccessories();
      } else if (msg.type === "session_status") {
        handleSessionStatus(Boolean(msg.isActive), Number(msg.connectedTabs) || 1);
      } else if (msg.type === "avatar_swapped") {
        loadAvatars();
        loadExpressions();
        loadAccessories();
        reloadAvatarFrame();
      } else if (msg.type === "mode_update") {
        if (msg.settings) {
          activeSettings = msg.settings;
          syncSettingsToUI(activeSettings);
        }
        if (typeof msg.mode === "string") {
          applyMode(msg.mode, false);
        }
        if (typeof msg.streamerMode === "boolean" && msg.streamerMode !== streamerModeEnabled) {
          applyStreamerMode(msg.streamerMode, true, false);
        }
      } else if (msg.type === "cal_sample" && msg.face) {
        lastBroadcastSampleTime = performance.now();
        const f = msg.face;
        ingestCalibrationSample({
          timestamp: performance.now(),
          present: Boolean(f.present),
          yaw: f.yaw || 0,
          pitch: f.pitch || 0,
          roll: f.roll || 0,
          x: f.x || 0,
          y: f.y || 0,
          z: f.z || 0,
          blendshapes: f.blendshapes || {},
          audioVolume: f.audio?.volume || 0,
          audioPitchHz: f.audio?.pitchHz || 0
        });
      } else if (msg.type === "update_progress") {
        handleUpdateProgress(msg);
      }
    } catch (e) {
    }
  };
  socket.onclose = () => {
    handleSessionStatus(true, 1);
    updateStatus("Server Disconnected", "status-error");
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2e3);
    }
  };
  socket.onerror = (err) => {
    console.error("[Studio Tracker] WebSocket error:", err);
    socket?.close();
  };
}
function updateStatus(text, className) {
  if (trackingStatus) {
    trackingStatus.textContent = text;
    trackingStatus.className = `status-badge ${className}`;
  }
}
function handleSessionStatus(isActive, connectedTabs) {
  isSessionActive = isActive;
  connectedTabsCount = connectedTabs;
  const state = computeSessionBannerState(isActive, connectedTabs);
  if (multiTabBanner) {
    multiTabBanner.style.display = state.showBanner ? "flex" : "none";
    if (isActive) {
      multiTabBanner.classList.add("is-active");
    } else {
      multiTabBanner.classList.remove("is-active");
    }
  }
  if (multiTabMessage) {
    multiTabMessage.textContent = state.message;
  }
  if (multiTabIcon) {
    multiTabIcon.textContent = isActive ? "\u2139\uFE0F" : "\u26A0\uFE0F";
  }
  if (btnTakeControl) {
    btnTakeControl.style.display = state.showTakeOver ? "inline-block" : "none";
  }
  updateCameraUI();
}
function showCalibratedFlash() {
  if (btnCalibrate) {
    btnCalibrate.textContent = "\u2713 Calibrated!";
    btnCalibrate.style.background = "#22c55e";
    setTimeout(() => {
      btnCalibrate.textContent = "Set Neutral Pose";
      btnCalibrate.style.background = "";
    }, 1200);
  }
}
async function fetchAppVersion() {
  try {
    const res = await fetch("/api/version");
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById("app-version");
      if (el && data.version) {
        el.textContent = data.version.startsWith("v") ? data.version : `v${data.version}`;
        if (data.commit && data.commit !== "none") {
          el.title = `Commit: ${data.commit}
Built: ${data.date || "unknown"}`;
        }
      }
    }
  } catch (err) {
    console.debug("[Studio] Could not fetch /api/version:", err);
  }
  checkForUpdates(true);
}
var btnUpdateBadge = document.getElementById("btn-update-badge");
var btnCheckUpdate = document.getElementById("btn-check-update");
var updateModal = document.getElementById("update-modal");
var btnCloseUpdateModal = document.getElementById("btn-close-update-modal");
var btnCancelUpdate = document.getElementById("btn-cancel-update");
var btnApplyUpdate = document.getElementById("btn-apply-update");
var updateModalTitle = document.getElementById("update-modal-title");
var updateVersionCompare = document.getElementById("update-version-compare");
var updateModeBadge = document.getElementById("update-mode-badge");
var updateAssetInfo = document.getElementById("update-asset-info");
var updateReleaseNotes = document.getElementById("update-release-notes");
var updateGithubLink = document.getElementById("update-github-link");
var updateProgressContainer = document.getElementById("update-progress-container");
var updateProgressStatus = document.getElementById("update-progress-status");
var updateProgressPercent = document.getElementById("update-progress-percent");
var updateProgressBar = document.getElementById("update-progress-bar");
var cachedUpdateInfo = null;
async function checkForUpdates(silent = false) {
  if (!silent && btnCheckUpdate) {
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = "\u23F3 Checking...";
  }
  try {
    const res = await fetch("/api/update/check");
    if (!res.ok) {
      if (!silent) {
        const errData = await res.json().catch(() => ({}));
        alert(`Update check failed: ${errData.error || res.statusText}`);
      }
      return;
    }
    const info = await res.json();
    cachedUpdateInfo = info;
    if (info.updateAvailable && btnUpdateBadge) {
      btnUpdateBadge.textContent = formatUpdateBadgeText(info.latestVersion);
      btnUpdateBadge.style.display = "inline-flex";
    } else if (btnUpdateBadge) {
      btnUpdateBadge.style.display = "none";
    }
    if (!silent) {
      openUpdateModal(info);
    }
  } catch (err) {
    if (!silent) {
      alert(`Could not check for updates: ${err?.message || err}`);
    }
  } finally {
    if (!silent && btnCheckUpdate) {
      btnCheckUpdate.disabled = false;
      btnCheckUpdate.textContent = "\u{1F504} Check for Updates";
    }
  }
}
function openUpdateModal(info) {
  if (!updateModal) return;
  const curVer = normalizeVersionTag(info.currentVersion);
  const latVer = normalizeVersionTag(info.latestVersion);
  if (updateModalTitle) {
    updateModalTitle.textContent = info.updateAvailable ? `Update Available: SVGTuber ${latVer}` : `SVGTuber ${curVer} is Up to Date`;
  }
  if (updateVersionCompare) {
    updateVersionCompare.textContent = info.updateAvailable ? `${curVer} \u2192 ${latVer}` : `${curVer} (Latest)`;
  }
  if (updateModeBadge) {
    updateModeBadge.textContent = formatInstallModeLabel(info.installMode);
  }
  if (updateAssetInfo) {
    if (info.assetName) {
      updateAssetInfo.textContent = `Asset: ${info.assetName} (${formatAssetSize(info.assetSize)})`;
      updateAssetInfo.style.display = "block";
    } else {
      updateAssetInfo.style.display = "none";
    }
  }
  if (updateReleaseNotes) {
    updateReleaseNotes.textContent = info.releaseNotes || "No release notes provided for this version.";
  }
  if (updateGithubLink && info.htmlUrl) {
    updateGithubLink.href = info.htmlUrl;
  }
  if (updateProgressContainer) {
    updateProgressContainer.style.display = "none";
  }
  if (btnApplyUpdate) {
    btnApplyUpdate.disabled = !info.updateAvailable;
    btnApplyUpdate.textContent = info.updateAvailable ? "\u2B07 Install Update & Restart" : "\u2713 Already Up to Date";
    btnApplyUpdate.style.display = info.updateAvailable ? "inline-block" : "none";
  }
  updateModal.style.display = "flex";
}
function closeUpdateModal() {
  if (updateModal) {
    updateModal.style.display = "none";
  }
}
function handleUpdateProgress(msg) {
  if (!updateProgressContainer) return;
  updateProgressContainer.style.display = "flex";
  if (msg.stage === "applying") {
    if (updateProgressStatus) {
      updateProgressStatus.textContent = "\u2713 SHA-256 verified! Applying update & restarting...";
    }
    if (updateProgressPercent) updateProgressPercent.textContent = "100%";
    if (updateProgressBar) updateProgressBar.style.width = "100%";
    return;
  }
  const pct = computeDownloadPercent(msg.downloaded, msg.total);
  if (updateProgressStatus) {
    updateProgressStatus.textContent = `Downloading & verifying SHA-256 (${formatAssetSize(msg.downloaded)} / ${formatAssetSize(msg.total)})...`;
  }
  if (updateProgressPercent) updateProgressPercent.textContent = `${pct}%`;
  if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
}
async function applyVerifiedUpdate() {
  if (!btnApplyUpdate) return;
  btnApplyUpdate.disabled = true;
  btnApplyUpdate.textContent = "\u23F3 Downloading & Verifying...";
  if (updateProgressContainer) {
    updateProgressContainer.style.display = "flex";
  }
  if (updateProgressStatus) {
    updateProgressStatus.textContent = "Fetching checksums.txt & release asset...";
  }
  if (updateProgressPercent) updateProgressPercent.textContent = "0%";
  if (updateProgressBar) updateProgressBar.style.width = "0%";
  try {
    const res = await fetch("/api/update/apply", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || res.statusText);
    }
    if (updateProgressStatus) {
      updateProgressStatus.textContent = "\u2713 Update applied! Waiting for SVGTuber server to restart...";
    }
    if (updateProgressPercent) updateProgressPercent.textContent = "100%";
    if (updateProgressBar) updateProgressBar.style.width = "100%";
    btnApplyUpdate.textContent = "\u2713 Restarting...";
    setTimeout(() => {
      window.location.reload();
    }, 3500);
  } catch (err) {
    if (updateProgressStatus) {
      updateProgressStatus.textContent = `\u274C Update failed: ${err?.message || err}`;
    }
    btnApplyUpdate.disabled = false;
    btnApplyUpdate.textContent = "Retry Update";
  }
}
if (btnUpdateBadge) {
  btnUpdateBadge.addEventListener("click", () => {
    if (cachedUpdateInfo) {
      openUpdateModal(cachedUpdateInfo);
    } else {
      checkForUpdates(false);
    }
  });
}
if (btnCheckUpdate) {
  btnCheckUpdate.addEventListener("click", () => checkForUpdates(false));
}
if (btnCloseUpdateModal) {
  btnCloseUpdateModal.addEventListener("click", closeUpdateModal);
}
if (btnCancelUpdate) {
  btnCancelUpdate.addEventListener("click", closeUpdateModal);
}
if (btnApplyUpdate) {
  btnApplyUpdate.addEventListener("click", applyVerifiedUpdate);
}
async function initMediaPipe() {
  try {
    updateStatus("Loading MediaPipe AI Model...", "status-warn");
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
    if (canvasCtx) {
      drawingUtils = new DrawingUtils(canvasCtx);
    }
    console.log("[Studio Tracker] MediaPipe FaceLandmarker initialized.");
    updateStatus("Model Ready. Start Camera.", "status-ok");
    if (btnToggleCamera) btnToggleCamera.disabled = false;
    initTickerWorker();
    fetchAppVersion();
    await populateCameraDevices();
    await populateAudioDevices();
    const currentMode = getCurrentMode();
    const cameraActive = localStorage.getItem("svgtuber_camera_active");
    if (isCalibratePopout) {
      updateCameraUI();
      startCameraOffLoop();
      setTimeout(() => {
        if (performance.now() - lastBroadcastSampleTime > 650 && !webcamRunning) {
          console.log("[Studio Calibration] No BroadcastChannel stream detected; starting camera in pop-out.");
          startCamera().catch((e) => console.warn("[Studio Calibration] Pop-out camera warning:", e));
        }
      }, 700);
    } else if (shouldAutoStartCamera(currentMode, cameraActive)) {
      console.log("[Studio Tracker] Auto-starting camera stream on load...");
      startCamera().catch((e) => {
        console.warn("[Studio Tracker] Auto-start camera warning:", e);
        updateCameraUI();
        startCameraOffLoop();
      });
    } else {
      updateCameraUI();
      startCameraOffLoop();
    }
  } catch (err) {
    console.error("[Studio Tracker] Failed to initialize MediaPipe:", err);
    updateStatus(`Error loading AI model: ${err.message}`, "status-error");
  }
}
async function populateCameraDevices() {
  try {
    const savedCam = localStorage.getItem("svgtuber_camera_id") || "";
    const currentVal = cameraSelect && cameraSelect.value ? cameraSelect.value : savedCam;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    if (!cameraSelect || videoDevices.length === 0) return;
    const hasRealLabels = cameraSelect.options.length > 0 && cameraSelect.options[0].textContent && !cameraSelect.options[0].textContent.startsWith("Camera 1");
    if (cameraSelect.options.length === videoDevices.length && hasRealLabels) {
      if (currentVal) cameraSelect.value = currentVal;
      return;
    }
    cameraSelect.innerHTML = "";
    videoDevices.forEach((device, i) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${i + 1}`;
      if (currentVal && device.deviceId === currentVal) {
        option.selected = true;
      }
      cameraSelect.appendChild(option);
    });
    if (currentVal) {
      cameraSelect.value = currentVal;
    }
  } catch (err) {
    console.warn("[Studio Tracker] Could not enumerate camera devices:", err);
  }
}
async function switchCamera(deviceId) {
  if (!webcamRunning) {
    return;
  }
  updateStatus("Switching Camera...", "status-warn");
  try {
    await startCamera(deviceId);
  } catch (err) {
    console.error("[Studio Tracker] Error switching camera:", err);
    stopCamera();
    updateStatus(`Camera switch failed: ${err.message}`, "status-error");
  }
}
async function startCamera(deviceId = null) {
  if (!video) return;
  if (!isCameraAllowedInMode(getCurrentMode())) {
    console.log("[Studio Tracker] Camera start ignored: Audio Only mode is active");
    return;
  }
  if (pendingLoadedDataHandler && video) {
    video.removeEventListener("loadeddata", pendingLoadedDataHandler);
    pendingLoadedDataHandler = null;
  }
  if (currentVideoStream) {
    currentVideoStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (e) {
      }
    });
    currentVideoStream = null;
  }
  if (video.srcObject) {
    try {
      video.srcObject.getTracks().forEach((t) => t.stop());
    } catch (e) {
    }
    video.srcObject = null;
  }
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  const savedCam = localStorage.getItem("svgtuber_camera_id") || "";
  const targetId = deviceId || cameraSelect && cameraSelect.value || savedCam;
  let stream;
  try {
    const constraints = {
      video: targetId ? {
        deviceId: { exact: targetId },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 60 }
      } : {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 60 }
      }
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (targetId) {
      console.warn("[Studio Tracker] Exact camera failed, falling back to default:", err);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }
      });
    } else {
      throw err;
    }
  }
  currentVideoStream = stream;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    console.warn("[Studio Tracker] video.play() warning:", e);
  }
  const onLoaded = () => {
    pendingLoadedDataHandler = null;
    if (!currentVideoStream || !isCameraAllowedInMode(getCurrentMode())) {
      return;
    }
    webcamRunning = true;
    localStorage.setItem("svgtuber_camera_active", "true");
    const effectiveId = targetId || cameraSelect && cameraSelect.value;
    if (effectiveId) {
      localStorage.setItem("svgtuber_camera_id", effectiveId);
      if (cameraSelect) cameraSelect.value = effectiveId;
    }
    updateCameraUI();
    if (canvas && video) {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      canvas.width = vw;
      canvas.height = vh;
      video.style.aspectRatio = `${vw} / ${vh}`;
      canvas.style.aspectRatio = `${vw} / ${vh}`;
    }
    populateCameraDevices();
    populateAudioDevices();
    getOrCreateAudioContext();
    if (tickerWorker) {
      tickerWorker.postMessage("start");
    }
    const micActive = localStorage.getItem("svgtuber_mic_active");
    if (micActive === "true" && !micRunning) {
      startMic().catch((e) => console.warn("[Studio Tracker] Auto-restore mic:", e));
    }
    if (cameraOffAnimId) {
      cancelAnimationFrame(cameraOffAnimId);
      cameraOffAnimId = null;
    }
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(predictLoop);
  };
  if (video.readyState >= 2 && video.videoWidth > 0) {
    onLoaded();
  } else {
    pendingLoadedDataHandler = onLoaded;
    video.addEventListener("loadeddata", onLoaded, { once: true });
  }
}
function stopCamera() {
  webcamRunning = false;
  localStorage.setItem("svgtuber_camera_active", "false");
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (pendingLoadedDataHandler && video) {
    video.removeEventListener("loadeddata", pendingLoadedDataHandler);
    pendingLoadedDataHandler = null;
  }
  startCameraOffLoop();
  if (currentVideoStream) {
    currentVideoStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (e) {
      }
    });
    currentVideoStream = null;
  }
  if (video) {
    try {
      video.pause();
    } catch (e) {
    }
    if (video.srcObject) {
      try {
        video.srcObject.getTracks().forEach((t) => t.stop());
      } catch (e) {
      }
      video.srcObject = null;
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch (e) {
    }
  }
  if (fpsDisplay) {
    fpsDisplay.textContent = "0 FPS";
  }
  frameCount = 0;
  updateCameraUI();
  applyFaceCropTransform(null);
  if (canvasCtx && canvas) {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
  resetTrackingGauges();
  sendTrackingLoss(sampleAudio());
}
async function toggleCamera() {
  if (!isCameraAllowedInMode(getCurrentMode())) {
    return;
  }
  if (webcamRunning) {
    stopCamera();
    return;
  }
  try {
    await startCamera();
  } catch (err) {
    console.error("[Studio Tracker] Camera access error:", err);
    updateStatus(`Camera access denied: ${err.message}`, "status-error");
  }
}
var tongueSampleCanvas = null;
var tongueSampleCtx = null;
function sampleOpticalTongueFromVideo(vid, landmarks, mouthGapRatio, jawOpen) {
  if (jawOpen < 0.08 && mouthGapRatio < 0.045) {
    return 0;
  }
  const vw = vid.videoWidth;
  const vh = vid.videoHeight;
  if (!vw || !vh || !landmarks || landmarks.length < 309) {
    return 0;
  }
  if (!tongueSampleCanvas) {
    tongueSampleCanvas = document.createElement("canvas");
    tongueSampleCanvas.width = 4;
    tongueSampleCanvas.height = 4;
    tongueSampleCtx = tongueSampleCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!tongueSampleCtx) return 0;
  try {
    const upperInner = landmarks[13];
    const lowerInner = landmarks[14];
    const lowerOuter = landmarks[17];
    const cheekL = landmarks[50];
    const cheekR = landmarks[280];
    const cavX = Math.max(2, Math.min(vw - 4, Math.round((upperInner.x + lowerInner.x) * 0.5 * vw)));
    const cavY = Math.max(
      2,
      Math.min(vh - 4, Math.round((upperInner.y * 0.35 + lowerInner.y * 0.4 + lowerOuter.y * 0.25) * vh))
    );
    tongueSampleCtx.drawImage(vid, cavX - 2, cavY - 2, 4, 4, 0, 0, 2, 2);
    const skinX = Math.max(2, Math.min(vw - 4, Math.round((cheekL.x + cheekR.x) * 0.5 * vw)));
    const skinY = Math.max(2, Math.min(vh - 4, Math.round((cheekL.y + cheekR.y) * 0.5 * vh)));
    tongueSampleCtx.drawImage(vid, skinX - 2, skinY - 2, 4, 4, 2, 0, 2, 2);
    const data = tongueSampleCtx.getImageData(0, 0, 4, 2).data;
    const cav = { r: 0, g: 0, b: 0 };
    const skin = { r: 0, g: 0, b: 0 };
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const ci = (y * 4 + x) * 4;
        cav.r += data[ci];
        cav.g += data[ci + 1];
        cav.b += data[ci + 2];
        const si = (y * 4 + (x + 2)) * 4;
        skin.r += data[si];
        skin.g += data[si + 1];
        skin.b += data[si + 2];
      }
    }
    cav.r /= 4;
    cav.g /= 4;
    cav.b /= 4;
    skin.r /= 4;
    skin.g /= 4;
    skin.b /= 4;
    return evaluateOpticalTongue(cav, skin, mouthGapRatio, jawOpen);
  } catch {
    return 0;
  }
}
function processFrame(renderUI = true) {
  if (!webcamRunning || !faceLandmarker || isProcessing || !video) return;
  const now = performance.now();
  if (video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;
  isProcessing = true;
  try {
    const results = faceLandmarker.detectForVideo(video, now);
    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      const blendshapes = {};
      if (results.faceBlendshapes && results.faceBlendshapes[0]) {
        results.faceBlendshapes[0].categories.forEach((c) => {
          blendshapes[c.categoryName] = c.score;
        });
      }
      const ear = computeEyeAspectRatios(landmarks);
      if (ear) {
        blendshapes.earBlinkLeft = ear.earBlinkLeft;
        blendshapes.earBlinkRight = ear.earBlinkRight;
      }
      const mouthGeo = computeMouthGeometry(landmarks);
      if (mouthGeo) {
        blendshapes.geoFrownLeft = mouthGeo.geoFrownLeft;
        blendshapes.geoFrownRight = mouthGeo.geoFrownRight;
        const optTongue = sampleOpticalTongueFromVideo(
          video,
          landmarks,
          mouthGeo.mouthGapRatio,
          blendshapes.jawOpen || 0
        );
        if (optTongue > (blendshapes.tongueOut || 0)) {
          blendshapes.tongueOut = optTongue;
        }
      }
      let pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes[0]) {
        pose = extractEulerAngles(results.facialTransformationMatrixes[0].data);
      }
      const audioState = sampleAudio({
        mouthOpen: blendshapes.jawOpen || 0,
        mouthPucker: Math.max(blendshapes.mouthPucker || 0, (blendshapes.mouthFunnel || 0) * 0.75),
        smile: ((blendshapes.mouthSmileLeft || 0) + (blendshapes.mouthSmileRight || 0)) * 0.5
      });
      if (renderUI) {
        updateAudioUI(audioState);
      }
      const calSample = {
        timestamp: now,
        present: true,
        yaw: pose.yaw,
        pitch: pose.pitch,
        roll: pose.roll,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        blendshapes,
        audioVolume: audioState?.volume || 0,
        audioPitchHz: audioState?.pitchHz || 0
      };
      ingestCalibrationSample(calSample);
      if (calibrationChannel && !isCalibratePopout) {
        try {
          calibrationChannel.postMessage({ type: "sample", sample: calSample });
        } catch {
        }
      }
      if (isSessionActive && socket && socket.readyState === WebSocket.OPEN) {
        const frame = {
          timestamp: now,
          present: true,
          yaw: pose.yaw,
          pitch: pose.pitch,
          roll: pose.roll,
          x: pose.x,
          y: pose.y,
          z: pose.z,
          blendshapes,
          audio: audioState || void 0
        };
        socket.send(JSON.stringify(frame));
      }
      latestRawPose = pose;
      latestRawBlendshapes = blendshapes;
      if (renderUI) {
        updateTrackingGauges(pose, blendshapes);
        applyFaceCropTransform(landmarks);
        drawLandmarks(landmarks);
      }
    } else {
      const audioState = sampleAudio();
      if (renderUI) {
        updateAudioUI(audioState);
      }
      if (isSessionActive && socket && socket.readyState === WebSocket.OPEN) {
        const frame = {
          timestamp: now,
          present: false,
          audio: audioState || void 0
        };
        socket.send(JSON.stringify(frame));
      }
      if (renderUI) {
        applyFaceCropTransform(null);
        if (canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        resetTrackingGauges();
      }
    }
  } catch (err) {
    console.error("[Studio Tracker] Detection error:", err);
  } finally {
    isProcessing = false;
  }
}
function predictLoop() {
  if (!webcamRunning) return;
  lastRafProcessTime = performance.now();
  processFrame(true);
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1e3) {
    const fps = Math.round(frameCount * 1e3 / (now - lastFpsTime));
    if (fpsDisplay) fpsDisplay.textContent = `${fps} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }
  animFrameId = requestAnimationFrame(predictLoop);
}
function drawLandmarks(landmarks) {
  if (!canvasCtx || !canvas || !drawingUtils) return;
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#38bdf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#38bdf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, { color: "#818cf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, { color: "#818cf8", lineWidth: 1.5 });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#f43f5e", lineWidth: 1.5 });
  canvasCtx.restore();
}
function updateTrackingGauges(pose, blendshapes) {
  if (valYaw) valYaw.textContent = `${pose.yaw > 0 ? "+" : ""}${pose.yaw.toFixed(1)}\xB0`;
  if (valPitch) valPitch.textContent = `${pose.pitch > 0 ? "+" : ""}${pose.pitch.toFixed(1)}\xB0`;
  if (valRoll) valRoll.textContent = `${pose.roll > 0 ? "+" : ""}${pose.roll.toFixed(1)}\xB0`;
  const cal = activeSettings?.tracking?.calibration;
  const fusedBlinkL = fuseBlinkScoreClient(blendshapes.eyeBlinkLeft || 0, blendshapes.earBlinkLeft || 0);
  const fusedBlinkR = fuseBlinkScoreClient(blendshapes.eyeBlinkRight || 0, blendshapes.earBlinkRight || 0);
  const blinkL = cal && cal.calibrated ? remapBlinkClient(fusedBlinkL, cal.blinkOpenL || 0, cal.blinkClosedL || 1) : fusedBlinkL;
  const blinkR = cal && cal.calibrated ? remapBlinkClient(fusedBlinkR, cal.blinkOpenR || 0, cal.blinkClosedR || 1) : fusedBlinkR;
  if (valBlinkL) valBlinkL.textContent = `${Math.round(blinkL * 100)}%`;
  if (valBlinkR) valBlinkR.textContent = `${Math.round(blinkR * 100)}%`;
  if (gaugeBlinkL) gaugeBlinkL.style.width = `${Math.min(100, Math.round(blinkL * 100))}%`;
  if (gaugeBlinkR) gaugeBlinkR.style.width = `${Math.min(100, Math.round(blinkR * 100))}%`;
  const browInner = blendshapes.browInnerUp || 0;
  const browUpL = Math.max(blendshapes.browOuterUpLeft || 0, browInner);
  const browUpR = Math.max(blendshapes.browOuterUpRight || 0, browInner);
  const browGain = parseFloat(sliderBrowGain?.value || "1.5");
  const browL = Math.max(-1, Math.min(1, (browUpL - (blendshapes.browDownLeft || 0)) * browGain));
  const browR = Math.max(-1, Math.min(1, (browUpR - (blendshapes.browDownRight || 0)) * browGain));
  const browLPct = Math.round(browL * 100);
  const browRPct = Math.round(browR * 100);
  if (valBrowL) valBrowL.textContent = `${browLPct > 0 ? "+" : ""}${browLPct}%`;
  if (valBrowR) valBrowR.textContent = `${browRPct > 0 ? "+" : ""}${browRPct}%`;
  if (gaugeBrowL) gaugeBrowL.style.width = `${Math.min(100, Math.max(0, Math.round((browL + 1) * 50)))}%`;
  if (gaugeBrowR) gaugeBrowR.style.width = `${Math.min(100, Math.max(0, Math.round((browR + 1) * 50)))}%`;
  const jawOpen = blendshapes.jawOpen || 0;
  if (gaugeMouthOpen) gaugeMouthOpen.style.width = `${Math.min(100, Math.round(jawOpen * 100))}%`;
  const wL = cal && cal.smileWeightL > 0 ? cal.smileWeightL : 0.5;
  const wR = cal && cal.smileWeightR > 0 ? cal.smileWeightR : 0.5;
  const smileBase = cal && cal.calibrated ? cal.neutralSmile : 0;
  const smileRaw = (blendshapes.mouthSmileLeft || 0) * wL + (blendshapes.mouthSmileRight || 0) * wR;
  const smile = Math.max(0, Math.min(1, smileRaw - smileBase));
  if (valSmile) valSmile.textContent = `${Math.round(smile * 100)}%`;
  if (gaugeSmile) gaugeSmile.style.width = `${Math.min(100, Math.round(smile * 100))}%`;
  const neutralZ = cal && cal.calibrated ? cal.neutralZ : -50;
  const rawZ = pose.z || neutralZ;
  const normZ = Math.max(-1, Math.min(1, (rawZ - neutralZ) / 25));
  const depthPct = Math.round(normZ * 100);
  if (valDepthZ) valDepthZ.textContent = `${depthPct > 0 ? "+" : ""}${depthPct}%`;
  if (gaugeDepthZ) gaugeDepthZ.style.width = `${Math.min(100, Math.max(0, Math.round((normZ + 1) * 50)))}%`;
  const puckerRaw = Math.max(blendshapes.mouthPucker || 0, (blendshapes.mouthFunnel || 0) * 0.75);
  const pucker = Math.max(0, Math.min(1, puckerRaw - (cal?.neutralPucker || 0)));
  const puff = Math.max(0, Math.min(1, ((blendshapes.cheekPuff || 0) - (cal?.neutralCheekPuff || 0)) * 1.8));
  const puckerPuff = Math.max(pucker, puff);
  if (valPuckerPuff) valPuckerPuff.textContent = `${Math.round(puckerPuff * 100)}%`;
  if (gaugePuckerPuff) gaugePuckerPuff.style.width = `${Math.min(100, Math.round(puckerPuff * 100))}%`;
  const frownRaw = extractRawFrownClient(blendshapes, wL, wR);
  const frownBase = cal && cal.calibrated ? cal.neutralFrown || 0 : 0;
  const frownDenom = Math.max(0.1, 1 - frownBase);
  const frown = Math.max(0, Math.min(1, Math.max(0, frownRaw - frownBase) / frownDenom * 2.4));
  const tongue = Math.max(0, Math.min(1, blendshapes.tongueOut || 0));
  const frownTongue = Math.max(frown, tongue);
  if (valFrownTongue) valFrownTongue.textContent = `${Math.round(frownTongue * 100)}%`;
  if (gaugeFrownTongue) gaugeFrownTongue.style.width = `${Math.min(100, Math.round(frownTongue * 100))}%`;
}
function resetTrackingGauges() {
  if (valYaw) valYaw.textContent = "0.0\xB0";
  if (valPitch) valPitch.textContent = "0.0\xB0";
  if (valRoll) valRoll.textContent = "0.0\xB0";
  if (valDepthZ) valDepthZ.textContent = "0%";
  if (gaugeDepthZ) gaugeDepthZ.style.width = "50%";
  if (valBlinkL) valBlinkL.textContent = "0%";
  if (valBlinkR) valBlinkR.textContent = "0%";
  if (gaugeBlinkL) gaugeBlinkL.style.width = "0%";
  if (gaugeBlinkR) gaugeBlinkR.style.width = "0%";
  if (valBrowL) valBrowL.textContent = "0%";
  if (valBrowR) valBrowR.textContent = "0%";
  if (gaugeBrowL) gaugeBrowL.style.width = "50%";
  if (gaugeBrowR) gaugeBrowR.style.width = "50%";
  if (gaugeMouthOpen) gaugeMouthOpen.style.width = "0%";
  if (valSmile) valSmile.textContent = "0%";
  if (gaugeSmile) gaugeSmile.style.width = "0%";
  if (valPuckerPuff) valPuckerPuff.textContent = "0%";
  if (gaugePuckerPuff) gaugePuckerPuff.style.width = "0%";
  if (valFrownTongue) valFrownTongue.textContent = "0%";
  if (gaugeFrownTongue) gaugeFrownTongue.style.width = "0%";
}
function sendTrackingLoss(audioState) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        timestamp: performance.now(),
        present: false,
        audio: audioState !== void 0 ? audioState || void 0 : sampleAudio() || void 0
      })
    );
  }
}
if (btnCalibrate) {
  btnCalibrate.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "calibrate" }));
    }
  });
}
if (btnTakeControl) {
  btnTakeControl.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "take_control" }));
    }
  });
}
if (btnToggleCamera) {
  btnToggleCamera.addEventListener("click", toggleCamera);
}
if (btnToggleMic) {
  btnToggleMic.addEventListener("click", toggleMic);
}
if (cameraSelect) {
  cameraSelect.addEventListener("change", (e) => {
    const targetId = e.target.value;
    if (targetId) {
      localStorage.setItem("svgtuber_camera_id", targetId);
    }
    if (webcamRunning) {
      switchCamera(targetId);
    }
  });
}
if (micSelect) {
  micSelect.addEventListener("change", (e) => {
    const targetId = e.target.value;
    localStorage.setItem("svgtuber_mic_id", targetId);
    if (micRunning) {
      stopMic();
      startMic();
    }
  });
}
var activeSettings = null;
var rawConfigPath = "";
var streamerModeEnabled = false;
var debouncedSaveSettings = createDebouncedSaver(async (settings) => {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    if (res.ok && saveStatus) {
      saveStatus.textContent = "\u2713 Saved!";
      saveStatus.style.opacity = "1";
      setTimeout(() => {
        saveStatus.style.opacity = "0";
      }, 1500);
    }
  } catch (err) {
    console.error("[Studio Tracker] Error saving settings:", err);
  }
}, 80);
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    activeSettings = data.settings;
    if (data.configPath) {
      rawConfigPath = data.configPath;
    }
    if (configPathDisplay && rawConfigPath) {
      configPathDisplay.textContent = maskSensitivePath(rawConfigPath, streamerModeEnabled);
    }
    syncSettingsToUI(activeSettings);
  } catch (err) {
    console.warn("[Studio Tracker] Could not load /api/settings:", err);
  }
}
function syncSettingsToUI(s) {
  if (!s) return;
  if (typeof s.streamerMode === "boolean" && s.streamerMode !== streamerModeEnabled) {
    applyStreamerMode(s.streamerMode, true, false);
  }
  if (s.tracking) {
    const t = s.tracking;
    if (sliderMouthGain) sliderMouthGain.value = String(t.mouthGain || 1.4);
    if (sliderMouthThreshold) sliderMouthThreshold.value = String(t.mouthThreshold || 0.08);
    if (checkboxEnableSmile) checkboxEnableSmile.checked = t.enableSmile !== false;
    if (sliderSmileThreshold) sliderSmileThreshold.value = String(t.smileThreshold || 0.5);
    if (checkboxWinkIsBlink) checkboxWinkIsBlink.checked = Boolean(t.winkIsBlink);
    if (checkboxStabilizeBlink) checkboxStabilizeBlink.checked = t.stabilizeBlink !== false;
    if (sliderBlinkMaxYaw)
      sliderBlinkMaxYaw.value = String(t.blinkMaxHeadYaw !== void 0 && t.blinkMaxHeadYaw > 0 ? t.blinkMaxHeadYaw : 25);
    if (checkboxAutoBlink) checkboxAutoBlink.checked = t.autoBlink !== false;
    if (selectAutoBlinkMode) selectAutoBlinkMode.value = t.autoBlinkMode || "always";
    if (sliderAutoBlinkInterval) sliderAutoBlinkInterval.value = String(t.autoBlinkIntervalSec || 4);
    if (checkboxAutoGaze) checkboxAutoGaze.checked = t.autoGaze !== false;
    if (selectAutoGazeMode) selectAutoGazeMode.value = t.autoGazeMode || "always";
    if (sliderAutoGazeRange) sliderAutoGazeRange.value = String(t.autoGazeRange || 1);
    if (checkboxAutoTilt) checkboxAutoTilt.checked = t.autoTilt !== false;
    if (selectAutoTiltMode) selectAutoTiltMode.value = t.autoTiltMode || "always";
    if (sliderAutoTiltAmount) sliderAutoTiltAmount.value = String(t.autoTiltAmount || 1);
    if (checkboxPhysicsEnabled) checkboxPhysicsEnabled.checked = t.physicsEnabled !== false;
    if (sliderPhysicsAmount)
      sliderPhysicsAmount.value = String(t.physicsAmount !== void 0 ? t.physicsAmount : 1);
    if (sliderBlinkThresholdL)
      sliderBlinkThresholdL.value = String(t.blinkThresholdL || t.blinkThreshold || 0.45);
    if (sliderBlinkThresholdR)
      sliderBlinkThresholdR.value = String(t.blinkThresholdR || t.blinkThreshold || 0.45);
    if (sliderBlinkSyncDelay)
      sliderBlinkSyncDelay.value = String(t.blinkSyncDelayMs !== void 0 ? t.blinkSyncDelayMs : 50);
    if (sliderEyeGain) sliderEyeGain.value = String(t.eyeGazeGain || 1);
    if (sliderBrowGain)
      sliderBrowGain.value = String(t.browGain !== void 0 ? t.browGain : 1.5);
    if (sliderYawMultiplier) sliderYawMultiplier.value = String(t.yawMultiplier || 1);
    if (sliderPitchMultiplier) sliderPitchMultiplier.value = String(t.pitchMultiplier || 1);
    if (sliderDepthZoom)
      sliderDepthZoom.value = String(t.depthZoomAmount !== void 0 ? t.depthZoomAmount : 0.25);
  }
  if (s.audio) {
    const a = s.audio;
    const mode = a.mode || "hybrid";
    applyMode(mode, false);
    if (sliderMicGain) sliderMicGain.value = String(a.micGain || 1.5);
    if (sliderNoiseGate) sliderNoiseGate.value = String(a.noiseGate || 0.04);
    if (sliderDecaySmooth) sliderDecaySmooth.value = String(a.decaySmooth || 0.1);
    if (sliderBounceAmount)
      sliderBounceAmount.value = String(a.bounceAmount !== void 0 ? a.bounceAmount : 1);
  }
  updateSliderLabels();
}
function updateSliderLabels() {
  if (valMouthGain && sliderMouthGain)
    valMouthGain.textContent = `${parseFloat(sliderMouthGain.value).toFixed(2)}x`;
  if (valMouthThreshold && sliderMouthThreshold)
    valMouthThreshold.textContent = parseFloat(sliderMouthThreshold.value).toFixed(2);
  if (valSmileThreshold && sliderSmileThreshold)
    valSmileThreshold.textContent = parseFloat(sliderSmileThreshold.value).toFixed(2);
  if (valBlinkThresholdL && sliderBlinkThresholdL)
    valBlinkThresholdL.textContent = parseFloat(sliderBlinkThresholdL.value).toFixed(2);
  if (valBlinkThresholdR && sliderBlinkThresholdR)
    valBlinkThresholdR.textContent = parseFloat(sliderBlinkThresholdR.value).toFixed(2);
  if (valBlinkSyncDelay && sliderBlinkSyncDelay)
    valBlinkSyncDelay.textContent = `${sliderBlinkSyncDelay.value}ms`;
  if (valBlinkMaxYaw && sliderBlinkMaxYaw)
    valBlinkMaxYaw.textContent = `${Math.round(parseFloat(sliderBlinkMaxYaw.value))}\xB0`;
  if (valAutoBlinkInterval && sliderAutoBlinkInterval)
    valAutoBlinkInterval.textContent = `${parseFloat(sliderAutoBlinkInterval.value).toFixed(1)}s`;
  if (valAutoGazeRange && sliderAutoGazeRange)
    valAutoGazeRange.textContent = `${parseFloat(sliderAutoGazeRange.value).toFixed(1)}x`;
  if (valAutoTiltAmount && sliderAutoTiltAmount)
    valAutoTiltAmount.textContent = `${parseFloat(sliderAutoTiltAmount.value).toFixed(1)}x`;
  if (valPhysicsAmount && sliderPhysicsAmount)
    valPhysicsAmount.textContent = `${parseFloat(sliderPhysicsAmount.value).toFixed(1)}x`;
  if (valEyeGain && sliderEyeGain)
    valEyeGain.textContent = `${parseFloat(sliderEyeGain.value).toFixed(1)}x`;
  if (valBrowGain && sliderBrowGain)
    valBrowGain.textContent = `${parseFloat(sliderBrowGain.value).toFixed(1)}x`;
  if (valYawMultiplier && sliderYawMultiplier)
    valYawMultiplier.textContent = `${parseFloat(sliderYawMultiplier.value).toFixed(1)}x`;
  if (valPitchMultiplier && sliderPitchMultiplier)
    valPitchMultiplier.textContent = `${parseFloat(sliderPitchMultiplier.value).toFixed(1)}x`;
  if (valDepthZoom && sliderDepthZoom)
    valDepthZoom.textContent = `${parseFloat(sliderDepthZoom.value).toFixed(2)}x`;
  if (smileThresholdMarker && sliderSmileThreshold) {
    const smilePercent = Math.min(100, Math.round(parseFloat(sliderSmileThreshold.value) * 100));
    smileThresholdMarker.style.left = `${smilePercent}%`;
  }
  if (blinkThresholdMarkerL && sliderBlinkThresholdL) {
    const blinkPercent = Math.min(100, Math.round(parseFloat(sliderBlinkThresholdL.value) * 100));
    blinkThresholdMarkerL.style.left = `${blinkPercent}%`;
  }
  if (blinkThresholdMarkerR && sliderBlinkThresholdR) {
    const blinkPercent = Math.min(100, Math.round(parseFloat(sliderBlinkThresholdR.value) * 100));
    blinkThresholdMarkerR.style.left = `${blinkPercent}%`;
  }
  if (valMicGain && sliderMicGain)
    valMicGain.textContent = `${parseFloat(sliderMicGain.value).toFixed(1)}x`;
  if (valNoiseGate && sliderNoiseGate)
    valNoiseGate.textContent = parseFloat(sliderNoiseGate.value).toFixed(2);
  if (valDecaySmooth && sliderDecaySmooth)
    valDecaySmooth.textContent = parseFloat(sliderDecaySmooth.value).toFixed(2);
  if (valBounceAmount && sliderBounceAmount)
    valBounceAmount.textContent = `${parseFloat(sliderBounceAmount.value).toFixed(1)}x`;
  if (noiseGateMarker && sliderNoiseGate) {
    const gatePercent = Math.min(100, Math.round(parseFloat(sliderNoiseGate.value) * 100));
    noiseGateMarker.style.left = `${gatePercent}%`;
  }
}
function collectSettingsFromUI() {
  const validPort = activeSettings?.port && activeSettings.port > 0 && activeSettings.port <= 65535 ? activeSettings.port : 7420;
  return {
    version: 1,
    port: validPort,
    streamerMode: streamerModeEnabled,
    tracking: {
      mouthGain: parseFloat(sliderMouthGain?.value || "1.4"),
      mouthThreshold: parseFloat(sliderMouthThreshold?.value || "0.08"),
      enableSmile: checkboxEnableSmile ? checkboxEnableSmile.checked : true,
      smileThreshold: parseFloat(sliderSmileThreshold?.value || "0.50"),
      blinkThreshold: parseFloat(sliderBlinkThresholdL?.value || "0.45"),
      blinkThresholdL: parseFloat(sliderBlinkThresholdL?.value || "0.45"),
      blinkThresholdR: parseFloat(sliderBlinkThresholdR?.value || "0.45"),
      blinkSyncDelayMs: parseFloat(sliderBlinkSyncDelay?.value || "50"),
      winkIsBlink: checkboxWinkIsBlink ? checkboxWinkIsBlink.checked : false,
      stabilizeBlink: checkboxStabilizeBlink ? checkboxStabilizeBlink.checked : true,
      blinkMaxHeadYaw: parseFloat(sliderBlinkMaxYaw?.value || "25"),
      autoBlink: checkboxAutoBlink ? checkboxAutoBlink.checked : true,
      autoBlinkMode: selectAutoBlinkMode ? selectAutoBlinkMode.value : "always",
      autoBlinkIntervalSec: parseFloat(sliderAutoBlinkInterval?.value || "4.0"),
      autoGaze: checkboxAutoGaze ? checkboxAutoGaze.checked : true,
      autoGazeMode: selectAutoGazeMode ? selectAutoGazeMode.value : "always",
      autoGazeRange: parseFloat(sliderAutoGazeRange?.value || "1.0"),
      autoTilt: checkboxAutoTilt ? checkboxAutoTilt.checked : true,
      autoTiltMode: selectAutoTiltMode ? selectAutoTiltMode.value : "always",
      autoTiltAmount: parseFloat(sliderAutoTiltAmount?.value || "1.0"),
      physicsEnabled: checkboxPhysicsEnabled ? checkboxPhysicsEnabled.checked : true,
      physicsAmount: parseFloat(
        sliderPhysicsAmount?.value !== void 0 ? sliderPhysicsAmount.value : "1.0"
      ),
      eyeGazeGain: parseFloat(sliderEyeGain?.value || "1.0"),
      gazeDeadzone: activeSettings?.tracking?.gazeDeadzone ?? 0.03,
      browGain: parseFloat(
        sliderBrowGain?.value !== void 0 ? sliderBrowGain.value : "1.5"
      ),
      yawMultiplier: parseFloat(sliderYawMultiplier?.value || "1.0"),
      pitchMultiplier: parseFloat(sliderPitchMultiplier?.value || "1.0"),
      rollMultiplier: 1,
      poseSmoothing: 1,
      depthZoomAmount: parseFloat(
        sliderDepthZoom?.value !== void 0 ? sliderDepthZoom.value : "0.25"
      ),
      calibration: activeSettings?.tracking?.calibration
    },
    audio: {
      mode: settingsModeSelect?.value || modeSelect?.value || "hybrid",
      micGain: parseFloat(sliderMicGain?.value || "1.5"),
      noiseGate: parseFloat(sliderNoiseGate?.value || "0.04"),
      decaySmooth: parseFloat(sliderDecaySmooth?.value || "0.10"),
      bounceAmount: parseFloat(
        sliderBounceAmount?.value !== void 0 ? sliderBounceAmount.value : "1.0"
      )
    }
  };
}
function onSliderInput() {
  updateSliderLabels();
  const current = collectSettingsFromUI();
  debouncedSaveSettings(current);
}
[
  sliderMouthGain,
  sliderMouthThreshold,
  sliderSmileThreshold,
  sliderBlinkThresholdL,
  sliderBlinkThresholdR,
  sliderBlinkSyncDelay,
  sliderBlinkMaxYaw,
  sliderAutoBlinkInterval,
  sliderAutoGazeRange,
  sliderAutoTiltAmount,
  sliderEyeGain,
  sliderBrowGain,
  sliderYawMultiplier,
  sliderPitchMultiplier,
  sliderDepthZoom,
  sliderMicGain,
  sliderNoiseGate,
  sliderDecaySmooth,
  sliderBounceAmount,
  sliderPhysicsAmount
].forEach((slider) => {
  if (slider) {
    slider.addEventListener("input", onSliderInput);
  }
});
function onModeChange(e) {
  const newMode = e.target.value;
  applyMode(newMode, true);
}
if (modeSelect) modeSelect.addEventListener("change", onModeChange);
if (settingsModeSelect) settingsModeSelect.addEventListener("change", onModeChange);
[
  checkboxEnableSmile,
  checkboxWinkIsBlink,
  checkboxStabilizeBlink,
  checkboxAutoBlink,
  checkboxAutoGaze,
  checkboxAutoTilt,
  checkboxPhysicsEnabled
].forEach((cb) => {
  if (cb) cb.addEventListener("change", onSliderInput);
});
[selectAutoBlinkMode, selectAutoGazeMode, selectAutoTiltMode].forEach((sel) => {
  if (sel) sel.addEventListener("change", onSliderInput);
});
if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", () => {
    debouncedSaveSettings(collectSettingsFromUI());
  });
}
if (btnResetSettings) {
  btnResetSettings.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/settings/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        activeSettings = data.settings;
        syncSettingsToUI(activeSettings);
        if (saveStatus) {
          saveStatus.textContent = "\u2713 Defaults Reset!";
          saveStatus.style.opacity = "1";
          setTimeout(() => {
            saveStatus.style.opacity = "0";
          }, 1500);
        }
      }
    } catch (err) {
      console.error("[Studio Tracker] Error resetting settings:", err);
    }
  });
}
var availableExpressions = [];
var avatarExpressions = [];
var activeExpressions = {};
var expressionsContainer = document.getElementById("expressions-container");
var btnClearExpressions = document.getElementById("btn-clear-expressions");
var expressionCountBadge = document.getElementById("expression-count-badge");
var expressionStatus = document.getElementById("expression-status");
async function loadExpressions() {
  try {
    const res = await fetch("/api/expressions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    activeExpressions = data.active || {};
    availableExpressions = data.available || [];
    avatarExpressions = data.avatarExpressions || [];
    renderExpressionButtons();
    updateAllExpressionDropdowns();
  } catch (err) {
    console.warn("[Studio Tracker] Could not load /api/expressions:", err);
  }
}
function renderExpressionButtons() {
  if (!expressionsContainer) return;
  expressionsContainer.innerHTML = "";
  if (expressionCountBadge) {
    expressionCountBadge.textContent = String(availableExpressions.length);
  }
  if (availableExpressions.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.style.fontSize = "12px";
    emptySpan.style.color = "var(--text-muted)";
    emptySpan.textContent = "No custom expressions detected in current avatar rig.";
    expressionsContainer.appendChild(emptySpan);
    return;
  }
  availableExpressions.forEach((name, idx) => {
    const btn = document.createElement("button");
    btn.className = `expr-btn ${activeExpressions[name] ? "active" : ""}`;
    btn.dataset.name = name;
    const labelSpan = document.createElement("span");
    labelSpan.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.appendChild(labelSpan);
    if (idx < 9) {
      const keyBadge = document.createElement("span");
      keyBadge.className = "expr-key-badge";
      keyBadge.textContent = `${idx + 1}`;
      keyBadge.title = `Press ${idx + 1} to toggle`;
      btn.appendChild(keyBadge);
    }
    const copyBtn = document.createElement("span");
    copyBtn.className = "expr-copy-btn";
    copyBtn.title = "Copy Stream Deck API URL";
    copyBtn.textContent = "\u{1F4CB}";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const apiUrl = `${location.origin}/api/expressions/toggle?name=${encodeURIComponent(name)}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(apiUrl).then(() => {
          if (expressionStatus) {
            expressionStatus.textContent = `Copied URL for "${name}"!`;
            setTimeout(() => {
              expressionStatus.textContent = "";
            }, 2e3);
          }
        });
      }
    });
    btn.appendChild(copyBtn);
    btn.addEventListener("click", () => {
      toggleExpression(name);
    });
    expressionsContainer.appendChild(btn);
  });
}
function updateExpressionButtonsUI() {
  if (expressionsContainer) {
    const buttons = expressionsContainer.querySelectorAll(".expr-btn");
    buttons.forEach((btn) => {
      const name = btn.dataset.name || "";
      if (activeExpressions[name]) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }
  const acc = getActiveModalAcc();
  if (acc) {
    renderModalExpressionPreview(acc);
  }
}
async function toggleExpression(name) {
  try {
    const res = await fetch(`/api/expressions/toggle?name=${encodeURIComponent(name)}`, {
      method: "POST"
    });
    if (res.ok) {
      const data = await res.json();
      activeExpressions = data.expressions || {};
      updateExpressionButtonsUI();
    }
  } catch (err) {
    console.error("[Studio Tracker] Error toggling expression:", err);
  }
}
async function clearAllExpressions() {
  try {
    const res = await fetch("/api/expressions/reset", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      activeExpressions = data.expressions || {};
      updateExpressionButtonsUI();
    }
  } catch (err) {
    console.error("[Studio Tracker] Error clearing expressions:", err);
  }
}
if (btnClearExpressions) {
  btnClearExpressions.addEventListener("click", clearAllExpressions);
}
var btnReloadAvatar = document.getElementById("btn-reload-avatar");
if (btnReloadAvatar) {
  btnReloadAvatar.addEventListener("click", async () => {
    btnReloadAvatar.disabled = true;
    btnReloadAvatar.textContent = "Reloading...";
    try {
      await fetch("/api/avatar/reload", { method: "POST" });
      await loadExpressions();
      if (expressionStatus) {
        expressionStatus.textContent = "Avatar rig reloaded!";
        setTimeout(() => {
          expressionStatus.textContent = "";
        }, 2e3);
      }
    } catch (e) {
      console.error("[Studio Tracker] Reload rig error:", e);
    } finally {
      btnReloadAvatar.disabled = false;
      btnReloadAvatar.textContent = "\u21BB Reload Rig";
    }
  });
}
window.addEventListener("keydown", (e) => {
  const targetTag = e.target?.tagName;
  if (shouldIgnoreHotkey(targetTag)) return;
  const match = resolveHotkeyIndex(e.key, availableExpressions);
  if (match) {
    e.preventDefault();
    toggleExpression(match);
  }
});
var avatarSelect = document.getElementById("avatar-select");
var btnRefreshAvatars = document.getElementById("btn-refresh-avatars");
function reloadAvatarFrame() {
  const frame = document.getElementById("avatar-frame");
  if (frame) {
    frame.src = `/overlay?t=${Date.now()}`;
  }
}
async function loadAvatars() {
  if (!avatarSelect) return;
  try {
    const res = await fetch(`/api/avatars?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    const current = data.currentAvatar || "";
    const avatars = (data.avatars || []).filter(
      (av) => !av.toLowerCase().startsWith("accessories/")
    );
    avatarSelect.innerHTML = "";
    if (avatars.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No .svg files found in directory";
      avatarSelect.appendChild(opt);
      return;
    }
    avatars.forEach((av) => {
      const opt = document.createElement("option");
      opt.value = av;
      opt.textContent = av;
      if (av === current) {
        opt.selected = true;
      }
      avatarSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("[Studio Tracker] Error loading avatars:", err);
  }
}
if (avatarSelect) {
  avatarSelect.addEventListener("change", async (e) => {
    const selected = e.target.value;
    if (!selected) return;
    avatarSelect.disabled = true;
    try {
      const res = await fetch("/api/avatars/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: selected })
      });
      if (!res.ok) throw new Error(`Failed to switch avatar: ${res.statusText}`);
      reloadAvatarFrame();
      await loadExpressions();
    } catch (err) {
      console.error("[Studio Tracker] Error switching avatar:", err);
      alert(`Could not switch avatar: ${err.message}`);
    } finally {
      avatarSelect.disabled = false;
    }
  });
}
if (btnRefreshAvatars) {
  btnRefreshAvatars.addEventListener("click", async () => {
    btnRefreshAvatars.disabled = true;
    const prevText = btnRefreshAvatars.textContent;
    btnRefreshAvatars.textContent = "...";
    try {
      await loadAvatars();
    } finally {
      btnRefreshAvatars.disabled = false;
      btnRefreshAvatars.textContent = prevText || "\u21BB";
    }
  });
}
var availableAccessoryFiles = [];
var configuredAccessories = [];
var accessoryFileExpressions = {};
var accessoryDebounceMap = /* @__PURE__ */ new Map();
var accessoryCountBadge = document.getElementById("accessory-count-badge");
var sidebarAccBadge = document.getElementById("sidebar-acc-badge");
var quickAccessoriesBarEl = document.getElementById("quick-accessories-bar");
var accessoryListEl = document.getElementById("accessory-list");
var availableAccessoriesChipsEl = document.getElementById("available-accessories-chips");
var accessorySaveIndicator = document.getElementById("accessory-save-indicator");
var btnRefreshAccessories = document.getElementById("btn-refresh-accessories");
function renderQuickAccessoriesBar() {
  const activeCount = configuredAccessories.filter((a) => a.enabled).length;
  const badgeText = `${activeCount}/${configuredAccessories.length}`;
  if (accessoryCountBadge) {
    accessoryCountBadge.textContent = badgeText;
  }
  if (sidebarAccBadge) {
    sidebarAccBadge.textContent = badgeText;
  }
  if (!quickAccessoriesBarEl) return;
  quickAccessoriesBarEl.innerHTML = "";
  if (configuredAccessories.length === 0) {
    const empty = document.createElement("span");
    empty.style.fontSize = "12px";
    empty.style.color = "var(--text-muted)";
    empty.textContent = "No accessories added yet (open Wardrobe & Props to equip)";
    quickAccessoriesBarEl.appendChild(empty);
    return;
  }
  configuredAccessories.forEach((acc) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `expr-btn ${acc.enabled ? "active" : ""}`;
    btn.title = `Click to ${acc.enabled ? "unequip" : "equip"} ${acc.name || acc.file}`;
    const dot = document.createElement("span");
    dot.textContent = acc.enabled ? "\u{1F7E2}" : "\u26AA";
    dot.style.fontSize = "9px";
    const lbl = document.createElement("span");
    lbl.textContent = acc.name || acc.file;
    btn.appendChild(dot);
    btn.appendChild(lbl);
    btn.addEventListener("click", async () => {
      acc.enabled = !acc.enabled;
      renderQuickAccessoriesBar();
      renderAccessoriesUI();
      try {
        await fetch("/api/accessories/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: acc.id })
        });
        flashAccessorySaved();
      } catch (err) {
        console.error("[Studio Tracker] Quick accessory toggle error:", err);
      }
    });
    quickAccessoriesBarEl.appendChild(btn);
  });
}
function flashAccessorySaved() {
  if (accessorySaveIndicator) {
    accessorySaveIndicator.style.opacity = "1";
    setTimeout(() => {
      accessorySaveIndicator.style.opacity = "0";
    }, 1200);
  }
}
async function loadAccessories() {
  try {
    const res = await fetch(`/api/accessories?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    availableAccessoryFiles = data.availableFiles || [];
    configuredAccessories = data.accessories || [];
    accessoryFileExpressions = data.fileExpressions || {};
    renderAccessoriesUI();
  } catch (err) {
    console.error("[Studio Tracker] Error loading accessories:", err);
  }
}
function debounceSaveAccessory(acc) {
  if (accessoryDebounceMap.has(acc.id)) {
    clearTimeout(accessoryDebounceMap.get(acc.id));
  }
  const timer = setTimeout(async () => {
    accessoryDebounceMap.delete(acc.id);
    try {
      const res = await fetch("/api/accessories/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acc)
      });
      if (res.ok) {
        flashAccessorySaved();
      }
    } catch (e) {
      console.error("[Studio Tracker] Error updating accessory:", e);
    }
  }, 50);
  accessoryDebounceMap.set(acc.id, timer);
}
function renderAccessoriesUI() {
  renderQuickAccessoriesBar();
  if (availableAccessoriesChipsEl) {
    const currentChipsKey = availableAccessoriesChipsEl.dataset.files || "";
    const newChipsKey = availableAccessoryFiles.join(",");
    if (currentChipsKey !== newChipsKey) {
      availableAccessoriesChipsEl.dataset.files = newChipsKey;
      availableAccessoriesChipsEl.innerHTML = "";
      if (availableAccessoryFiles.length === 0) {
        availableAccessoriesChipsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No .svg files in avatar accessories/ folder</span>';
      } else {
        availableAccessoryFiles.forEach((file) => {
          const chip = document.createElement("button");
          chip.className = "acc-chip";
          chip.title = `Add ${file} to avatar`;
          chip.innerHTML = `<span>+</span> <span>${file}</span>`;
          chip.addEventListener("click", () => {
            equipNewAccessory(file);
          });
          availableAccessoriesChipsEl.appendChild(chip);
        });
      }
    }
  }
  if (!accessoryListEl) return;
  if (configuredAccessories.length === 0) {
    accessoryListEl.innerHTML = `
      <div style="text-align: center; padding: 18px 12px; background: #14141c; border-radius: 6px; border: 1px dashed var(--border-color);">
        <div style="font-size: 13px; font-weight: 500; color: var(--text-main); margin-bottom: 4px;">No Accessories Added Yet</div>
        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">
          Click any file below in the <strong>Discovered Accessory Files</strong> bar to equip glasses, ears, sweat drops, or custom SVG props!
        </div>
      </div>`;
    return;
  }
  const firstChild = accessoryListEl.firstElementChild;
  if (firstChild && !firstChild.classList.contains("accessory-card")) {
    accessoryListEl.innerHTML = "";
  }
  const currentIds = new Set(configuredAccessories.map((a) => a.id));
  Array.from(accessoryListEl.children).forEach((child) => {
    if (child.dataset && child.dataset.accId && !currentIds.has(child.dataset.accId)) {
      child.remove();
    }
  });
  configuredAccessories.forEach((acc) => {
    let card = accessoryListEl.querySelector(
      `.accessory-card[data-acc-id="${CSS.escape(acc.id)}"]`
    );
    const exprText = acc.expression ? ` \u2022 Trigger: ${acc.expression}` : "";
    const metaText = `${acc.file} \u2022 ${acc.target || "layer_head"}${exprText}`;
    if (card) {
      const meta2 = card.querySelector(".accessory-meta");
      if (meta2) meta2.textContent = metaText;
      const switchInput2 = card.querySelector(".switch input");
      if (switchInput2 && document.activeElement !== switchInput2) {
        switchInput2.checked = Boolean(acc.enabled);
      }
      return;
    }
    card = document.createElement("div");
    card.className = "accessory-card";
    card.dataset.accId = acc.id;
    const header = document.createElement("div");
    header.className = "accessory-header";
    const info = document.createElement("div");
    info.className = "accessory-info";
    const title = document.createElement("div");
    title.className = "accessory-title";
    title.textContent = acc.name || acc.file;
    const meta = document.createElement("div");
    meta.className = "accessory-meta";
    meta.textContent = `${acc.file} \u2022 ${acc.target || "layer_head"}`;
    info.appendChild(title);
    info.appendChild(meta);
    const controls = document.createElement("div");
    controls.className = "accessory-controls";
    controls.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    switchLabel.title = acc.enabled ? "Unequip Accessory" : "Equip Accessory";
    switchLabel.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    const switchInput = document.createElement("input");
    switchInput.type = "checkbox";
    switchInput.checked = Boolean(acc.enabled);
    switchInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    switchInput.addEventListener("change", async (e) => {
      e.stopPropagation();
      acc.enabled = switchInput.checked;
      try {
        await fetch("/api/accessories/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: acc.id })
        });
        flashAccessorySaved();
        renderQuickAccessoriesBar();
      } catch (err) {
        console.error("[Studio Tracker] Toggle error:", err);
      }
    });
    const switchSlider = document.createElement("span");
    switchSlider.className = "switch-slider";
    switchSlider.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    switchLabel.appendChild(switchInput);
    switchLabel.appendChild(switchSlider);
    const btnFit = document.createElement("button");
    btnFit.className = "btn btn-secondary";
    btnFit.style.fontSize = "10px";
    btnFit.style.padding = "2px 7px";
    btnFit.innerHTML = "\u{1FA9E} Fit";
    btnFit.title = "Open in Dressing Room for large preview & precision positioning";
    btnFit.addEventListener("click", (e) => {
      e.stopPropagation();
      openDressingRoom(acc.id);
    });
    const btnRemove = document.createElement("button");
    btnRemove.className = "btn btn-secondary";
    btnRemove.style.fontSize = "10px";
    btnRemove.style.padding = "2px 6px";
    btnRemove.textContent = "\u2715";
    btnRemove.title = "Delete accessory";
    btnRemove.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${acc.name || acc.file}"?`)) {
        try {
          await fetch("/api/accessories/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: acc.id })
          });
          await loadAccessories();
        } catch (err) {
          console.error("[Studio Tracker] Remove error:", err);
        }
      }
    });
    controls.appendChild(switchLabel);
    controls.appendChild(btnFit);
    controls.appendChild(btnRemove);
    info.style.cursor = "pointer";
    info.title = "Click to fit in Dressing Room";
    info.addEventListener("click", (e) => {
      e.stopPropagation();
      openDressingRoom(acc.id);
    });
    header.appendChild(info);
    header.appendChild(controls);
    card.appendChild(header);
    accessoryListEl.appendChild(card);
  });
  renderModalDiscoveredAccessoriesChips();
}
var modalDiscoveredAccessoriesChipsEl = document.getElementById(
  "modal-discovered-accessories-chips"
);
var modalBtnRefreshAccessories = document.getElementById(
  "modal-btn-refresh-accessories"
);
function renderModalDiscoveredAccessoriesChips() {
  if (!modalDiscoveredAccessoriesChipsEl) return;
  modalDiscoveredAccessoriesChipsEl.innerHTML = "";
  if (availableAccessoryFiles.length === 0) {
    modalDiscoveredAccessoriesChipsEl.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">No .svg files found in accessories directory.</span>';
    return;
  }
  const activeAcc = getActiveModalAcc();
  availableAccessoryFiles.forEach((file) => {
    const isEquipped = configuredAccessories.some((a) => a.file === file);
    const isSelected = activeAcc && activeAcc.file === file;
    const chip = document.createElement("button");
    chip.className = `acc-chip ${isSelected ? "active-modal-chip" : ""}`;
    chip.style.fontSize = "11px";
    chip.style.padding = "3px 8px";
    chip.style.display = "inline-flex";
    chip.style.alignItems = "center";
    chip.style.gap = "5px";
    if (isEquipped) {
      chip.title = `${file} is equipped. Click to select & adjust in Dressing Room.`;
      chip.innerHTML = `<span style="color: var(--success); font-weight: bold;">\u2713</span> <span>${file}</span>`;
      chip.addEventListener("click", () => {
        const acc = configuredAccessories.find((a) => a.file === file);
        if (acc) {
          activeModalAccId = acc.id;
          if (modalAccessorySelect) modalAccessorySelect.value = acc.id;
          syncModalControlsFromAcc(acc);
          renderModalExpressionPreview(acc);
          renderModalDiscoveredAccessoriesChips();
        }
      });
    } else {
      chip.title = `Click to equip ${file} to avatar`;
      chip.innerHTML = `<span style="color: var(--accent); font-weight: bold;">+</span> <span>${file}</span>`;
      chip.addEventListener("click", async () => {
        await equipNewAccessory(file);
      });
    }
    modalDiscoveredAccessoriesChipsEl.appendChild(chip);
  });
}
if (modalBtnRefreshAccessories) {
  modalBtnRefreshAccessories.addEventListener("click", async () => {
    modalBtnRefreshAccessories.disabled = true;
    modalBtnRefreshAccessories.textContent = "\u21BB ...";
    try {
      await loadAccessories();
    } finally {
      modalBtnRefreshAccessories.disabled = false;
      modalBtnRefreshAccessories.textContent = "\u21BB Refresh";
    }
  });
}
async function equipNewAccessory(filename) {
  const baseName = filename.replace(/\.svg$/i, "");
  const cleanId = baseName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const uniqueId = `${cleanId}_${Date.now().toString(36).slice(-4)}`;
  const displayName = baseName.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const defaultExprs = accessoryFileExpressions[filename] || [];
  const initialExpr = defaultExprs.length > 0 ? defaultExprs[0] : "";
  const newAcc = {
    id: uniqueId,
    file: filename,
    name: displayName,
    target: "layer_head",
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    order: "front",
    enabled: true,
    expression: initialExpr
  };
  try {
    const res = await fetch("/api/accessories/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAcc)
    });
    if (res.ok) {
      await loadAccessories();
      flashAccessorySaved();
      openDressingRoom(uniqueId);
    }
  } catch (err) {
    console.error("[Studio Tracker] Equip accessory error:", err);
  }
}
if (btnRefreshAccessories) {
  btnRefreshAccessories.addEventListener("click", async () => {
    btnRefreshAccessories.disabled = true;
    btnRefreshAccessories.textContent = "\u21BB ...";
    try {
      await loadAccessories();
    } finally {
      btnRefreshAccessories.disabled = false;
      btnRefreshAccessories.textContent = "\u21BB Refresh";
    }
  });
}
var activeModalAccId = null;
var currentNudgeStep = 1;
var dressingRoomModal = document.getElementById("dressing-room-modal");
var btnOpenDressingRoom = document.getElementById("btn-open-dressing-room");
var btnCloseDressingRoom = document.getElementById("btn-close-dressing-room");
var modalBtnDone = document.getElementById("modal-btn-done");
var modalBtnReset = document.getElementById("modal-btn-reset");
var modalSaveIndicator = document.getElementById("modal-save-indicator");
var modalAccessorySelect = document.getElementById("modal-accessory-select");
var modalAccessoryToggle = document.getElementById("modal-accessory-toggle");
var modalTargetSelect = document.getElementById("modal-target-select");
var modalOrderSelect = document.getElementById("modal-order-select");
var modalExpressionSelect = document.getElementById("modal-expression-select");
var modalSliderX = document.getElementById("modal-slider-x");
var modalNumX = document.getElementById("modal-num-x");
var modalSliderY = document.getElementById("modal-slider-y");
var modalNumY = document.getElementById("modal-num-y");
var modalSliderSX = document.getElementById("modal-slider-sx");
var modalNumSX = document.getElementById("modal-num-sx");
var modalSliderSY = document.getElementById("modal-slider-sy");
var modalNumSY = document.getElementById("modal-num-sy");
var modalSliderRot = document.getElementById("modal-slider-rot");
var modalNumRot = document.getElementById("modal-num-rot");
var modalLinkScale = document.getElementById("modal-link-scale");
var fittingFrame = document.getElementById("fitting-frame");
var fittingCrosshair = document.getElementById("fitting-crosshair");
var checkShowCrosshair = document.getElementById("check-show-crosshair");
var fittingZoomBadge = document.getElementById("fitting-zoom-badge");
var btnZoomReset = document.getElementById("btn-zoom-reset");
var btnZoomHead = document.getElementById("btn-zoom-head");
var btnZoomTight = document.getElementById("btn-zoom-tight");
var btnReloadFitting = document.getElementById("btn-reload-fitting");
var btnFittingFreeze = document.getElementById("btn-fitting-freeze");
var fittingMirrorFrozen = true;
var nudgeUp = document.getElementById("nudge-up");
var nudgeDown = document.getElementById("nudge-down");
var nudgeLeft = document.getElementById("nudge-left");
var nudgeRight = document.getElementById("nudge-right");
var nudgeCenter = document.getElementById("nudge-center");
var nudgeStepBtns = document.querySelectorAll(".nudge-step-btn");
var btnRotLeft = document.getElementById("btn-rot-left");
var btnRotZero = document.getElementById("btn-rot-zero");
var btnRotRight = document.getElementById("btn-rot-right");
function populateExpressionSelect(selectEl, selectedVal = "") {
  const currentVal = selectedVal || "";
  selectEl.innerHTML = "";
  const alwaysOpt = document.createElement("option");
  alwaysOpt.value = "";
  alwaysOpt.textContent = "Always Visible";
  selectEl.appendChild(alwaysOpt);
  const seen = /* @__PURE__ */ new Set([""]);
  if (Array.isArray(availableExpressions)) {
    availableExpressions.forEach((expr) => {
      if (!seen.has(expr)) {
        seen.add(expr);
        const opt = document.createElement("option");
        opt.value = expr;
        opt.textContent = `${expr.charAt(0).toUpperCase() + expr.slice(1)} (Expression Trigger)`;
        selectEl.appendChild(opt);
      }
    });
  }
  if (currentVal && !seen.has(currentVal)) {
    const customOpt = document.createElement("option");
    customOpt.value = currentVal;
    customOpt.textContent = `${customOpt.value} (Custom Expression)`;
    selectEl.appendChild(customOpt);
  }
  const addCustomOpt = document.createElement("option");
  addCustomOpt.value = "__custom__";
  addCustomOpt.textContent = "+ Custom Expression...";
  selectEl.appendChild(addCustomOpt);
  selectEl.value = currentVal;
}
function updateAllExpressionDropdowns() {
  if (modalExpressionSelect) {
    const acc = getActiveModalAcc();
    populateExpressionSelect(modalExpressionSelect, acc ? acc.expression : "");
  }
}
var modalExprAlert = document.getElementById("modal-expr-alert");
var modalExprAlertText = document.getElementById("modal-expr-alert-text");
var modalBtnEnableExpr = document.getElementById("modal-btn-enable-expr");
var modalAccessoryExprCard = document.getElementById("modal-accessory-expr-card");
var modalAccessoryExpressionChips = document.getElementById(
  "modal-accessory-expression-chips"
);
var modalAccessoryExprStatus = document.getElementById("modal-accessory-expr-status");
var modalAvatarExpressionChips = document.getElementById("modal-avatar-expression-chips");
function renderModalExpressionPreview(acc) {
  if (modalAvatarExpressionChips) {
    modalAvatarExpressionChips.innerHTML = "";
    const avatarList = Array.isArray(avatarExpressions) && avatarExpressions.length > 0 ? avatarExpressions : availableExpressions.filter((name) => {
      for (const file in accessoryFileExpressions) {
        if (accessoryFileExpressions[file]?.includes(name)) return false;
      }
      return true;
    });
    if (avatarList.length > 0) {
      avatarList.forEach((name) => {
        const isActive = Boolean(activeExpressions[name]);
        const pill = document.createElement("button");
        pill.className = `btn ${isActive ? "btn-primary" : "btn-secondary"}`;
        pill.style.fontSize = "10px";
        pill.style.padding = "2px 7px";
        pill.style.opacity = isActive ? "1" : "0.75";
        pill.textContent = `${name}: ${isActive ? "ON" : "OFF"}`;
        pill.title = `Toggle ${name} on avatar`;
        pill.addEventListener("click", () => {
          toggleExpression(name);
        });
        modalAvatarExpressionChips.appendChild(pill);
      });
    } else {
      const noneSpan = document.createElement("span");
      noneSpan.style.fontSize = "10px";
      noneSpan.style.color = "var(--text-muted)";
      noneSpan.textContent = "None defined in avatar SVG";
      modalAvatarExpressionChips.appendChild(noneSpan);
    }
  }
  const triggerExpr = acc && acc.expression && acc.expression.trim().toLowerCase() || "";
  if (modalExprAlert && modalExprAlertText && modalBtnEnableExpr) {
    if (triggerExpr && !activeExpressions[triggerExpr]) {
      modalExprAlert.style.display = "flex";
      modalExprAlertText.textContent = `Visibility Trigger "${triggerExpr}" is OFF (accessory is hidden in mirror).`;
      modalBtnEnableExpr.textContent = `Turn ON "${triggerExpr}"`;
      modalBtnEnableExpr.onclick = async () => {
        await toggleExpression(triggerExpr);
      };
    } else {
      modalExprAlert.style.display = "none";
    }
  }
  if (modalAccessoryExprCard && modalAccessoryExpressionChips) {
    const accFile = acc ? acc.file : "";
    const specificExprs = accFile && accessoryFileExpressions[accFile] || [];
    if (specificExprs.length === 0) {
      modalAccessoryExprCard.style.display = "none";
      modalAccessoryExpressionChips.innerHTML = "";
    } else {
      modalAccessoryExprCard.style.display = "block";
      if (modalAccessoryExprStatus) {
        modalAccessoryExprStatus.textContent = `Defined in ${accFile}`;
      }
      modalAccessoryExpressionChips.innerHTML = "";
      specificExprs.forEach((name) => {
        const isActive = Boolean(activeExpressions[name]);
        const btn = document.createElement("button");
        btn.className = `btn ${isActive ? "btn-primary" : "btn-secondary"}`;
        btn.style.fontSize = "11px";
        btn.style.padding = "4px 10px";
        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.gap = "6px";
        btn.title = `Click to ${isActive ? "turn OFF" : "turn ON"} "${name}" in mirror`;
        const dot = document.createElement("span");
        dot.style.fontSize = "9px";
        dot.textContent = isActive ? "\u{1F7E2}" : "\u26AA";
        const label = document.createElement("span");
        label.textContent = `${name.charAt(0).toUpperCase() + name.slice(1)}: ${isActive ? "ON" : "OFF"}`;
        btn.appendChild(dot);
        btn.appendChild(label);
        btn.addEventListener("click", () => {
          toggleExpression(name);
        });
        modalAccessoryExpressionChips.appendChild(btn);
      });
    }
  }
}
function flashModalSaved() {
  if (modalSaveIndicator) {
    modalSaveIndicator.style.opacity = "1";
    setTimeout(() => {
      modalSaveIndicator.style.opacity = "0";
    }, 1200);
  }
}
function getActiveModalAcc() {
  if (!activeModalAccId) return null;
  return configuredAccessories.find((a) => a.id === activeModalAccId) || null;
}
function syncModalControlsFromAcc(acc) {
  if (!acc) {
    if (modalAccessorySelect) modalAccessorySelect.value = "";
    return;
  }
  if (modalAccessorySelect) modalAccessorySelect.value = acc.id;
  if (modalAccessoryToggle) modalAccessoryToggle.checked = Boolean(acc.enabled);
  if (modalTargetSelect) {
    if (!["layer_head", "head", "root_svg"].includes(acc.target)) {
      const customOpt = document.createElement("option");
      customOpt.value = acc.target;
      customOpt.textContent = customOpt.value;
      modalTargetSelect.appendChild(customOpt);
    }
    modalTargetSelect.value = acc.target || "layer_head";
  }
  if (modalOrderSelect) {
    modalOrderSelect.value = acc.order || "front";
  }
  if (modalExpressionSelect) {
    populateExpressionSelect(modalExpressionSelect, acc.expression || "");
  }
  const xVal = acc.x || 0;
  if (modalSliderX) modalSliderX.value = String(xVal);
  if (modalNumX) modalNumX.value = String(xVal);
  const yVal = acc.y || 0;
  if (modalSliderY) modalSliderY.value = String(yVal);
  if (modalNumY) modalNumY.value = String(yVal);
  const sxVal = acc.scaleX !== void 0 ? acc.scaleX : 1;
  if (modalSliderSX) modalSliderSX.value = String(sxVal);
  if (modalNumSX) modalNumSX.value = String(parseFloat(String(sxVal)).toFixed(2));
  const syVal = acc.scaleY !== void 0 ? acc.scaleY : 1;
  if (modalSliderSY) modalSliderSY.value = String(syVal);
  if (modalNumSY) modalNumSY.value = String(parseFloat(String(syVal)).toFixed(2));
  const rotVal = acc.rotation || 0;
  if (modalSliderRot) modalSliderRot.value = String(rotVal);
  if (modalNumRot) modalNumRot.value = String(rotVal);
  renderModalExpressionPreview(acc);
}
function updateFittingMirrorSrc() {
  if (!fittingFrame) return;
  fittingFrame.src = formatFittingMirrorUrl(fittingMirrorFrozen);
  if (btnFittingFreeze) {
    btnFittingFreeze.textContent = fittingMirrorFrozen ? "\u{1F9D8} Rest Pose" : "\u{1F3A5} Live Motion";
    btnFittingFreeze.title = fittingMirrorFrozen ? "Mirror is in Rest Pose (Click for Live Motion)" : "Mirror is following Live Motion (Click for Rest Pose)";
    btnFittingFreeze.classList.toggle("btn-primary", !fittingMirrorFrozen);
    btnFittingFreeze.classList.toggle("btn-secondary", fittingMirrorFrozen);
  }
}
function openDressingRoom(accId = null) {
  if (!dressingRoomModal) return;
  if (modalAccessorySelect) {
    modalAccessorySelect.innerHTML = "";
    if (configuredAccessories.length === 0) {
      modalAccessorySelect.innerHTML = '<option value="">No accessories equipped (click a file below to equip)</option>';
    } else {
      configuredAccessories.forEach((acc) => {
        const opt = document.createElement("option");
        opt.value = acc.id;
        opt.textContent = `${acc.name || acc.file} (${acc.enabled ? "Equipped" : "Off"})`;
        modalAccessorySelect.appendChild(opt);
      });
    }
  }
  if (accId && configuredAccessories.some((a) => a.id === accId)) {
    activeModalAccId = accId;
  } else if (configuredAccessories.length > 0) {
    activeModalAccId = configuredAccessories[0].id;
  } else {
    activeModalAccId = null;
  }
  syncModalControlsFromAcc(getActiveModalAcc());
  dressingRoomModal.style.display = "flex";
  renderModalDiscoveredAccessoriesChips();
  renderModalExpressionPreview(getActiveModalAcc());
  updateFittingMirrorSrc();
}
function closeDressingRoom() {
  if (!dressingRoomModal) return;
  dressingRoomModal.style.display = "none";
  if (fittingFrame) {
    fittingFrame.src = "about:blank";
  }
  renderAccessoriesUI();
  reloadAvatarFrame();
}
if (btnOpenDressingRoom) btnOpenDressingRoom.addEventListener("click", () => openDressingRoom());
if (btnCloseDressingRoom) btnCloseDressingRoom.addEventListener("click", closeDressingRoom);
if (modalBtnDone) modalBtnDone.addEventListener("click", closeDressingRoom);
if (dressingRoomModal) {
  dressingRoomModal.addEventListener("click", (e) => {
    if (e.target === dressingRoomModal) {
      closeDressingRoom();
    }
  });
}
window.addEventListener("keydown", (e) => {
  if (!dressingRoomModal || dressingRoomModal.style.display === "none") return;
  if (e.key === "Escape") {
    closeDressingRoom();
    return;
  }
  const target = e.target;
  if (target.tagName === "INPUT" && (target.type === "number" || target.type === "text")) {
    return;
  }
  const acc = getActiveModalAcc();
  if (!acc) return;
  const step = e.shiftKey ? currentNudgeStep * 10 : currentNudgeStep;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 0, -1, step);
    acc.y = np.y;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 0, 1, step);
    acc.y = np.y;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, -1, 0, step);
    acc.x = np.x;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    const np = nudgePosition(acc.x || 0, acc.y || 0, 1, 0, step);
    acc.x = np.x;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  }
});
if (modalAccessorySelect) {
  modalAccessorySelect.addEventListener("change", (e) => {
    activeModalAccId = e.target.value;
    syncModalControlsFromAcc(getActiveModalAcc());
    renderModalExpressionPreview(getActiveModalAcc());
    renderModalDiscoveredAccessoriesChips();
  });
}
if (modalAccessoryToggle) {
  modalAccessoryToggle.addEventListener("change", async () => {
    const acc = getActiveModalAcc();
    if (!acc || !modalAccessoryToggle) return;
    acc.enabled = modalAccessoryToggle.checked;
    try {
      await fetch("/api/accessories/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: acc.id })
      });
      flashModalSaved();
      flashAccessorySaved();
      if (modalAccessorySelect) {
        const opt = modalAccessorySelect.querySelector(`option[value="${acc.id}"]`);
        if (opt) opt.textContent = `${acc.name || acc.file} (${acc.enabled ? "Equipped" : "Off"})`;
      }
    } catch (err) {
      console.error("[Studio Tracker] Modal toggle error:", err);
    }
  });
}
if (modalTargetSelect) {
  modalTargetSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.target = e.target.value;
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (modalOrderSelect) {
  modalOrderSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.order = e.target.value;
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (modalExpressionSelect) {
  modalExpressionSelect.addEventListener("change", (e) => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    const val = e.target.value;
    if (val === "__custom__") {
      const customName = prompt("Enter custom expression trigger name (e.g. sweat, crying, angry):");
      if (customName && customName.trim()) {
        const clean = customName.trim().toLowerCase();
        acc.expression = clean;
        populateExpressionSelect(modalExpressionSelect, clean);
        renderModalExpressionPreview(acc);
        debounceSaveAccessory(acc);
        flashModalSaved();
      } else {
        modalExpressionSelect.value = acc.expression || "";
      }
      return;
    }
    acc.expression = val;
    renderModalExpressionPreview(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
function bindModalSlider(sliderEl, numEl, onVal) {
  if (sliderEl && numEl) {
    sliderEl.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      numEl.value = val.toFixed(parseFloat(sliderEl.step) < 1 ? 2 : 0);
      onVal(val);
    });
    numEl.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        sliderEl.value = String(val);
        onVal(val);
      }
    });
  }
}
bindModalSlider(modalSliderX, modalNumX, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.x = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});
bindModalSlider(modalSliderY, modalNumY, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.y = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});
bindModalSlider(modalSliderSX, modalNumSX, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  const isLinked = Boolean(modalLinkScale && modalLinkScale.checked);
  const scales = computeLinkedScale(val, isLinked, "x", acc.scaleX, acc.scaleY);
  acc.scaleX = scales.scaleX;
  acc.scaleY = scales.scaleY;
  if (isLinked) {
    if (modalSliderSY) modalSliderSY.value = String(val);
    if (modalNumSY) modalNumSY.value = val.toFixed(2);
  }
  debounceSaveAccessory(acc);
  flashModalSaved();
});
bindModalSlider(modalSliderSY, modalNumSY, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  const isLinked = Boolean(modalLinkScale && modalLinkScale.checked);
  const scales = computeLinkedScale(val, isLinked, "y", acc.scaleX, acc.scaleY);
  acc.scaleX = scales.scaleX;
  acc.scaleY = scales.scaleY;
  if (isLinked) {
    if (modalSliderSX) modalSliderSX.value = String(val);
    if (modalNumSX) modalNumSX.value = val.toFixed(2);
  }
  debounceSaveAccessory(acc);
  flashModalSaved();
});
bindModalSlider(modalSliderRot, modalNumRot, (val) => {
  const acc = getActiveModalAcc();
  if (!acc) return;
  acc.rotation = val;
  debounceSaveAccessory(acc);
  flashModalSaved();
});
if (btnRotLeft) {
  btnRotLeft.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = nudgeRotation(acc.rotation || 0, -15);
    if (modalSliderRot) modalSliderRot.value = String(acc.rotation);
    if (modalNumRot) modalNumRot.value = String(acc.rotation);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (btnRotZero) {
  btnRotZero.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = 0;
    if (modalSliderRot) modalSliderRot.value = "0";
    if (modalNumRot) modalNumRot.value = "0";
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (btnRotRight) {
  btnRotRight.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.rotation = nudgeRotation(acc.rotation || 0, 15);
    if (modalSliderRot) modalSliderRot.value = String(acc.rotation);
    if (modalNumRot) modalNumRot.value = String(acc.rotation);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (modalBtnReset) {
  modalBtnReset.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.x = 0;
    acc.y = 0;
    acc.scaleX = 1;
    acc.scaleY = 1;
    acc.rotation = 0;
    syncModalControlsFromAcc(acc);
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
nudgeStepBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    nudgeStepBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentNudgeStep = parseInt(btn.dataset.step || "1", 10) || 1;
  });
});
function applyNudge(dx, dy) {
  const acc = getActiveModalAcc();
  if (!acc) return;
  const np = nudgePosition(acc.x || 0, acc.y || 0, dx, dy, currentNudgeStep);
  acc.x = np.x;
  acc.y = np.y;
  if (modalSliderX) modalSliderX.value = String(acc.x);
  if (modalNumX) modalNumX.value = String(acc.x);
  if (modalSliderY) modalSliderY.value = String(acc.y);
  if (modalNumY) modalNumY.value = String(acc.y);
  debounceSaveAccessory(acc);
  flashModalSaved();
}
if (nudgeUp) nudgeUp.addEventListener("click", () => applyNudge(0, -1));
if (nudgeDown) nudgeDown.addEventListener("click", () => applyNudge(0, 1));
if (nudgeLeft) nudgeLeft.addEventListener("click", () => applyNudge(-1, 0));
if (nudgeRight) nudgeRight.addEventListener("click", () => applyNudge(1, 0));
if (nudgeCenter) {
  nudgeCenter.addEventListener("click", () => {
    const acc = getActiveModalAcc();
    if (!acc) return;
    acc.x = 0;
    acc.y = 0;
    if (modalSliderX) modalSliderX.value = "0";
    if (modalNumX) modalNumX.value = "0";
    if (modalSliderY) modalSliderY.value = "0";
    if (modalNumY) modalNumY.value = "0";
    debounceSaveAccessory(acc);
    flashModalSaved();
  });
}
if (btnZoomReset) {
  btnZoomReset.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(1)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "1.0x Zoom";
  });
}
if (btnZoomHead) {
  btnZoomHead.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(1.5) translateY(12%)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "1.5x Head";
  });
}
if (btnZoomTight) {
  btnZoomTight.addEventListener("click", () => {
    if (fittingFrame) fittingFrame.style.transform = "scale(2.0) translateY(18%)";
    if (fittingZoomBadge) fittingZoomBadge.textContent = "2.0x Face";
  });
}
if (btnFittingFreeze) {
  btnFittingFreeze.addEventListener("click", () => {
    fittingMirrorFrozen = !fittingMirrorFrozen;
    updateFittingMirrorSrc();
  });
}
if (btnReloadFitting) {
  btnReloadFitting.addEventListener("click", () => {
    updateFittingMirrorSrc();
  });
}
if (checkShowCrosshair) {
  checkShowCrosshair.addEventListener("change", (e) => {
    if (fittingCrosshair) {
      fittingCrosshair.style.display = e.target.checked ? "block" : "none";
    }
  });
}
var studioWorkspace = document.getElementById("studio-workspace");
var modeNavBtns = document.querySelectorAll(".mode-nav-btn");
var btnJumpWardrobe = document.getElementById("btn-jump-wardrobe");
var btnStreamerMode = document.getElementById("btn-streamer-mode");
function setStudioMode(mode, persist = true) {
  const validMode = normalizeStudioMode(mode);
  if (studioWorkspace) {
    studioWorkspace.dataset.activeMode = validMode;
  }
  modeNavBtns.forEach((btn) => {
    const isMatch = btn.dataset.mode === validMode;
    btn.classList.toggle("active", isMatch);
    btn.setAttribute("aria-current", isMatch ? "page" : "false");
  });
  if (persist) {
    try {
      localStorage.setItem("svgtuber_studio_mode", validMode);
    } catch {
    }
  }
}
function initStudioModeSidebar() {
  let savedMode = null;
  try {
    savedMode = localStorage.getItem("svgtuber_studio_mode");
  } catch {
  }
  setStudioMode(normalizeStudioMode(savedMode), false);
  modeNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetMode = normalizeStudioMode(btn.dataset.mode);
      setStudioMode(targetMode, true);
    });
  });
  if (btnJumpWardrobe) {
    btnJumpWardrobe.addEventListener("click", () => {
      setStudioMode("wardrobe", true);
    });
  }
  const cardTuningSliders = document.getElementById("card-tuning-sliders");
  const tuningTabBtns = document.querySelectorAll(".tuning-tab-btn");
  const setTuningTab = (tab, persist = true) => {
    const validTab = normalizeTuningTab(tab);
    if (cardTuningSliders) {
      cardTuningSliders.dataset.activeTuningTab = validTab;
    }
    tuningTabBtns.forEach((btn) => {
      const isMatch = btn.dataset.tuningTab === validTab;
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-selected", String(isMatch));
    });
    if (persist) {
      try {
        localStorage.setItem("svgtuber_tuning_tab", validTab);
      } catch {
      }
    }
  };
  let savedTuningTab = null;
  try {
    savedTuningTab = localStorage.getItem("svgtuber_tuning_tab");
  } catch {
  }
  setTuningTab(normalizeTuningTab(savedTuningTab), false);
  tuningTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setTuningTab(normalizeTuningTab(btn.dataset.tuningTab), true);
    });
  });
  try {
    const savedAutoCrop = localStorage.getItem("svgtuber_face_autocrop");
    if (savedAutoCrop !== null) {
      faceAutoCropEnabled = savedAutoCrop !== "false" && savedAutoCrop !== "0";
    }
  } catch {
  }
  updateFaceAutocropButtonUI();
  if (btnFaceAutocrop) {
    btnFaceAutocrop.addEventListener("click", () => {
      faceAutoCropEnabled = !faceAutoCropEnabled;
      updateFaceAutocropButtonUI();
      if (!faceAutoCropEnabled) {
        applyFaceCropTransform(null);
      }
      try {
        localStorage.setItem("svgtuber_face_autocrop", String(faceAutoCropEnabled));
      } catch {
      }
    });
  }
}
function applyStreamerMode(enabled, persist = true, saveServer = true) {
  streamerModeEnabled = enabled;
  document.body.classList.toggle("streamer-mode", enabled);
  const btnState = formatStreamerModeButtonState(enabled);
  if (btnStreamerMode) {
    btnStreamerMode.textContent = btnState.text;
    btnStreamerMode.title = btnState.title;
    btnStreamerMode.setAttribute("aria-pressed", String(enabled));
    btnStreamerMode.classList.toggle("is-active", btnState.activeClass);
  }
  if (configPathDisplay && rawConfigPath) {
    configPathDisplay.textContent = maskSensitivePath(rawConfigPath, enabled);
  }
  if (persist) {
    try {
      localStorage.setItem("svgtuber_streamer_mode", String(enabled));
    } catch {
    }
    if (saveServer && activeSettings) {
      debouncedSaveSettings(collectSettingsFromUI());
    }
  }
}
function initStreamerMode() {
  let saved = null;
  try {
    saved = localStorage.getItem("svgtuber_streamer_mode");
  } catch {
  }
  applyStreamerMode(parseStreamerMode(saved), false, false);
  if (btnStreamerMode) {
    btnStreamerMode.addEventListener("click", () => {
      applyStreamerMode(!streamerModeEnabled, true, true);
    });
  }
}
var btnGuidedCalibrate = document.getElementById("btn-guided-calibrate");
var btnGuidedCalibrateTuning = document.getElementById("btn-guided-calibrate-tuning");
var guidedCalOverlay = document.getElementById("guided-calibration-overlay");
var calPillFace = document.getElementById("cal-pill-face");
var calPillMic = document.getElementById("cal-pill-mic");
var btnCalTestBeep = document.getElementById("btn-cal-test-beep");
var btnCalClose = document.getElementById("btn-cal-close");
var calReticle = document.getElementById("cal-reticle");
var calReticleDot = document.getElementById("cal-reticle-dot");
var calReticleArrow = document.getElementById("cal-reticle-arrow");
var calReticlePrompt = document.getElementById("cal-reticle-prompt");
var calCardIntro = document.getElementById("cal-card-intro");
var btnCalStartWindowed = document.getElementById("btn-cal-start-windowed");
var btnCalStartFullscreen = document.getElementById("btn-cal-start-fullscreen");
var calHudActive = document.getElementById("cal-hud-active");
var calStepTitle = document.getElementById("cal-step-title");
var calStepTimer = document.getElementById("cal-step-timer");
var calStepDesc = document.getElementById("cal-step-desc");
var calStepProgress = document.getElementById("cal-step-progress");
var calCardSummary = document.getElementById("cal-card-summary");
var calSumBlinkRange = document.getElementById("cal-sum-blink-range");
var calSumGlare = document.getElementById("cal-sum-glare");
var calSumYawCutoff = document.getElementById("cal-sum-yaw-cutoff");
var calSumVoice = document.getElementById("cal-sum-voice");
var btnCalRerun = document.getElementById("btn-cal-rerun");
var btnCalDone = document.getElementById("btn-cal-done");
var wizardStep = "idle";
var wizardTimerId = null;
var step1Samples = [];
var step2Samples = [];
var step2BeepTimestamps = [];
var step2WinkTimestamps = [];
var step3Samples = [];
var step4Samples = [];
function ingestCalibrationSample(sample) {
  const stamped = {
    ...sample,
    timestamp: performance.now()
  };
  if (wizardStep === "step1_neutral") {
    step1Samples.push(stamped);
  } else if (wizardStep === "step2_blink") {
    step2Samples.push(stamped);
  } else if (wizardStep === "step3_turn") {
    step3Samples.push(stamped);
  } else if (wizardStep === "step4_voice") {
    step4Samples.push(stamped);
  }
  if (guidedCalOverlay && guidedCalOverlay.style.display !== "none") {
    if (calPillFace) {
      if (sample.present) {
        const bL = fuseBlinkScoreClient(
          sample.blendshapes.eyeBlinkLeft || 0,
          sample.blendshapes.earBlinkLeft || 0
        );
        const bR = fuseBlinkScoreClient(
          sample.blendshapes.eyeBlinkRight || 0,
          sample.blendshapes.earBlinkRight || 0
        );
        calPillFace.textContent = `\u{1F4F7} Face: Ready (Blink L ${(bL * 100).toFixed(0)}% \xB7 R ${(bR * 100).toFixed(0)}% | Yaw ${sample.yaw > 0 ? "+" : ""}${sample.yaw.toFixed(0)}\xB0)`;
        calPillFace.className = "cal-pill ok";
      } else {
        calPillFace.textContent = "\u{1F4F7} Face: Waiting...";
        calPillFace.className = "cal-pill warn";
      }
    }
    if (calPillMic) {
      const micPct = Math.min(100, Math.round((sample.audioVolume || 0) * 150));
      calPillMic.textContent = `\u{1F399}\uFE0F Mic: ${micPct}%`;
      calPillMic.className = micPct > 4 ? "cal-pill ok" : "cal-pill";
    }
  }
}
if (calibrationChannel) {
  calibrationChannel.onmessage = (ev) => {
    const data = ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "sample" && data.sample) {
      lastBroadcastSampleTime = performance.now();
      ingestCalibrationSample(data.sample);
    } else if (data.type === "calibrated_settings" && data.settings) {
      activeSettings = data.settings;
      syncSettingsToUI(activeSettings);
      showCalibratedFlash();
    }
  };
}
function setReticleTarget(leftPct, topPct, label, cuePulse = false, visible = true, arrowDir = null) {
  if (!calReticle) return;
  calReticle.style.display = visible ? "flex" : "none";
  calReticle.style.left = `${leftPct}%`;
  calReticle.style.top = `${topPct}%`;
  calReticle.classList.toggle("beep-pulse", cuePulse);
  if (calReticleDot) {
    calReticleDot.style.display = arrowDir ? "none" : "block";
  }
  if (calReticleArrow) {
    if (arrowDir) {
      calReticleArrow.className = `cal-reticle-arrow dir-${arrowDir}`;
      calReticleArrow.textContent = arrowDir === "left" ? "\u2B05" : arrowDir === "right" ? "\u27A1" : arrowDir === "up" ? "\u2B06" : "\u2B07";
    } else {
      calReticleArrow.className = "cal-reticle-arrow";
    }
  }
  if (calReticlePrompt) {
    calReticlePrompt.textContent = label;
  }
}
function showGuidedOverlayInPage() {
  if (!guidedCalOverlay) return;
  wizardStep = "idle";
  if (wizardTimerId) {
    clearInterval(wizardTimerId);
    wizardTimerId = null;
  }
  guidedCalOverlay.style.display = "flex";
  if (calCardIntro) calCardIntro.style.display = "flex";
  if (calHudActive) calHudActive.style.display = "none";
  if (calCardSummary) calCardSummary.style.display = "none";
  setReticleTarget(50, 50, "Look Here", false, false);
}
function closeGuidedOverlay() {
  if (wizardTimerId) {
    clearInterval(wizardTimerId);
    wizardTimerId = null;
  }
  wizardStep = "idle";
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {
    });
  }
  if (isCalibratePopout) {
    window.close();
  }
  if (guidedCalOverlay) {
    guidedCalOverlay.style.display = "none";
  }
}
function launchGuidedCalibration(e) {
  if (isCalibratePopout || e && e.shiftKey) {
    showGuidedOverlayInPage();
    return;
  }
  const popup = window.open(
    "/studio/?calibrate=1",
    "SVGTuberCalibration",
    "popup=yes,width=1200,height=820,left=100,top=60"
  );
  if (!popup) {
    showGuidedOverlayInPage();
  } else {
    popup.focus();
  }
}
async function runGuidedCalibrationSequence(requestFullscreenFirst = false) {
  if (requestFullscreenFirst && !document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
    }
  }
  const ctx = getOrCreateAudioContext();
  if (performance.now() - lastBroadcastSampleTime > 650) {
    if (!webcamRunning && isCameraAllowedInMode(getCurrentMode())) {
      try {
        await startCamera();
      } catch (e) {
        console.warn("[Studio Calibration] Could not start camera:", e);
      }
    }
    if (!micRunning) {
      try {
        await startMic();
      } catch (e) {
        console.warn("[Studio Calibration] Could not start mic:", e);
      }
    }
  }
  step1Samples = [];
  step2Samples = [];
  step2BeepTimestamps = [];
  step2WinkTimestamps = [];
  step3Samples = [];
  step4Samples = [];
  if (calCardIntro) calCardIntro.style.display = "none";
  if (calCardSummary) calCardSummary.style.display = "none";
  if (calHudActive) calHudActive.style.display = "flex";
  const step1Duration = 3e3;
  const step2Duration = 6500;
  const step3Duration = 7200;
  const step4Duration = 4e3;
  const totalDuration = step1Duration + step2Duration + step3Duration + step4Duration;
  const startTime = performance.now();
  let lastBeepMarker = -1;
  wizardStep = "step1_neutral";
  setReticleTarget(50, 50, "LOOK CENTER", false, true);
  playCalibrationCue(ctx, "tick");
  if (wizardTimerId) clearInterval(wizardTimerId);
  wizardTimerId = setInterval(() => {
    const elapsed = performance.now() - startTime;
    const progressPct = Math.min(100, Math.round(elapsed / totalDuration * 100));
    if (calStepProgress) calStepProgress.style.width = `${progressPct}%`;
    if (elapsed < step1Duration) {
      wizardStep = "step1_neutral";
      const rem = ((step1Duration - elapsed) / 1e3).toFixed(1);
      if (calStepTimer) calStepTimer.textContent = `${rem}s`;
      if (calStepTitle) calStepTitle.textContent = "Step 1 of 4: Neutral Rest & Silence";
      if (calStepDesc)
        calStepDesc.textContent = "Look comfortably at the center ring with a relaxed face and stay quiet.";
      setReticleTarget(50, 50, `HOLD CENTER (${Math.ceil((step1Duration - elapsed) / 1e3)}s)`, false, true);
      const secIdx = Math.floor(elapsed / 1e3);
      if (secIdx > 0 && secIdx !== lastBeepMarker) {
        lastBeepMarker = secIdx;
        playCalibrationCue(ctx, "tick");
      }
    } else if (elapsed < step1Duration + step2Duration) {
      if (wizardStep !== "step2_blink") {
        wizardStep = "step2_blink";
        lastBeepMarker = -1;
        playCalibrationCue(ctx, "step_done");
      }
      const stepElapsed = elapsed - step1Duration;
      const rem = ((step2Duration - stepElapsed) / 1e3).toFixed(1);
      if (calStepTimer) calStepTimer.textContent = `${rem}s`;
      if (stepElapsed < 3100) {
        if (calStepTitle) calStepTitle.textContent = "Step 2A of 4: 2 Audio-Cued Blinks (Both Eyes)";
        if (calStepDesc)
          calStepDesc.textContent = "Keep looking center. Blink BOTH eyes firmly on Beep 1 and Beep 2.";
        const biCueTimes = [700, 1950];
        let isPulsing = false;
        biCueTimes.forEach((cueMs, idx) => {
          if (stepElapsed >= cueMs && lastBeepMarker < idx + 10) {
            lastBeepMarker = idx + 10;
            step2BeepTimestamps.push(performance.now());
            playCalibrationCue(ctx, "beep");
          }
          if (stepElapsed >= cueMs && stepElapsed <= cueMs + 500) {
            isPulsing = true;
          }
        });
        setReticleTarget(50, 50, isPulsing ? "BLINK BOTH EYES!" : "GET READY TO BLINK", isPulsing, true);
      } else if (stepElapsed < 4800) {
        if (calStepTitle) calStepTitle.textContent = "Step 2B of 4: Left Eye Wink Calibration";
        if (calStepDesc)
          calStepDesc.textContent = "On the BEEP, close ONLY your LEFT eye for ~1 second while keeping your Right eye open.";
        if (stepElapsed >= 3400 && lastBeepMarker < 12) {
          lastBeepMarker = 12;
          step2WinkTimestamps.push(performance.now());
          playCalibrationCue(ctx, "beep");
        }
        const isPulsing = stepElapsed >= 3400 && stepElapsed <= 4400;
        setReticleTarget(
          38,
          50,
          isPulsing ? "\u{1F609} CLOSE LEFT EYE NOW!" : "GET READY: LEFT EYE",
          isPulsing,
          true
        );
      } else {
        if (calStepTitle) calStepTitle.textContent = "Step 2C of 4: Right Eye Wink Calibration";
        if (calStepDesc)
          calStepDesc.textContent = "On the BEEP, close ONLY your RIGHT eye for ~1 second while keeping your Left eye open.";
        if (stepElapsed >= 5e3 && lastBeepMarker < 13) {
          lastBeepMarker = 13;
          step2WinkTimestamps.push(performance.now());
          playCalibrationCue(ctx, "beep");
        }
        const isPulsing = stepElapsed >= 5e3 && stepElapsed <= 6e3;
        setReticleTarget(
          62,
          50,
          isPulsing ? "\u{1F61C} CLOSE RIGHT EYE NOW!" : "GET READY: RIGHT EYE",
          isPulsing,
          true
        );
      }
    } else if (elapsed < step1Duration + step2Duration + step3Duration) {
      if (wizardStep !== "step3_turn") {
        wizardStep = "step3_turn";
        lastBeepMarker = -1;
        playCalibrationCue(ctx, "step_done");
      }
      const stepElapsed = elapsed - (step1Duration + step2Duration);
      const rem = ((step3Duration - stepElapsed) / 1e3).toFixed(1);
      if (calStepTimer) calStepTimer.textContent = `${rem}s`;
      if (calStepTitle)
        calStepTitle.textContent = "Step 3 of 4: Directional Head Turns (Off-Screen / Side Monitor)";
      if (calStepDesc)
        calStepDesc.textContent = "Turn your head & look naturally in the arrow's direction (e.g. side monitor or room). Listen for the BEEP to switch!";
      if (stepElapsed < 1800) {
        if (lastBeepMarker < 20) {
          lastBeepMarker = 20;
          playCalibrationCue(ctx, "beep");
        }
        setReticleTarget(44, 50, "TURN HEAD & LOOK LEFT (Side Monitor / Off-Screen)", true, true, "left");
      } else if (stepElapsed < 3600) {
        if (lastBeepMarker < 21) {
          lastBeepMarker = 21;
          playCalibrationCue(ctx, "beep");
        }
        setReticleTarget(56, 50, "TURN HEAD & LOOK RIGHT (Side Monitor / Off-Screen)", true, true, "right");
      } else if (stepElapsed < 5400) {
        if (lastBeepMarker < 22) {
          lastBeepMarker = 22;
          playCalibrationCue(ctx, "beep");
        }
        setReticleTarget(50, 44, "TILT HEAD & LOOK UP (Above Monitor)", true, true, "up");
      } else {
        if (lastBeepMarker < 23) {
          lastBeepMarker = 23;
          playCalibrationCue(ctx, "beep");
        }
        setReticleTarget(50, 56, "TILT HEAD & LOOK DOWN (Desk / Keyboard)", true, true, "down");
      }
    } else if (elapsed < totalDuration) {
      if (wizardStep !== "step4_voice") {
        wizardStep = "step4_voice";
        lastBeepMarker = -1;
        playCalibrationCue(ctx, "step_done");
      }
      const stepElapsed = elapsed - (step1Duration + step2Duration + step3Duration);
      const rem = ((step4Duration - stepElapsed) / 1e3).toFixed(1);
      if (calStepTimer) calStepTimer.textContent = `${rem}s`;
      if (calStepTitle) calStepTitle.textContent = "Step 4 of 4: Smile & Normal Speaking Voice";
      if (calStepDesc)
        calStepDesc.textContent = 'Look center, give a big comfortable smile, and say "Testing one, two, three" at your normal speaking volume.';
      setReticleTarget(50, 50, "SMILE & SPEAK", true, true);
      if (stepElapsed >= 250 && lastBeepMarker < 30) {
        lastBeepMarker = 30;
        playCalibrationCue(ctx, "beep");
      }
    } else {
      clearInterval(wizardTimerId);
      wizardTimerId = null;
      wizardStep = "summary";
      playCalibrationCue(ctx, "complete");
      finalizeGuidedCalibration();
    }
  }, 50);
}
async function finalizeGuidedCalibration() {
  setReticleTarget(50, 50, "CALIBRATED \u2713", false, false);
  if (calHudActive) calHudActive.style.display = "none";
  if (calCardSummary) calCardSummary.style.display = "flex";
  const neutral = analyzeNeutralStep(step1Samples);
  const blink = analyzeBeepBlinkStep(
    step2Samples,
    step2BeepTimestamps,
    neutral.blinkOpenL,
    neutral.blinkOpenR,
    step2WinkTimestamps
  );
  const headTurn = analyzeHeadTurnStep(
    step3Samples,
    neutral.neutralYaw,
    neutral.neutralPitch,
    neutral.blinkOpenL,
    neutral.blinkOpenR,
    blink.blinkClosedL,
    blink.blinkClosedR
  );
  const voiceSmile = analyzeVoiceAndSmileStep(
    step4Samples,
    neutral.neutralMouth,
    neutral.neutralSmile,
    neutral.noiseGate
  );
  const profile = buildCalibrationProfile(neutral, blink, voiceSmile);
  let finalThreshL = blink.blinkThresholdL;
  let finalThreshR = blink.blinkThresholdR;
  if (voiceSmile.smileBlinkIntrusionL && voiceSmile.smileBlinkIntrusionL > neutral.blinkOpenL) {
    const remappedIntrusionL = remapBlinkClient(
      voiceSmile.smileBlinkIntrusionL,
      profile.blinkOpenL,
      profile.blinkClosedL
    );
    finalThreshL = Number(Math.min(0.72, Math.max(finalThreshL, remappedIntrusionL + 0.1)).toFixed(2));
  }
  if (voiceSmile.smileBlinkIntrusionR && voiceSmile.smileBlinkIntrusionR > neutral.blinkOpenR) {
    const remappedIntrusionR = remapBlinkClient(
      voiceSmile.smileBlinkIntrusionR,
      profile.blinkOpenR,
      profile.blinkClosedR
    );
    finalThreshR = Number(Math.min(0.72, Math.max(finalThreshR, remappedIntrusionR + 0.1)).toFixed(2));
  }
  if (calSumBlinkRange) {
    calSumBlinkRange.textContent = `L: ${Math.round(profile.blinkOpenL * 100)}%\u2192${Math.round(profile.blinkClosedL * 100)}% (T:${Math.round(finalThreshL * 100)}%) \u2022 R: ${Math.round(profile.blinkOpenR * 100)}%\u2192${Math.round(profile.blinkClosedR * 100)}% (T:${Math.round(finalThreshR * 100)}%)`;
  }
  if (calSumGlare) {
    calSumGlare.textContent = profile.glareAssist ? "Glare Assist ON + 3D EAR" : "3D EAR Hybrid Active";
  }
  if (calSumYawCutoff) {
    calSumYawCutoff.textContent = `\xB1${headTurn.blinkMaxHeadYaw}\xB0 (Yaw ${headTurn.yawMultiplier.toFixed(1)}x, Pitch ${headTurn.pitchMultiplier.toFixed(1)}x)`;
  }
  if (calSumVoice) {
    const micNote = profile.smileWeightL > 0.6 ? " \u2022 Smile L-Boost" : profile.smileWeightR > 0.6 ? " \u2022 Smile R-Boost" : "";
    const pitchNote = profile.neutralPitchHz ? ` \u2022 Pitch ${Math.round(profile.neutralPitchHz)}Hz` : "";
    calSumVoice.textContent = `Gate ${neutral.noiseGate.toFixed(2)} \u2022 Gain ${voiceSmile.micGain.toFixed(1)}x${pitchNote}${micNote}`;
  }
  const current = collectSettingsFromUI();
  current.tracking.calibration = profile;
  current.tracking.blinkThreshold = finalThreshL;
  current.tracking.blinkThresholdL = finalThreshL;
  current.tracking.blinkThresholdR = finalThreshR;
  current.tracking.blinkMaxHeadYaw = headTurn.blinkMaxHeadYaw;
  current.tracking.yawMultiplier = headTurn.yawMultiplier;
  current.tracking.pitchMultiplier = headTurn.pitchMultiplier;
  current.tracking.smileThreshold = voiceSmile.smileThreshold;
  current.tracking.mouthGain = voiceSmile.mouthGain;
  current.tracking.stabilizeBlink = true;
  current.audio.noiseGate = neutral.noiseGate;
  current.audio.micGain = voiceSmile.micGain;
  activeSettings = current;
  syncSettingsToUI(activeSettings);
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current)
    });
    if (calibrationChannel) {
      calibrationChannel.postMessage({ type: "calibrated_settings", settings: current });
    }
  } catch (err) {
    console.error("[Studio Calibration] Failed to save calibrated profile:", err);
  }
}
if (btnGuidedCalibrate) {
  btnGuidedCalibrate.addEventListener("click", (e) => launchGuidedCalibration(e));
}
if (btnGuidedCalibrateTuning) {
  btnGuidedCalibrateTuning.addEventListener("click", (e) => launchGuidedCalibration(e));
}
if (btnCalTestBeep) {
  btnCalTestBeep.addEventListener("click", () => {
    playCalibrationCue(getOrCreateAudioContext(), "beep");
  });
}
if (btnCalStartWindowed) {
  btnCalStartWindowed.addEventListener("click", () => {
    runGuidedCalibrationSequence(false);
  });
}
if (btnCalStartFullscreen) {
  btnCalStartFullscreen.addEventListener("click", () => {
    runGuidedCalibrationSequence(true);
  });
}
if (btnCalRerun) {
  btnCalRerun.addEventListener("click", () => {
    runGuidedCalibrationSequence(false);
  });
}
if (btnCalClose) {
  btnCalClose.addEventListener("click", closeGuidedOverlay);
}
if (btnCalDone) {
  btnCalDone.addEventListener("click", closeGuidedOverlay);
}
if (isCalibratePopout) {
  showGuidedOverlayInPage();
}
initStudioModeSidebar();
initStreamerMode();
connectWebSocket();
loadSettings().finally(() => {
  initMediaPipe();
});
loadExpressions();
loadAvatars();
loadAccessories();
