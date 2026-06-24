/**
 * Dev smoke test: confirm an arcade-fbn game and its BIOS resolve to the same
 * torrent and land in the same directory (so FBNeo finds the BIOS).
 *   bun run scripts/smoke-bios.ts
 */
import { dirname } from "node:path";
import { loadConfig } from "../src/config.ts";
import { getPlatform } from "../src/emulator/platforms.ts";
import { resolveDownloadTarget } from "../src/minerva/rom.ts";
import type { RomEntry } from "../src/types.ts";

const { raw: config } = await loadConfig();
const p = getPlatform("arcade-fbn")!;
const mk = (name: string): RomEntry => ({
  name, title: name, platform: "arcade-fbn", sizeBytes: 0, region: null, relPath: "",
});

const dirs: string[] = [];
for (const name of ["garou.zip", "neogeo.zip"]) {
  const t = await resolveDownloadTarget(p, mk(name), config);
  console.log(`${name.padEnd(12)} idx=${String(t.file.index).padStart(5)}  ${(t.file.length / 1024 / 1024).toFixed(2)}MB  ${t.file.path}`);
  dirs.push(dirname(t.file.path));
}

const sameDir = dirs[0] === dirs[1];
console.log(`\nsame directory: ${sameDir ? "✓ YES — BIOS will sit beside the game" : "✗ NO"}`);
process.exit(sameDir ? 0 : 1);
