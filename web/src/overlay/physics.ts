/**
 * Secondary Physics Simulation: Sway, Spring & Bounce Dynamics
 */

export interface PhysicsOscillatorState {
  current: number;
  velocity: number;
}

export function createPhysicsOscillatorState(initial: number = 0): PhysicsOscillatorState {
  return { current: initial, velocity: 0 };
}

export function stepOscillator(
  state: PhysicsOscillatorState,
  target: number,
  stiffness: number = 0.15,
  damping: number = 0.82,
  mass: number = 0.5,
  dt: number = 1.0
): number {
  const safeDt = Math.min(Math.max(dt, 0.1), 3.0);
  const displacement = target - state.current;
  const springForce = displacement * stiffness;
  const accel = springForce / Math.max(0.05, mass);

  state.velocity = (state.velocity + accel * safeDt) * Math.pow(damping, safeDt);
  state.current += state.velocity * safeDt;

  if (Math.abs(state.velocity) < 0.0001 && Math.abs(displacement) < 0.0001) {
    state.current = target;
    state.velocity = 0;
  }

  return state.current;
}

export interface BounceParams {
  height?: number;
  squash?: number;
  minVolume?: number;
  speed?: number;
}

export interface BounceOutput {
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

export function calculateVoiceBounce(
  nowMs: number,
  volume: number,
  isSpeaking: boolean,
  bounceMultiplier: number = 1.0,
  params: BounceParams = {}
): BounceOutput {
  if (bounceMultiplier <= 0) {
    return { offsetY: 0, scaleX: 1.0, scaleY: 1.0 };
  }

  const height = params.height ?? 7;
  const squash = params.squash ?? 0.04;
  const minVol = params.minVolume ?? 0.03;
  const speed = params.speed ?? 16;

  if (!isSpeaking || volume <= 0.01) {
    return { offsetY: 0, scaleX: 1.0, scaleY: 1.0 };
  }

  const normVol = Math.min(1.0, Math.max(0.2, (volume - minVol) / Math.max(0.01, 1.0 - minVol)));
  const hop = Math.abs(Math.sin(nowMs * speed * 0.001));
  const bounceOffset = -hop * height * normVol * bounceMultiplier;

  let sx = 1.0;
  let sy = 1.0;
  if (squash > 0) {
    sy = 1.0 + hop * squash * normVol * bounceMultiplier;
    sx = 1.0 - hop * squash * 0.5 * normVol * bounceMultiplier;
  }

  return { offsetY: bounceOffset, scaleX: sx, scaleY: sy };
}
