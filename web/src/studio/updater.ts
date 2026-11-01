/**
 * Pure helper functions and types for Studio Self-Updater UI.
 */

export interface UpdateCheckPayload {
  currentVersion: string;
  latestVersion: string;
  tagName?: string;
  updateAvailable: boolean;
  releaseName?: string;
  releaseNotes?: string;
  htmlUrl?: string;
  installMode?: string;
  assetName?: string;
  assetSize?: number;
  downloadUrl?: string;
}

export interface UpdateProgressMessage {
  type: "update_progress";
  stage: "downloading" | "applying";
  downloaded?: number;
  total?: number;
  asset?: string;
  version?: string;
}

export function normalizeVersionTag(ver: string): string {
  const clean = (ver || "").trim();
  if (!clean) return "v0.0.8";
  return clean.startsWith("v") || clean.startsWith("V") ? `v${clean.slice(1)}` : `v${clean}`;
}

export function formatUpdateBadgeText(latestVersion: string): string {
  return `⬆ Update ${normalizeVersionTag(latestVersion)}`;
}

export function formatAssetSize(bytes?: number): string {
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

export function formatInstallModeLabel(mode?: string): string {
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

export function computeDownloadPercent(downloaded?: number, total?: number): number {
  const cur = Number(downloaded) || 0;
  const max = Number(total) || 0;
  if (cur <= 0 || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
}
