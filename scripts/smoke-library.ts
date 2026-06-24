/**
 * Dev smoke test: permanent library save + instant-replay recognition.
 *   bun run scripts/smoke-library.ts
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findInLibrary, saveToLibrary, libraryRomPath } from "../src/downloader/library.ts";

const lib = await mkdtemp(join(tmpdir(), "emu-lib-"));
const dl = await mkdtemp(join(tmpdir(), "emu-dl-"));
const name = "Metroid Fusion (USA).zip";
const src = join(dl, name);
await writeFile(src, Buffer.alloc(4096));

const checks: [string, boolean][] = [];
checks.push(["not in library before save", findInLibrary(lib, "gba", name) === null]);
const dest = await saveToLibrary(lib, "gba", src);
checks.push(["saved to <lib>/gba/<name>", dest === libraryRomPath(lib, "gba", name)]);
checks.push(["destination exists", existsSync(dest)]);
checks.push(["source moved (not copied)", !existsSync(src)]);
checks.push(["instant-replay now finds it", findInLibrary(lib, "gba", name) === dest]);

let ok = true;
for (const [n, p] of checks) {
  console.log(`  ${p ? "✓" : "✗"} ${n}`);
  if (!p) ok = false;
}
await rm(lib, { recursive: true, force: true });
await rm(dl, { recursive: true, force: true });
console.log(ok ? "\nLIBRARY smoke: PASS" : "\nLIBRARY smoke: FAIL");
process.exit(ok ? 0 : 1);
