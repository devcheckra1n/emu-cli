/** Human-readable formatting helpers for the TUI. */

export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v < 10 ? 2 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function progressBar(ratio: number, width: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}
