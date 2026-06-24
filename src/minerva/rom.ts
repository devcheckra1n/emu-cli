/**
 * Resolve a chosen ROM to a concrete download target: the platform's CDN
 * .torrent plus the 1-based file index of that ROM inside it.
 *
 * MiNERVA distributes one torrent per platform/collection (not per ROM), e.g.
 *   https://cdn.minerva-archive.org/torrents/Minerva_Myrient - No-Intro - Nintendo - Game Boy Advance.torrent
 * A single ROM is one file within that torrent, fetched via aria2c --select-file.
 */
import { parse } from "node-html-parser";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { DownloadTarget, PlatformDef, RomEntry, TorrentFile } from "../types.ts";
import { MinervaError, safeDecodeURIComponent } from "./browse.ts";
import { readJsonCache, writeJsonCache, isStale, cachePath } from "./index-cache.ts";
import { parseTorrent } from "./torrent.ts";

const USER_AGENT = "emu-cli/0.1 (+https://github.com/; terminal ROM launcher)";

function cdnTorrentsUrl(config: Config): string {
  return `${config.cdnBaseUrl}/torrents/`;
}

function torrentFileUrl(config: Config, name: string): string {
  return `${config.cdnBaseUrl}/torrents/${encodeURIComponent(name)}`;
}

// ── CDN torrent listing (cached) ───────────────────────────────────────────
interface TorrentListCache {
  fetchedAt: number;
  names: string[];
}

function parseTorrentList(html: string): string[] {
  const root = parse(html);
  const names = new Set<string>();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (!href.toLowerCase().endsWith(".torrent")) continue;
    const base = safeDecodeURIComponent(href.split("/").pop() ?? href);
    names.add(base);
  }
  return [...names];
}

export async function loadCdnTorrentList(
  config: Config,
  opts: { force?: boolean } = {},
): Promise<string[]> {
  const cached = await readJsonCache<TorrentListCache>("torrents.json");
  if (cached && !opts.force && !isStale(cached.fetchedAt, config.indexMaxAgeDays)) {
    return cached.names;
  }
  let res: Response;
  try {
    res = await fetch(cdnTorrentsUrl(config), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (cached) return cached.names;
    throw new MinervaError("Could not reach the MiNERVA CDN torrent index.", e);
  }
  if (!res.ok) {
    if (cached) return cached.names;
    throw new MinervaError(`CDN torrent index returned HTTP ${res.status}.`);
  }
  const names = parseTorrentList(await res.text());
  await writeJsonCache("torrents.json", { fetchedAt: Date.now(), names } satisfies TorrentListCache);
  return names;
}

// ── Platform → torrent name ────────────────────────────────────────────────
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Build the canonical torrent name, e.g. "...No-Intro - Nintendo - Game Boy Advance". */
function expectedTorrentBase(platform: PlatformDef): string {
  if (platform.torrentBase) return platform.torrentBase;
  const parts = [platform.collection, platform.systemFolder].filter(Boolean);
  return `Minerva_Myrient - ${parts.join(" - ")}`;
}

export function resolveTorrentName(platform: PlatformDef, names: string[]): string {
  const base = expectedTorrentBase(platform);
  const exact = `${base}.torrent`;
  if (names.includes(exact)) return exact;

  // Shortest name that begins with the prefix wins (avoids "(Aftermarket)" etc.,
  // but picks "MAME - ROMs (merged)" when the bare name is absent).
  const prefixed = names
    .filter((n) => n.startsWith(base))
    .sort((a, b) => a.length - b.length);
  if (prefixed[0]) return prefixed[0];

  const target = normalize(base);
  const fuzzy = names
    .filter((n) => normalize(n).includes(target))
    .sort((a, b) => a.length - b.length);
  if (fuzzy[0]) return fuzzy[0];

  throw new MinervaError(
    `No torrent found for ${platform.name} (looked for "${exact}"). ` +
      `Run with a refreshed index, or the collection may not be on MiNERVA yet.`,
  );
}

// ── .torrent download (cached) ─────────────────────────────────────────────
async function fetchTorrentFile(config: Config, name: string): Promise<Uint8Array> {
  const dir = cachePath("torrents-cache");
  const local = join(dir, name);
  const lf = Bun.file(local);
  if (await lf.exists()) {
    return new Uint8Array(await lf.arrayBuffer());
  }
  let res: Response;
  try {
    res = await fetch(torrentFileUrl(config, name), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new MinervaError(`Failed to download torrent "${name}".`, e);
  }
  if (!res.ok) throw new MinervaError(`Torrent "${name}" returned HTTP ${res.status}.`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await mkdir(dir, { recursive: true });
  await Bun.write(local, buf);
  return buf;
}

/** Path to the cached .torrent file (downloaded on demand). */
export function cachedTorrentPath(name: string): string {
  return cachePath("torrents-cache", name);
}

function findFileInTorrent(files: TorrentFile[], rom: RomEntry): TorrentFile {
  const exact = files.find((f) => f.name === rom.name);
  if (exact) return exact;
  const target = normalize(rom.name);
  const fuzzy = files.find((f) => normalize(f.name) === target);
  if (fuzzy) return fuzzy;
  throw new MinervaError(
    `"${rom.name}" was not found inside its platform torrent. ` +
      `The index may be out of date — try refreshing it.`,
  );
}

/** Resolve everything aria2c needs to download a single ROM. */
export async function resolveDownloadTarget(
  platform: PlatformDef,
  rom: RomEntry,
  config: Config,
): Promise<DownloadTarget> {
  const names = await loadCdnTorrentList(config);
  const torrentName = resolveTorrentName(platform, names);
  const buf = await fetchTorrentFile(config, torrentName);
  const { files } = parseTorrent(buf);
  const file = findFileInTorrent(files, rom);
  return {
    torrentUrl: torrentFileUrl(config, torrentName),
    torrentName,
    file,
  };
}
