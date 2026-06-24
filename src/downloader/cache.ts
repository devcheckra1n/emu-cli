/**
 * Smart ROM cache: keep downloaded games on disk for instant, offline replay,
 * with a size cap and LRU eviction. This is "load onto storage when needed,
 * delete and replace" at whole-ROM granularity — the granularity that actually
 * works for emulators (see ARCHITECTURE.md on why sub-file streaming does not).
 *
 * Cached files live under `tempPath`; this manifest (in the cache dir) tracks
 * size + last-access so we can evict the least-recently-played when over cap.
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config.ts";
import { cachePath } from "../minerva/index-cache.ts";

export interface CacheEntry {
  key: string;
  platform: string;
  romName: string;
  /** The file aria2 wrote (the archive, or the raw ROM). */
  downloadedFile: string;
  /** What the emulator actually opens (archive, or extracted primary file). */
  launchPath: string;
  /** Extraction output dir, if the archive was unpacked. */
  extractedDir: string | null;
  sizeBytes: number;
  lastAccess: number;
}

type Manifest = Record<string, CacheEntry>;

const MANIFEST_REL = "cache-manifest.json";

export function cacheKey(platform: string, romName: string): string {
  return `${platform}:${romName}`;
}

async function load(): Promise<Manifest> {
  const f = Bun.file(cachePath(MANIFEST_REL));
  if (!(await f.exists())) return {};
  try {
    return (await f.json()) as Manifest;
  } catch {
    return {};
  }
}

async function save(m: Manifest): Promise<void> {
  await mkdir(dirname(cachePath(MANIFEST_REL)), { recursive: true });
  await Bun.write(cachePath(MANIFEST_REL), JSON.stringify(m, null, 2));
}

async function deleteEntryFiles(e: CacheEntry): Promise<void> {
  await rm(e.downloadedFile, { force: true }).catch(() => {});
  await rm(`${e.downloadedFile}.aria2`, { force: true }).catch(() => {});
  if (e.extractedDir) await rm(e.extractedDir, { recursive: true, force: true }).catch(() => {});
}

/** Return a cached, still-present, fully-downloaded entry — or null. */
export async function findCached(platform: string, romName: string): Promise<CacheEntry | null> {
  const m = await load();
  const e = m[cacheKey(platform, romName)];
  if (!e) return null;
  // Incomplete (.aria2 sidecar present) or missing on disk → not a valid hit.
  if (!existsSync(e.launchPath) || existsSync(`${e.downloadedFile}.aria2`)) {
    delete m[e.key];
    await save(m);
    return null;
  }
  return e;
}

export async function recordDownload(
  entry: Omit<CacheEntry, "key" | "lastAccess">,
): Promise<void> {
  const m = await load();
  const key = cacheKey(entry.platform, entry.romName);
  m[key] = { ...entry, key, lastAccess: Date.now() };
  await save(m);
}

export async function touch(platform: string, romName: string): Promise<void> {
  const m = await load();
  const e = m[cacheKey(platform, romName)];
  if (e) {
    e.lastAccess = Date.now();
    await save(m);
  }
}

/** Delete a cached game (files + manifest entry). */
export async function removeCached(platform: string, romName: string): Promise<void> {
  const m = await load();
  const e = m[cacheKey(platform, romName)];
  if (!e) return;
  await deleteEntryFiles(e);
  delete m[e.key];
  await save(m);
}

/** Forget a manifest entry WITHOUT deleting files (used after Move-to-library). */
export async function dropFromManifest(platform: string, romName: string): Promise<void> {
  const m = await load();
  delete m[cacheKey(platform, romName)];
  await save(m);
}

export async function cacheStats(): Promise<{ count: number; totalBytes: number }> {
  const m = await load();
  let totalBytes = 0;
  let count = 0;
  for (const e of Object.values(m)) {
    totalBytes += e.sizeBytes;
    count++;
  }
  return { count, totalBytes };
}

/**
 * Evict least-recently-played games until the cache is under its size cap.
 * `keepKey` (the game just downloaded/playing) is never evicted.
 */
export async function enforceCap(
  config: Config,
  keepKey?: string,
): Promise<{ evicted: number; freedBytes: number }> {
  const capBytes = config.cacheMaxSizeGB * 1024 ** 3;
  const m = await load();

  // Drop entries whose files vanished.
  for (const e of Object.values(m)) {
    if (!existsSync(e.downloadedFile) && !existsSync(e.launchPath)) delete m[e.key];
  }

  let total = Object.values(m).reduce((s, e) => s + e.sizeBytes, 0);
  if (total <= capBytes) {
    await save(m);
    return { evicted: 0, freedBytes: 0 };
  }

  const byLru = Object.values(m).sort((a, b) => a.lastAccess - b.lastAccess);
  let evicted = 0;
  let freedBytes = 0;
  for (const e of byLru) {
    if (total <= capBytes) break;
    if (e.key === keepKey) continue;
    await deleteEntryFiles(e);
    total -= e.sizeBytes;
    freedBytes += e.sizeBytes;
    evicted++;
    delete m[e.key];
  }
  await save(m);
  return { evicted, freedBytes };
}

/** Wipe every cached game + the manifest (used by `emu --clean`). */
export async function clearAllCache(): Promise<void> {
  const m = await load();
  for (const e of Object.values(m)) await deleteEntryFiles(e);
  await rm(cachePath(MANIFEST_REL), { force: true }).catch(() => {});
}
