/**
 * Config load/merge/save. The on-disk file lives at
 * `~/.config/emu-cli/config.json` (XDG-aware) and is human-editable JSON.
 * Paths are stored with `~` and expanded via os.homedir() at read time.
 */
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export const APP_NAME = "emu-cli";

/** Expand a leading `~` to the user's home directory. Never hard-code paths. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

const PlatformOverrideSchema = z.object({
  /** Override emulator binary (absolute path or name on PATH). */
  emulator: z.string().optional(),
  /** Extra args appended before the ROM path. */
  args: z.array(z.string()).default([]),
  /** Override the RetroArch core for this platform. */
  retroarchCore: z.string().optional(),
});

export const ConfigSchema = z.object({
  libraryPath: z.string().default("~/ROMs"),
  tempPath: z.string().default(`~/.cache/${APP_NAME}/tmp`),
  defaultKeep: z.boolean().default(false),
  /**
   * For files larger than this, wait for full download before launching.
   * Small ROMs under the threshold can fast-start once head/tail are buffered.
   */
  bufferThresholdMB: z.number().nonnegative().default(50),
  platforms: z.record(PlatformOverrideSchema).default({}),
  retroarchCorePath: z.string().nullable().default(null),
  aria2cPath: z.string().nullable().default(null),
  indexMaxAgeDays: z.number().positive().default(7),
  /** Base URLs — overridable in case the archive moves. */
  minervaBaseUrl: z.string().default("https://minerva-archive.org"),
  cdnBaseUrl: z.string().default("https://cdn.minerva-archive.org"),
  /** Keep seeding after a download completes (good torrent etiquette). */
  seedAfterDownload: z.boolean().default(false),
  /** Keep downloaded ROMs on disk for instant replay (smart cache). */
  cacheEnabled: z.boolean().default(true),
  /** Cache size cap in GB; least-recently-played games are evicted over this. */
  cacheMaxSizeGB: z.number().positive().default(20),
});

export type PlatformOverride = z.infer<typeof PlatformOverrideSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length ? xdg : join(homedir(), ".config");
  return join(base, APP_NAME);
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length ? xdg : join(homedir(), ".cache");
  return join(base, APP_NAME);
}

export interface LoadedConfig {
  /** Validated raw config (paths still contain `~`). */
  raw: Config;
  /** Absolute, ~-expanded library path. */
  libraryPath: string;
  /** Absolute, ~-expanded temp path. */
  tempPath: string;
}

/**
 * Load config, merging the on-disk file over schema defaults. On first run the
 * defaults are written to disk so the user has something to edit.
 */
export async function loadConfig(): Promise<LoadedConfig> {
  const file = Bun.file(configPath());
  const exists = await file.exists();
  let parsed: unknown = {};
  if (exists) {
    try {
      parsed = await file.json();
    } catch (e) {
      throw new Error(
        `Config at ${configPath()} is not valid JSON: ${(e as Error).message}`,
      );
    }
  }

  const result = ConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${configPath()}:\n${issues}`);
  }
  const raw = result.data;

  if (!exists) {
    await saveConfig(raw);
  }

  return {
    raw,
    libraryPath: expandHome(raw.libraryPath),
    tempPath: expandHome(raw.tempPath),
  };
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await Bun.write(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}
