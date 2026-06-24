/**
 * Build + cache the ROM index for one or more platforms (verifies the MiNERVA
 * folder resolves and reports ROM counts).
 *   bun run scripts/build-indexes.ts                 # the default set
 *   bun run scripts/build-indexes.ts psx saturn      # specific platforms
 */
import { loadConfig } from "../src/config.ts";
import { getPlatform } from "../src/emulator/platforms.ts";
import { getIndex } from "../src/minerva/browse.ts";

const DEFAULT = ["snes", "n64", "gg", "genesis", "psx", "dc", "arcade-fbn", "saturn", "3ds"];
const keys = Bun.argv.slice(2).length ? Bun.argv.slice(2) : DEFAULT;

const { raw: config } = await loadConfig();
for (const key of keys) {
  const p = getPlatform(key);
  if (!p) {
    console.log(`${key.padEnd(11)} UNKNOWN PLATFORM`);
    continue;
  }
  const t0 = Date.now();
  try {
    const { index } = await getIndex(p, config, { force: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${key.padEnd(11)} ${String(index.entries.length).padStart(6)} roms  ${secs}s  ${index.source}`);
  } catch (e) {
    console.log(`${key.padEnd(11)} FAILED: ${(e as Error).message}`);
  }
}
