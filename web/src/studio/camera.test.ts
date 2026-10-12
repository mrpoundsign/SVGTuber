import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCameraAllowedInMode,
  shouldAutoStartCamera,
  getCameraStatus,
  getCameraButtonState,
  computeSessionBannerState,
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

  it("computes session banner state correctly for multi-tab sessions", () => {
    // Single tab: no banner
    assert.deepEqual(computeSessionBannerState(true, 1), {
      showBanner: false,
      message: "",
      showTakeOver: false,
    });
    assert.deepEqual(computeSessionBannerState(false, 0), {
      showBanner: false,
      message: "",
      showTakeOver: false,
    });

    // Multiple tabs: active tab
    const activeMulti = computeSessionBannerState(true, 2);
    assert.equal(activeMulti.showBanner, true);
    assert.equal(activeMulti.showTakeOver, false);
    assert.match(activeMulti.message, /Multiple Studio tabs open \(2 connected\)/);
    assert.match(activeMulti.message, /Tracking is active in this tab/);

    // Multiple tabs: inactive tab
    const inactiveMulti = computeSessionBannerState(false, 3);
    assert.equal(inactiveMulti.showBanner, true);
    assert.equal(inactiveMulti.showTakeOver, true);
    assert.match(inactiveMulti.message, /Multiple Studio tabs open \(3 connected\)/);
    assert.match(inactiveMulti.message, /Tracking locked to another tab/);
    assert.equal(inactiveMulti.statusText, "Tracking Inactive (Other Tab Active)");
    assert.equal(inactiveMulti.statusClass, "status-warn");
  });
});

