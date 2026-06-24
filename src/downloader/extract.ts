/**
 * Archive extraction + primary-file selection.
 *
 * ROMs arrive as .zip/.7z. Emulators that read .zip natively (mGBA, RetroArch
 * cart cores) get the archive passed straight through; disc emulators and
 * everything else get the archive extracted and the correct primary file picked
 * (e.g. the .cue of a .bin/.cue pair, the .m3u of a multi-disc set).
 */
import { join, extname, basename, dirname } from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";
import type { EmulatorSpec, ArchiveKind } from "../types.ts";
import { whichBin } from "../emulator/detect.ts";

export const SEVENZIP_INSTALL_HINT =
  process.platform === "darwin"
    ? "brew install sevenzip"
    : "sudo apt install p7zip-full   (or your distro's package manager)";

export interface ExtractTools {
  sevenZip: string | null;
  unzip: string | null;
}

export function detectExtractTools(): ExtractTools {
  return {
    sevenZip: whichBin("7z") ?? whichBin("7zz") ?? whichBin("7za"),
    unzip: whichBin("unzip"),
  };
}

const ARCHIVE_EXTS = new Set([".zip", ".7z"]);

export function isArchive(file: string): boolean {
  return ARCHIVE_EXTS.has(extname(file).toLowerCase());
}

/** Decide whether the archive must be unpacked before the emulator can read it. */
export function shouldExtract(file: string, spec: EmulatorSpec): boolean {
  const ext = extname(file).toLowerCase().replace(".", "");
  if (!isArchive(file)) return false;
  if (spec.needsExtractedDisc) return true;
  return !(spec.nativeArchives ?? []).includes(ext);
}

/** Returns null if the required tool is present, or an install hint if missing. */
export function missingToolFor(file: string, tools: ExtractTools): string | null {
  const ext = extname(file).toLowerCase();
  if (ext === ".7z" && !tools.sevenZip) return SEVENZIP_INSTALL_HINT;
  if (ext === ".zip" && !tools.sevenZip && !tools.unzip) return SEVENZIP_INSTALL_HINT;
  return null;
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`Extraction failed (${cmd[0]} exited ${code}): ${err.trim().slice(0, 300)}`);
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

export async function extractArchive(
  file: string,
  destDir: string,
  tools: ExtractTools,
): Promise<string[]> {
  await mkdir(destDir, { recursive: true });
  const ext = extname(file).toLowerCase();
  if (ext === ".zip" && tools.unzip && !tools.sevenZip) {
    await run([tools.unzip, "-o", "-q", file, "-d", destDir]);
  } else if (tools.sevenZip) {
    await run([tools.sevenZip, "x", "-y", `-o${destDir}`, file]);
  } else {
    throw new Error(`No extractor available for ${basename(file)}. Install: ${SEVENZIP_INSTALL_HINT}`);
  }
  return walk(destDir);
}

// Priority of disc descriptor formats: a descriptor (cue/gdi/...) points at the
// data tracks, and .m3u chains multi-disc sets, so they outrank raw .bin/.iso.
const DISC_PRIORITY = [".m3u", ".cue", ".gdi", ".ccd", ".mds", ".chd", ".iso", ".bin", ".img"];
const CART_EXTS = new Set([
  ".gba", ".gb", ".gbc", ".nes", ".unf", ".fds", ".sfc", ".smc", ".bs",
  ".n64", ".z64", ".v64", ".nds", ".3ds", ".cci", ".cia", ".md", ".gen",
  ".bin", ".gg", ".sms", ".32x",
]);
const JUNK_EXTS = new Set([".txt", ".nfo", ".sfv", ".md5", ".sha1", ".dat", ".xml", ".jpg", ".png"]);

export function pickPrimaryFile(files: string[], archive: ArchiveKind): string | null {
  if (files.length === 0) return null;
  if (files.length === 1) return files[0]!;

  if (archive === "disc") {
    for (const ext of DISC_PRIORITY) {
      const hit = files.find((f) => extname(f).toLowerCase() === ext);
      if (hit) return hit;
    }
  } else {
    const cart = files.find((f) => CART_EXTS.has(extname(f).toLowerCase()));
    if (cart) return cart;
  }
  // Fallback: largest non-junk file.
  const candidates = files.filter((f) => !JUNK_EXTS.has(extname(f).toLowerCase()));
  return (candidates.length ? candidates : files).reduce((a, b) =>
    Bun.file(a).size >= Bun.file(b).size ? a : b,
  );
}

export interface PreparedRom {
  /** Path to hand to the emulator. */
  launchPath: string;
  /** Directory created by extraction (for later cleanup), if any. */
  extractedDir: string | null;
}

/**
 * Given a freshly downloaded file, return what the emulator should open —
 * either the archive itself (native support) or the extracted primary file.
 */
export async function prepareRom(
  downloadedFile: string,
  spec: EmulatorSpec,
  archive: ArchiveKind,
  tools: ExtractTools,
): Promise<PreparedRom> {
  if (!shouldExtract(downloadedFile, spec)) {
    return { launchPath: downloadedFile, extractedDir: null };
  }
  const missing = missingToolFor(downloadedFile, tools);
  if (missing) throw new Error(`Cannot extract ${basename(downloadedFile)} — install: ${missing}`);

  const destDir = join(dirname(downloadedFile), `${basename(downloadedFile)}.extracted`);
  const files = await extractArchive(downloadedFile, destDir, tools);
  const primary = pickPrimaryFile(files, archive);
  if (!primary) throw new Error(`Archive ${basename(downloadedFile)} was empty after extraction.`);
  return { launchPath: primary, extractedDir: destDir };
}
