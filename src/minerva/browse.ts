/**
 * Scrape MiNERVA browse pages into a local, searchable index.
 *
 * Browse pages are fully server-rendered HTML (no pagination): each ROM is a
 *   <div class="entry" data-name="...">
 *     <a href="/rom?name=<encoded relPath>">filename.zip</a>
 *     <span>5.48 MB</span>
 *   </div>
 * so one fetch yields the whole platform. Collection pages list subfolders as
 * <a href="/browse/<collection>/<folder>/"> links.
 */
import { parse } from "node-html-parser";
import type { Config } from "../config.ts";
import type { PlatformDef, PlatformIndex, RomEntry } from "../types.ts";
import {
  readIndex,
  writeIndex,
  readJsonCache,
  writeJsonCache,
  isStale,
} from "./index-cache.ts";

const USER_AGENT =
  "emu-cli/0.1 (+https://github.com/; terminal ROM launcher)";
const FETCH_TIMEOUT_MS = 30_000;

/** Distinguishes network/archive failures so the TUI can offer cached fallback. */
export class MinervaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "MinervaError";
  }
}

async function fetchHtml(url: string): Promise<string> {
  const maxAttempts = 3;
  let lastErr: MinervaError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      lastErr = new MinervaError(
        `Network error fetching ${url} — MiNERVA may be down or you're offline.`,
        e,
      );
    }
    if (res) {
      if (res.ok) return res.text();
      // Definitive 4xx (e.g. 404 — wrong folder): don't retry.
      if (res.status !== 429 && res.status < 500) {
        throw new MinervaError(`MiNERVA returned HTTP ${res.status} for ${url}`);
      }
      // 429 / 5xx are transient — back off and retry.
      lastErr = new MinervaError(
        res.status === 429
          ? "MiNERVA is rate-limiting requests (HTTP 429)."
          : `MiNERVA returned HTTP ${res.status} for ${url}`,
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw lastErr ?? new MinervaError(`Failed to fetch ${url}`);
}

// ── URL helpers ────────────────────────────────────────────────────────────
/** encodeURIComponent matches MiNERVA's scheme: space→%20, comma→%2C, "(" literal. */
function browseUrl(config: Config, ...segments: string[]): string {
  const path = segments.map((s) => encodeURIComponent(s)).join("/");
  return `${config.minervaBaseUrl}/browse/${path}/`;
}

export function platformBrowseUrl(config: Config, platform: PlatformDef, folder: string): string {
  return folder
    ? browseUrl(config, platform.collection, folder)
    : browseUrl(config, platform.collection);
}

// ── Parsing ──────────────────────────────────────────────────────────────
const REGION_WORDS = new Set([
  "usa", "europe", "japan", "world", "asia", "korea", "china", "germany",
  "france", "spain", "italy", "netherlands", "australia", "brazil", "canada",
  "sweden", "russia", "uk", "taiwan", "hong kong", "poland", "portugal",
  "norway", "denmark", "finland", "greece", "scandinavia", "latin america",
]);

/** Split a No-Intro/Redump filename into a clean title and a region tag. */
export function parseRomName(filename: string): { title: string; region: string | null } {
  const base = filename.replace(/\.[^.]+$/, "");
  const groups = [...base.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? "");
  let region: string | null = null;
  for (const g of groups) {
    const parts = g.split(",").map((s) => s.trim().toLowerCase());
    if (parts.some((p) => REGION_WORDS.has(p))) {
      region = g;
      break;
    }
  }
  const title = base.replace(/\s*[([][^)\]]*[)\]]/g, "").trim() || base;
  return { title, region };
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

export function parseSize(text: string): number {
  const m = text.trim().match(/([\d.]+)\s*([KMGT]?)i?B/i);
  if (!m) return 0;
  const n = parseFloat(m[1] ?? "0");
  const unit = ((m[2] ?? "").toUpperCase() + "B") as keyof typeof SIZE_UNITS;
  return Math.round(n * (SIZE_UNITS[unit] ?? 1));
}

/** decodeURIComponent that never throws on malformed / invalid-UTF-8 sequences. */
export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === "%" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(ch.charCodeAt(0) & 0xff);
      }
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
  }
}

interface RawFile {
  name: string;
  relPath: string;
  sizeText: string;
}

