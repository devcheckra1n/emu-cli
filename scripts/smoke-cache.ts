/**
 * Dev smoke test: cache record / instant-replay lookup / LRU eviction.
 *   bun run scripts/smoke-cache.ts
 * Uses fake files and synthetic ROM names (no collision with real cache).
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import {
  recordDownload,
  findCached,
  enforceCap,
  removeCached,
  cacheKey,
} from "../src/downloader/cache.ts";

const { raw: config } = await loadConfig();
config.cacheMaxSizeGB = 10000 / 1024 ** 3; // ~10 KB cap

const dir = await mkdtemp(join(tmpdir(), "emu-cache-test-"));
const fake = async (name: string, bytes: number) => {
  const p = join(dir, name);
  await writeFile(p, Buffer.alloc(bytes));
  return p;
};

const a = await fake("a.zip", 5000);
const b = await fake("b.zip", 5000);
const c = await fake("c.zip", 5000);
const mk = (rn: string, p: string) => ({
  platform: "__test__",
  romName: rn,
  downloadedFile: p,
  launchPath: p,
  extractedDir: null,
  sizeBytes: 5000,
});

await recordDownload(mk("A.zip", a));
await new Promise((r) => setTimeout(r, 5));
await recordDownload(mk("B.zip", b));
await new Promise((r) => setTimeout(r, 5));
await recordDownload(mk("C.zip", c)); // newest → should survive eviction

const hitA = await findCached("__test__", "A.zip");
const miss = await findCached("__test__", "Nope.zip");
const res = await enforceCap(config, cacheKey("__test__", "C.zip"));

const checks: [string, boolean][] = [
  ["instant-replay finds A", hitA !== null],
  ["miss returns null", miss === null],
  ["evicted exactly 1 (LRU)", res.evicted === 1],
  ["oldest (A) deleted", !existsSync(a)],
  ["kept-key (C) survives", existsSync(c)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  if (!pass) ok = false;
}

// cleanup (only our synthetic entries)
await removeCached("__test__", "B.zip");
await removeCached("__test__", "C.zip");
await rm(dir, { recursive: true, force: true });

console.log(ok ? "\nCACHE smoke: PASS" : "\nCACHE smoke: FAIL");
process.exit(ok ? 0 : 1);
