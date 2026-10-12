/**
 * Studio Camera & Mode State Logic
 */

export function isCameraAllowedInMode(mode?: string | null): boolean {
  return mode !== "audio";
}

export function shouldAutoStartCamera(
  mode: string | null | undefined,
  cameraActiveStorage: string | null
): boolean {
  if (!isCameraAllowedInMode(mode)) {
    return false;
  }
  return cameraActiveStorage === "true" || cameraActiveStorage === null;
}

export function getCameraStatus(
  webcamRunning: boolean,
  micRunning: boolean,
  mode?: string | null
): { text: string; className: string } {
  if (!isCameraAllowedInMode(mode)) {
    return {
      text: micRunning ? "Audio Only (Mic Active)" : "Audio Only (Mic Off)",
      className: micRunning ? "status-ok" : "status-warn",
    };
  }

  if (webcamRunning) {
    return {
      text: "Tracking Active",
      className: "status-ok",
    };
  }

  return {
    text: micRunning
      ? "Camera Off (Face Lost) - Audio Active"
      : "Camera Off (Face Lost)",
    className: "status-warn",
  };
}

export function getCameraButtonState(
  webcamRunning: boolean,
  mode?: string | null
): {
  text: string;
  disabled: boolean;
  isDanger: boolean;
  title: string;
} {
  if (!isCameraAllowedInMode(mode)) {
    return {
      text: "Camera Disabled (Audio Only)",
      disabled: true,
      isDanger: false,
      title: "Camera is disabled in Audio Only mode",
    };
  }

  if (webcamRunning) {
    return {
      text: "Stop Camera",
      disabled: false,
      isDanger: true,
      title: "",
    };
  }

  return {
    text: "Start Camera",
    disabled: false,
    isDanger: false,
    title: "",
  };
}