function parseFileEntries(html: string): RawFile[] {
  const root = parse(html);
  const out: RawFile[] = [];
  for (const entry of root.querySelectorAll(".entry")) {
    const a = entry.querySelector("a");
    if (!a) continue;
    const href = a.getAttribute("href") ?? "";
    const qIndex = href.indexOf("?");
    if (qIndex === -1 || !href.startsWith("/rom")) continue; // directory, not a file
    const nameParam = new URLSearchParams(href.slice(qIndex + 1)).get("name");
    if (!nameParam) continue;
    const relPath = safeDecodeURIComponent(nameParam).replace(/^\.\//, "");
    // Prefer the anchor text (already entity-decoded) for the display name.
    const filename = a.text.trim() || relPath.split("/").pop() || "";
    const span = entry.querySelector("span");
    out.push({ name: filename, relPath, sizeText: span?.text?.trim() ?? "" });
  }
  return out;
}

function parseSubfolders(html: string, collection: string): string[] {
  const root = parse(html);
  const set = new Set<string>();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/browse/")) continue;
    const rest = safeDecodeURIComponent(href.slice("/browse/".length)).replace(/\/$/, "");
    const segs = rest.split("/");
    if (segs.length === 2 && segs[0] === collection) set.add(segs[1]!);
  }
  return [...set];
}

// ── Collection folder resolution (tolerant of name drift) ──────────────────
interface CollectionCache {
  fetchedAt: number;
  folders: string[];
}

async function listCollectionFolders(
  collection: string,
  config: Config,
): Promise<string[]> {
  const rel = `collections/${collection}.json`;
  const cached = await readJsonCache<CollectionCache>(rel);
  if (cached && !isStale(cached.fetchedAt, config.indexMaxAgeDays)) {
    return cached.folders;
  }
  const html = await fetchHtml(browseUrl(config, collection));
  const folders = parseSubfolders(html, collection);
  await writeJsonCache(rel, { fetchedAt: Date.now(), folders } satisfies CollectionCache);
  return folders;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Map a platform's expected folder name onto the actual live folder name. */
export async function resolveSystemFolder(
  platform: PlatformDef,
  config: Config,
): Promise<string> {
  if (!platform.systemFolder) return ""; // arcade: scrape the collection root
  let folders: string[];
  try {
    folders = await listCollectionFolders(platform.collection, config);
  } catch {
    return platform.systemFolder; // fall back to the hardcoded guess
  }
  if (folders.includes(platform.systemFolder)) return platform.systemFolder;

  const ci = folders.find(
    (f) => f.toLowerCase() === platform.systemFolder.toLowerCase(),
  );
  if (ci) return ci;

  const target = normalize(platform.systemFolder);
  const exactNorm = folders.find((f) => normalize(f) === target);
  if (exactNorm) return exactNorm;
  const partial = folders.find(
    (f) => normalize(f).includes(target) || target.includes(normalize(f)),
  );
  return partial ?? platform.systemFolder;
}

// ── Index building + caching ───────────────────────────────────────────────
export async function buildIndex(
  platform: PlatformDef,
  config: Config,
): Promise<PlatformIndex> {
  const folder = await resolveSystemFolder(platform, config);
  const url = platformBrowseUrl(config, platform, folder);
  const html = await fetchHtml(url);
  const files = parseFileEntries(html);
  if (files.length === 0) {
    throw new MinervaError(
      `No ROMs found at ${url}. The folder name may have changed for "${platform.key}".`,
    );
  }
  const entries: RomEntry[] = files.map((f) => {
    const { title, region } = parseRomName(f.name);
    return {
      name: f.name,
      title,
      platform: platform.key,
      sizeBytes: parseSize(f.sizeText),
      region,
      relPath: f.relPath,
    };
  });
  return {
    platform: platform.key,
    fetchedAt: Date.now(),
    source: url,
    entries,
  };
}

export interface IndexResult {
  index: PlatformIndex;
  fromCache: boolean;
  stale: boolean;
}

/**
 * Cache-aware index fetch. Returns cached data when fresh; refreshes when
 * stale/forced; falls back to stale cache if the network fails.
 */
export async function getIndex(
  platform: PlatformDef,
  config: Config,
  opts: { force?: boolean } = {},
): Promise<IndexResult> {
  const cached = await readIndex(platform.key);
  const stale = cached ? isStale(cached.fetchedAt, config.indexMaxAgeDays) : true;

  if (cached && !opts.force && !stale) {
    return { index: cached, fromCache: true, stale: false };
  }

  try {
    const fresh = await buildIndex(platform, config);
    await writeIndex(fresh);
    return { index: fresh, fromCache: false, stale: false };
  } catch (e) {
    if (cached) {
      return { index: cached, fromCache: true, stale: true };
    }
    throw e instanceof MinervaError
      ? e
      : new MinervaError(
          `Failed to build index for ${platform.key}: ${e instanceof Error ? e.message : String(e)}`,
          e,
        );
  }
}
