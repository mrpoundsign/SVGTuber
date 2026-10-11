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
