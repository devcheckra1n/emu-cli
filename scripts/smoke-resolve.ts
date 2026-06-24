/**
 * Dev smoke test: resolve a ROM to its CDN torrent + file index.
 *   bun run scripts/smoke-resolve.ts
 */
import { loadConfig } from "../src/config.ts";
import { getPlatform } from "../src/emulator/platforms.ts";
import { resolveDownloadTarget } from "../src/minerva/rom.ts";
import type { RomEntry } from "../src/types.ts";

const { raw: config } = await loadConfig();
const platform = getPlatform("gba")!;

const rom: RomEntry = {
  name: "Advance Wars (USA).zip",
  title: "Advance Wars",
  platform: "gba",
  sizeBytes: 0,
  region: "USA",
  relPath: "No-Intro/Nintendo - Game Boy Advance/Advance Wars (USA).zip",
};

console.time("resolve");
const target = await resolveDownloadTarget(platform, rom, config);
console.timeEnd("resolve");
console.log("torrent:", target.torrentName);
console.log("url:    ", target.torrentUrl);
console.log("file:   ", target.file);
console.log(`size:    ${(target.file.length / 1024 / 1024).toFixed(2)} MB, aria2c --select-file=${target.file.index}`);
