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

export interface SessionBannerState {
  showBanner: boolean;
  message: string;
  showTakeOver: boolean;
  statusText?: string;
  statusClass?: string;
}

export function computeSessionBannerState(
  isActive: boolean,
  connectedTabs: number
): SessionBannerState {
  if (connectedTabs <= 1) {
    return {
      showBanner: false,
      message: "",
      showTakeOver: false,
    };
  }

  if (isActive) {
    return {
      showBanner: true,
      message: `Multiple Studio tabs open (${connectedTabs} connected). Tracking is active in this tab.`,
      showTakeOver: false,
    };
  }

  return {
    showBanner: true,
    message: `Multiple Studio tabs open (${connectedTabs} connected). Tracking locked to another tab to prevent jitter.`,
    showTakeOver: true,
    statusText: "Tracking Inactive (Other Tab Active)",
    statusClass: "status-warn",
  };
}
