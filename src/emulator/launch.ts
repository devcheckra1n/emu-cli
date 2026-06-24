/**
 * Build the emulator command line (args always passed as an array — never a
 * shell string) and run it to completion, capturing exit code + stderr tail.
 *
 * On macOS these emulators are GUI apps launched via their inner binary so the
 * process stays in the foreground and we can await the user quitting it.
 */
import { dirname, basename } from "node:path";
import type { Config } from "../config.ts";
import type { PlatformDef, ResolvedEmulator } from "../types.ts";

export interface LaunchResult {
  code: number;
  stderrTail: string[];
}

/**
 * Compose argv for the emulator. The ROM path is always the final positional
 * argument (except MAME, which takes a romset name + rompath).
 */
export function buildCommand(
  emulator: ResolvedEmulator,
  platform: PlatformDef,
  romPath: string,
  config: Config,
): string[] {
  const override = config.platforms[platform.key];
  const userArgs = override?.args ?? [];
  const defaultArgs = emulator.spec.defaultArgs ?? [];

  // MAME wants the romset *name* plus a rompath, not a file path.
  if (platform.key === "arcade-mame") {
    const romName = basename(romPath).replace(/\.[^.]+$/, "");
    return [emulator.bin, "-rompath", dirname(romPath), ...defaultArgs, ...userArgs, romName];
  }

  // RetroArch cores: retroarch -L <core> [args] <rom>
  if (emulator.corePath) {
    return [emulator.bin, "-L", emulator.corePath, ...defaultArgs, ...userArgs, romPath];
  }

  return [emulator.bin, ...defaultArgs, ...userArgs, romPath];
}

export async function launchEmulator(
  emulator: ResolvedEmulator,
  platform: PlatformDef,
  romPath: string,
  config: Config,
): Promise<LaunchResult> {
  const [bin, ...args] = buildCommand(emulator, platform, romPath, config);

  // Ignore stdout (keeps the Ink TUI clean while a GUI emulator runs); capture
  // stderr so we can surface failures. stdin is left to the emulator's own window.
  const proc = Bun.spawn([bin!, ...args], {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  const stderrText = await new Response(proc.stderr).text();
  const code = await proc.exited;

  const stderrTail = stderrText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-8);

  return { code, stderrTail };
}
