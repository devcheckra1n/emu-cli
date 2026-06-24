/**
 * Drive aria2c to download a single file out of a platform torrent.
 *
 * We pass the locally-cached .torrent plus `--select-file=<index>` so only the
 * chosen ROM's pieces are fetched, and `--bt-prioritize-piece=head,tail` for a
 * fast start. The selected file is BitTorrent piece-hash verified inherently.
 * Progress is parsed from aria2c's console readout in real time.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Config } from "../config.ts";
import type { DownloadProgress, TorrentFile } from "../types.ts";
import { whichBin } from "../emulator/detect.ts";

export const ARIA2C_INSTALL_HINT =
  process.platform === "darwin"
    ? "brew install aria2"
    : "sudo apt install aria2   (or your distro's package manager)";

export function findAria2c(config: Config): string | null {
  if (config.aria2cPath) return existsSync(config.aria2cPath) ? config.aria2cPath : null;
  return whichBin("aria2c");
}

/** Absolute path the selected file will occupy once downloaded. */
export function downloadedFilePath(downloadDir: string, file: TorrentFile): string {
  return join(downloadDir, file.path);
}

export interface DownloadOptions {
  aria2c: string;
  torrentPath: string;
  file: TorrentFile;
  downloadDir: string;
  config: Config;
  onProgress?: (p: DownloadProgress) => void;
}

export interface DownloadHandle {
  /** Resolves on success; rejects on aria2c failure or cancellation. */
  completed: Promise<void>;
  /** Terminate aria2c and clean up the partial file. */
  cancel: () => void;
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
};

function parseSize(token: string): number {
  const m = token.match(/([\d.]+)\s*([KMGT]?i?B)/i);
  if (!m) return 0;
  const unit = (m[2] ?? "B").toUpperCase();
  return Math.round(parseFloat(m[1] ?? "0") * (SIZE_UNITS[unit] ?? 1));
}

/** Extract progress from the latest `[#gid …]` readout token in a chunk. */
function parseReadout(chunk: string, totalBytes: number): DownloadProgress | null {
  const tokens = chunk.match(/\[#[^\]]*\]/g);
  if (!tokens || tokens.length === 0) return null;
  const t = tokens[tokens.length - 1]!;

  const sizes = t.match(/([\d.]+[KMGT]?i?B)\/([\d.]+[KMGT]?i?B)\((\d+)%\)/i);
  const dl = t.match(/DL:\s*([\d.]+[KMGT]?i?B)/i);
  const cn = t.match(/CN:\s*(\d+)/i);

  let completedBytes = 0;
  let total = totalBytes;
  let ratio = 0;
  if (sizes) {
    completedBytes = parseSize(sizes[1]!);
    total = parseSize(sizes[2]!) || totalBytes;
    ratio = Math.min(1, parseInt(sizes[3]!, 10) / 100);
  } else {
    const pct = t.match(/\((\d+)%\)/);
    if (!pct) return null;
    ratio = Math.min(1, parseInt(pct[1]!, 10) / 100);
    completedBytes = Math.round(ratio * totalBytes);
  }

  return {
    ratio,
    completedBytes,
    totalBytes: total,
    downloadSpeed: dl ? parseSize(dl[1]!) : 0,
    connections: cn ? parseInt(cn[1]!, 10) : 0,
  };
}

function buildArgs(opts: DownloadOptions): string[] {
  return [
    `--dir=${opts.downloadDir}`,
    `--select-file=${opts.file.index}`,
    "--bt-prioritize-piece=head,tail",
    "--seed-time=0", // exit once the download completes; don't seed
    "--file-allocation=none", // avoid stalling on large disc images
    "--summary-interval=1", // guarantees periodic progress when stdout isn't a tty
    "--console-log-level=warn",
    "--enable-color=false",
    "--bt-save-metadata=false",
    "--enable-dht=true",
    // DHT is useless without a bootstrap node on first run (no dht.dat yet),
    // and is the only peer source when trackers are blocked/throttled.
    "--dht-entry-point=router.bittorrent.com:6881",
    "--dht-entry-point6=router.bittorrent.com:6881",
    "--bt-enable-lpd=true",
    "--bt-max-peers=80",
    "--auto-save-interval=1",
    opts.torrentPath,
  ];
}

export function startDownload(opts: DownloadOptions): DownloadHandle {
  const args = buildArgs(opts);
  const proc = Bun.spawn([opts.aria2c, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let cancelled = false;
  const stderrLines: string[] = [];

  const pump = (async () => {
    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const p = parseReadout(text, opts.file.length);
      if (p && opts.onProgress) opts.onProgress(p);
    }
  })();

  const drainStderr = (async () => {
    const decoder = new TextDecoder();
    const reader = proc.stderr.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split("\n")) {
        if (line.trim()) stderrLines.push(line.trim());
      }
    }
  })();

  const completed = (async () => {
    const code = await proc.exited;
    await Promise.allSettled([pump, drainStderr]);
    if (cancelled) {
      await cleanupPartial(opts);
      throw new Error("Download cancelled.");
    }
    if (code !== 0) {
      await cleanupPartial(opts);
      const tail = stderrLines.slice(-8).join("\n");
      throw new Error(
        `aria2c exited with code ${code}.` + (tail ? `\n${tail}` : ""),
      );
    }
    // Final 100% tick so the UI settles on complete.
    opts.onProgress?.({
      ratio: 1,
      completedBytes: opts.file.length,
      totalBytes: opts.file.length,
      downloadSpeed: 0,
      connections: 0,
    });
  })();

  return {
    completed,
    cancel: () => {
      cancelled = true;
      proc.kill();
    },
  };
}

async function cleanupPartial(opts: DownloadOptions): Promise<void> {
  const file = downloadedFilePath(opts.downloadDir, opts.file);
  await rm(file, { force: true }).catch(() => {});
  await rm(`${file}.aria2`, { force: true }).catch(() => {});
}
