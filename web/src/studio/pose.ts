/**
 * MediaPipe Pose and Euler Angle Extraction
 */

export interface PoseAngles {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
}

export function extractEulerAngles(
  matrix: number[] | Float32Array | null | undefined
): PoseAngles {
  if (!matrix || matrix.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  }
  const m00 = matrix[0],
    m10 = matrix[1],
    m20 = matrix[2];
  const m01 = matrix[4],
    m11 = matrix[5],
    m21 = matrix[6];
  const m02 = matrix[8],
    m12 = matrix[9],
    m22 = matrix[10];
  const m03 = matrix[12],
    m13 = matrix[13],
    m23 = matrix[14];

  // Tait-Bryan angles (YXZ order)
  const pitchRad = Math.asin(-Math.max(-1, Math.min(1, m12)));
  const yawRad = Math.atan2(m02, m22);
  const rollRad = Math.atan2(m10, m11);

  const radToDeg = 180 / Math.PI;

  const normalizeZero = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);

  return {
    yaw: normalizeZero(yawRad * radToDeg),
    pitch: normalizeZero(pitchRad * radToDeg),
    roll: normalizeZero(rollRad * radToDeg),
    x: normalizeZero(m03),
    y: normalizeZero(m13),
    z: normalizeZero(m23),
  };
}

export interface Landmark3D {
  x: number;
  y: number;
  z?: number;
}

export interface EyeClosureEAR {
  earL: number;
  earR: number;
  earBlinkLeft: number;
  earBlinkRight: number;
}

function dist3D(a: Landmark3D, b: Landmark3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function earToBlinkClosure(ear: number, openEar = 0.28, closedEar = 0.11): number {
  const span = Math.max(0.05, openEar - closedEar);
  const closure = (openEar - ear) / span;
  return Math.max(0, Math.min(1, closure));
}

/**
 * Computes geometric Eye Aspect Ratio (EAR) and normalized closure [0.0=open, 1.0=closed]
 * from MediaPipe's 478 3D face mesh landmarks.
 * - Left Eye (anatomical left / eyeBlinkLeft): corners (263, 362), vertical pairs (386, 374), (385, 380)
 * - Right Eye (anatomical right / eyeBlinkRight): corners (33, 133), vertical pairs (159, 145), (158, 153)
 */
export function computeEyeAspectRatios(
  landmarks: Landmark3D[] | null | undefined
): EyeClosureEAR | null {
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

  const earL = (dist3D(lUp1, lLow1) + dist3D(lUp2, lLow2)) / (2.0 * horizL);
  const earR = (dist3D(rUp1, rLow1) + dist3D(rUp2, rLow2)) / (2.0 * horizR);

  return {
    earL,
    earR,
    earBlinkLeft: earToBlinkClosure(earL),
    earBlinkRight: earToBlinkClosure(earR),
  };
}

export interface MouthGeometricFeatures {
  geoFrownLeft: number;
  geoFrownRight: number;
  mouthGapRatio: number;
}

/**
 * Computes head-roll-compensated 3D mouth-corner droop (geoFrownLeft, geoFrownRight in [0..1])
 * and inner lip vertical gap ratio from MediaPipe's 478 face landmarks.
 * Supplements MediaPipe's low-amplitude mouthFrownLeft/Right TFLite blendshapes.
 */
export function computeMouthGeometry(
  landmarks: Landmark3D[] | null | undefined
): MouthGeometricFeatures | null {
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

  // Head roll compensation using outer eye corners
  const rollAngle = Math.atan2(lEye.y - rEye.y, lEye.x - rEye.x);
  const downX = -Math.sin(rollAngle);
  const downY = Math.cos(rollAngle);

  const centerX = (upperInner.x + lowerInner.x) * 0.5;
  const centerY = (upperInner.y + lowerInner.y) * 0.5;

  // Positive projection along local downward axis means mouth corner sits below lip center
  const dropL = ((lCorner.x - centerX) * downX + (lCorner.y - centerY) * downY) / mouthWidth;
  const dropR = ((rCorner.x - centerX) * downX + (rCorner.y - centerY) * downY) / mouthWidth;

  const mapDropToFrown = (drop: number) => {
    const norm = (drop - 0.01) / 0.095;
    return Math.max(0, Math.min(1, norm));
  };

  const gap = dist3D(upperInner, lowerInner) / mouthWidth;

  return {
    geoFrownLeft: mapDropToFrown(dropL),
    geoFrownRight: mapDropToFrown(dropR),
    mouthGapRatio: Math.max(0, Math.min(1, gap)),
  };
}

export interface RGBSample {
  r: number;
  g: number;
  b: number;
}

/**
 * Evaluates optical tongue protrusion [0.0 .. 1.0] by comparing the oral cavity interior
 * (between upper inner lip #13 and lower outer lip #17) against reference facial skin.
 * MediaPipe's 478-point FaceLandmarker mesh has no tongue landmarks, so its TFLite
 * `tongueOut` blendshape is permanently 0 on RGB webcams. When the mouth opens normally,
 * the oral cavity is shadowed/dark; when the tongue protrudes, it fills the lower mouth
 * gap with bright pink/red tissue.
 */
export function evaluateOpticalTongue(
  cavity: RGBSample,
  skin: RGBSample,
  mouthGapRatio: number,
  jawOpen: number
): number {
  const effectiveOpen = Math.max(jawOpen, mouthGapRatio * 2.2);
  if (effectiveOpen < 0.10) {
    return 0;
  }

  const cavityLuma = 0.299 * cavity.r + 0.587 * cavity.g + 0.114 * cavity.b;
  const skinLuma = Math.max(20, 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b);

  // Dark oral cavity shadow check: an open mouth without a protruding tongue is dark inside
  const lumaRatio = cavityLuma / skinLuma;
  if (lumaRatio < 0.46) {
    return 0;
  }

  // Pink/red chroma of the tongue vs surrounding skin
  const cavityRedGreen = (cavity.r - cavity.g) / Math.max(30, cavity.r + cavity.g);
  const skinRedGreen = (skin.r - skin.g) / Math.max(30, skin.r + skin.g);
  const cavityRedBlue = (cavity.r - cavity.b) / Math.max(30, cavity.r + cavity.b);

  if (cavity.r < 65 || cavityRedGreen < 0.08 || cavityRedBlue < 0.06) {
    return 0;
  }

  // Tongue tissue is typically pinker/redder than cheek/chin skin OR bright pink filling the open mouth gap
  const pinkBoost = Math.max(0, cavityRedGreen - skinRedGreen * 0.82);
  const rawScore = ((lumaRatio - 0.44) * 1.4 + pinkBoost * 4.5) * Math.min(1.0, (effectiveOpen - 0.08) / 0.18);
  return Math.max(0, Math.min(1, rawScore));
}
