/**
 * On-disk JSON cache under ~/.cache/emu-cli/.
 *   index/<platform>.json       — scraped PlatformIndex (ROM lists)
 *   collections/<name>.json     — collection subfolder listings
 *   torrents.json               — CDN torrent listing
 */
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { cacheDir } from "../config.ts";
import type { PlatformIndex } from "../types.ts";

export function cachePath(...parts: string[]): string {
  return join(cacheDir(), ...parts);
}

export async function readJsonCache<T>(rel: string): Promise<T | null> {
  const f = Bun.file(cachePath(rel));
  if (!(await f.exists())) return null;
  try {
    return (await f.json()) as T;
  } catch {
    return null; // corrupt cache → treat as missing
  }
}

export async function writeJsonCache(rel: string, data: unknown): Promise<void> {
  const p = cachePath(rel);
  await mkdir(dirname(p), { recursive: true });
  await Bun.write(p, JSON.stringify(data));
}

function indexRel(platform: string): string {
  return join("index", `${platform}.json`);
}

export async function readIndex(platform: string): Promise<PlatformIndex | null> {
  return readJsonCache<PlatformIndex>(indexRel(platform));
}

export async function writeIndex(index: PlatformIndex): Promise<void> {
  await writeJsonCache(indexRel(index.platform), index);
}

export function ageMs(epochMs: number): number {
  return Date.now() - epochMs;
}

export function isStale(fetchedAt: number, maxAgeDays: number): boolean {
  return ageMs(fetchedAt) > maxAgeDays * 24 * 60 * 60 * 1000;
}
