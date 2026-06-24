/**
 * Emulator binary + RetroArch core detection.
 *
 * Resolution order per platform:
 *   1. config.platforms[key].emulator override (explicit binary).
 *   2. spec.binaries via PATH (`Bun.which`).
 *   3. macOS .app bundles under /Applications and ~/Applications.
 *   4. Otherwise an actionable install hint (Homebrew).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "../config.ts";
import type { EmulatorSpec, PlatformDef, ResolvedEmulator } from "../types.ts";

export type DetectResult =
  | { ok: true; emulator: ResolvedEmulator }
  | { ok: false; message: string };

/** Find an executable on PATH. Absolute paths are returned as-is if runnable. */
export function whichBin(name: string): string | null {
  if (name.includes("/")) {
    return existsSync(name) ? name : null;
  }
  return Bun.which(name);
}

/** Probe macOS .app bundles for a runnable binary. */
export function findMacApp(appBase: string, innerCandidates: string[]): string | null {
  if (process.platform !== "darwin") return null;
  const roots = ["/Applications", join(homedir(), "Applications")];
  const inner = [appBase, ...innerCandidates];
  for (const root of roots) {
    for (const bin of inner) {
      const p = join(root, `${appBase}.app`, "Contents", "MacOS", bin);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const RETROARCH_CORE_EXTS = [".dylib", ".so", ".dll"];

function retroArchCoreDirs(config: Config): string[] {
  const home = homedir();
  const dirs: string[] = [];
  if (config.retroarchCorePath) dirs.push(config.retroarchCorePath);
  dirs.push(
    // macOS
    join(home, "Library", "Application Support", "RetroArch", "cores"),
    "/Applications/RetroArch.app/Contents/Resources/cores",
    join(home, "Applications", "RetroArch.app", "Contents", "Resources", "cores"),
    "/opt/homebrew/lib/libretro",
    // Linux (native)
    join(home, ".config", "retroarch", "cores"),
    join(home, ".local", "share", "libretro", "cores"),
    "/usr/lib/libretro",
    "/usr/local/lib/libretro",
    "/usr/lib/x86_64-linux-gnu/libretro",
    // Linux (Flatpak)
    join(home, ".var", "app", "org.libretro.RetroArch", "config", "retroarch", "cores"),
    "/var/lib/flatpak/app/org.libretro.RetroArch/current/active/files/lib/libretro",
    "/app/lib/libretro",
  );
  return dirs;
}

/** Locate a RetroArch core file (e.g. "mesen_libretro") across common dirs. */
export function resolveRetroArchCore(core: string, config: Config): string | null {
  for (const dir of retroArchCoreDirs(config)) {
    for (const ext of RETROARCH_CORE_EXTS) {
      const p = join(dir, core + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Merge a per-platform config override onto the platform's default emulator. */
function effectiveSpec(platform: PlatformDef, config: Config): EmulatorSpec {
  const override = config.platforms[platform.key];
  if (!override) return platform.emulator;
  return {
    ...platform.emulator,
    binaries: override.emulator
      ? [override.emulator, ...platform.emulator.binaries]
      : platform.emulator.binaries,
    retroarchCore: override.retroarchCore ?? platform.emulator.retroarchCore,
  };
}

function installHint(spec: EmulatorSpec): string {
  if (process.platform === "darwin") {
    if (spec.brewCask) return `brew install --cask ${spec.brewCask}`;
    if (spec.brewFormula) return `brew install ${spec.brewFormula}`;
    return "(install it manually)";
  }
  // Linux: package names vary by distro — point at the likely package / Flatpak.
  const pkg = spec.brewCask ?? spec.brewFormula;
  return pkg
    ? `your package manager or Flatpak (look for "${pkg}")`
    : "(install it via your package manager or Flatpak)";
}

export function detectEmulator(platform: PlatformDef, config: Config): DetectResult {
  const spec = effectiveSpec(platform, config);

  // 1 & 2: explicit override + PATH candidates.
  let bin: string | null = null;
  for (const cand of spec.binaries) {
    bin = whichBin(cand);
    if (bin) break;
  }

  // 3: macOS .app bundles.
  if (!bin && spec.macApps) {
    for (const app of spec.macApps) {
      bin = findMacApp(app, spec.binaries);
      if (bin) break;
    }
  }

  if (!bin) {
    return {
      ok: false,
      message:
        `${spec.label} not found for ${platform.name}.\n` +
        `  Install it with:  ${installHint(spec)}\n` +
        `  Or set platforms.${platform.key}.emulator in your config.`,
    };
  }

  // 4: RetroArch core, if this platform runs through RetroArch.
  let corePath: string | undefined;
  if (spec.retroarchCore) {
    const found = resolveRetroArchCore(spec.retroarchCore, config);
    if (!found) {
      return {
        ok: false,
        message:
          `RetroArch is installed but the "${spec.retroarchCore}" core is missing.\n` +
          `  Open RetroArch → Online Updater → Core Downloader, or drop\n` +
          `  ${spec.retroarchCore}.dylib into ~/Library/Application Support/RetroArch/cores/`,
      };
    }
    corePath = found;
  }

  return { ok: true, emulator: { spec, bin, corePath } };
}

/** Generic "is this CLI tool available?" used for aria2c / 7z / unzip checks. */
export function findTool(candidates: string[]): string | null {
  for (const c of candidates) {
    const found = whichBin(c);
    if (found) return found;
  }
  return null;
}
