import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateRMS,
  stepAudioVolume,
  evaluateSpeechGate,
  analyzeAudioSpectrum,
  detectShoutAndLaugh,
} from "./audio.ts";

describe("Audio Processing & Speech Gate", () => {
  test("calculateRMS returns zero for empty or silent buffer", () => {
    assert.equal(calculateRMS([]), 0);
    assert.equal(calculateRMS(new Float32Array([0, 0, 0, 0])), 0);
  });

  test("calculateRMS computes correct root mean square for signal", () => {
    // Constant value signal of 0.5: RMS = sqrt(0.5^2) = 0.5
    const constantSignal = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    assert.equal(calculateRMS(constantSignal), 0.5);

    // Bipolar square wave of +1 and -1: RMS = sqrt((1 + 1) / 2) = 1.0
    const squareWave = new Float32Array([1.0, -1.0, 1.0, -1.0]);
    assert.equal(calculateRMS(squareWave), 1.0);
  });

  test("stepAudioVolume attacks immediately on higher volume", () => {
    const current = 0.1;
    const newRms = 0.8;
    const result = stepAudioVolume(current, newRms);
    assert.equal(result, 0.8);
  });

  test("stepAudioVolume decays smoothly on lower volume", () => {
    const current = 0.8;
    const newRms = 0.0;
    const decay = 0.2;
    const result = stepAudioVolume(current, newRms, decay);
    // 0.8 * (1 - 0.2) + 0 = 0.64
    assert.ok(Math.abs(result - 0.64) < 1e-6);
  });

  test("evaluateSpeechGate compares amplified volume against threshold", () => {
    // 0.02 * 1.5 = 0.03 < 0.04 (quiet, not speaking)
    assert.equal(evaluateSpeechGate(0.02, 1.5, 0.04), false);

    // 0.05 * 1.5 = 0.075 >= 0.04 (speaking)
    assert.equal(evaluateSpeechGate(0.05, 1.5, 0.04), true);
  });

  test("analyzeAudioSpectrum classifies 5 vowels (A, I, U, E, O) and voice pitch", () => {
    const sampleRate = 48000;
    const numBins = 512; // fftSize = 1024 -> 46.875 Hz/bin
    const binHz = sampleRate / (numBins * 2);

    const fillBand = (bins: Uint8Array, minHz: number, maxHz: number, val: number) => {
      const s = Math.max(1, Math.floor(minHz / binHz));
      const e = Math.min(numBins - 1, Math.ceil(maxHz / binHz));
      for (let i = s; i <= e; i++) bins[i] = val;
    };

    // 1. Open Vowel 'A' (strong F1 700-1050 Hz + central F2 1100-1400 Hz)
    const binsA = new Uint8Array(numBins);
    fillBand(binsA, 150, 200, 180); // F0 around ~175 Hz
    fillBand(binsA, 720, 1050, 230);
    fillBand(binsA, 1100, 1380, 190);
    const resA = analyzeAudioSpectrum(binsA, sampleRate, true, 175);
    assert.equal(resA.viseme, "A");
    assert.ok(resA.visemeA > 0.7);
    assert.ok(Math.abs(resA.pitch - 0.5) < 0.1, `Expected pitch near 0.5, got ${resA.pitch}`);

    // 2. High-Front Vowel 'I' ("ee": low F1 200-350 Hz + strong high F2 2300-3200 Hz)
    const binsI = new Uint8Array(numBins);
    fillBand(binsI, 220, 340, 210); // Higher F0
    fillBand(binsI, 2300, 3200, 240);
    const resI = analyzeAudioSpectrum(binsI, sampleRate, true, 165);
    assert.equal(resI.viseme, "I");
    assert.ok(resI.visemeI > resI.visemeA);
    assert.ok(resI.pitch > 0.6, `Expected high pitch > 0.6, got ${resI.pitch}`);

    // 3. Close-Back Vowel 'U' ("oo": strong low band 100-360 Hz, minimal high frequencies + optical pucker)
    const binsU = new Uint8Array(numBins);
    fillBand(binsU, 110, 350, 230);
    const resU = analyzeAudioSpectrum(binsU, sampleRate, true, 165, {
      mouthOpen: 0.2,
      mouthPucker: 0.65,
    });
    assert.equal(resU.viseme, "U");
    assert.ok(resU.visemeU > 0.7);

    // 4. Mid-Front Vowel 'E' ("eh": F1 420-620 Hz + F2 1600-2050 Hz)
    const binsE = new Uint8Array(numBins);
    fillBand(binsE, 420, 620, 200);
    fillBand(binsE, 1600, 2050, 235);
    const resE = analyzeAudioSpectrum(binsE, sampleRate, true, 165);
    assert.equal(resE.viseme, "E");
    assert.ok(resE.visemeE > 0.7);

    // 5. Mid-Back Rounded Vowel 'O' ("oh": F1 420-650 Hz + F2 850-1250 Hz, low F2High)
    const binsO = new Uint8Array(numBins);
    fillBand(binsO, 420, 650, 220);
    fillBand(binsO, 880, 1250, 210);
    const resO = analyzeAudioSpectrum(binsO, sampleRate, true, 165);
    assert.equal(resO.viseme, "O");
    assert.ok(resO.visemeO > 0.7);
  });

  test("detectShoutAndLaugh detects high-energy shouting and rhythmic staccato laughter", () => {
    // Shouting: volume 0.65 * micGain 1.5 = 0.975 >= 0.82
    const shoutRes = detectShoutAndLaugh(0.65, 1.5, 0.04, [0.5, 0.6, 0.65]);
    assert.equal(shoutRes.isShouting, true);
    assert.equal(shoutRes.isLaughing, false);

    // Laughing: rhythmic "ha-ha-ha" bursts (3 peaks separated by valleys)
    const laughHistory = [0.01, 0.18, 0.02, 0.22, 0.02, 0.19, 0.02, 0.21, 0.02];
    const laughRes = detectShoutAndLaugh(0.15, 1.5, 0.04, laughHistory, 0.1);
    assert.equal(laughRes.isLaughing, true);

    // Steady normal speech is neither shouting nor laughing
    const steadySpeech = [0.12, 0.13, 0.14, 0.13, 0.12, 0.13, 0.13, 0.12];
    const steadyRes = detectShoutAndLaugh(0.13, 1.5, 0.04, steadySpeech, 0.1);
    assert.equal(steadyRes.isShouting, false);
    assert.equal(steadyRes.isLaughing, false);
  });
});
