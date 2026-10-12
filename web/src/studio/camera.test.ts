import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCameraAllowedInMode,
  shouldAutoStartCamera,
  getCameraStatus,
  getCameraButtonState,
} from "./camera.ts";

describe("Studio Camera & Mode Logic", () => {
  it("determines whether camera is allowed in mode", () => {
    assert.equal(isCameraAllowedInMode("hybrid"), true);
    assert.equal(isCameraAllowedInMode("camera"), true);
    assert.equal(isCameraAllowedInMode(undefined), true);
    assert.equal(isCameraAllowedInMode(null), true);
    assert.equal(isCameraAllowedInMode("audio"), false);
  });

  it("determines shouldAutoStartCamera correctly", () => {
    // In audio mode, should NEVER auto-start
    assert.equal(shouldAutoStartCamera("audio", "true"), false);
    assert.equal(shouldAutoStartCamera("audio", null), false);
    assert.equal(shouldAutoStartCamera("audio", "false"), false);

    // In hybrid / camera mode
    assert.equal(shouldAutoStartCamera("hybrid", "true"), true);
    assert.equal(shouldAutoStartCamera("hybrid", null), true); // default is auto-start on fresh load
    assert.equal(shouldAutoStartCamera("hybrid", "false"), false); // user previously stopped camera
    assert.equal(shouldAutoStartCamera("camera", "true"), true);
    assert.equal(shouldAutoStartCamera("camera", "false"), false);
  });

  it("computes camera status text and class for all combinations", () => {
    // Audio mode
    assert.deepEqual(getCameraStatus(false, true, "audio"), {
      text: "Audio Only (Mic Active)",
      className: "status-ok",
    });
    assert.deepEqual(getCameraStatus(false, false, "audio"), {
      text: "Audio Only (Mic Off)",
      className: "status-warn",
    });

    // Tracking active
    assert.deepEqual(getCameraStatus(true, true, "hybrid"), {
      text: "Tracking Active",
      className: "status-ok",
    });

    // Camera off / lost
    assert.deepEqual(getCameraStatus(false, true, "hybrid"), {
      text: "Camera Off (Face Lost) - Audio Active",
      className: "status-warn",
    });
    assert.deepEqual(getCameraStatus(false, false, "hybrid"), {
      text: "Camera Off (Face Lost)",
      className: "status-warn",
    });
  });

  it("computes button state for all modes and running states", () => {
    // Audio mode: disabled
    const audioState = getCameraButtonState(false, "audio");
    assert.equal(audioState.disabled, true);
    assert.equal(audioState.text, "Camera Disabled (Audio Only)");
    assert.equal(audioState.isDanger, false);

    // Camera running: Stop Camera
    const runningState = getCameraButtonState(true, "hybrid");
    assert.equal(runningState.disabled, false);
    assert.equal(runningState.text, "Stop Camera");
    assert.equal(runningState.isDanger, true);

    // Camera stopped: Start Camera
    const stoppedState = getCameraButtonState(false, "hybrid");
    assert.equal(stoppedState.disabled, false);
    assert.equal(stoppedState.text, "Start Camera");
    assert.equal(stoppedState.isDanger, false);
  });
});
