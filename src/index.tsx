#!/usr/bin/env bun
/**
 * emu-cli — terminal-first ROM launcher for the MiNERVA Archive.
 * CLI entry point: argument parsing + dispatch into the Ink TUI.
 */
import { parseArgs } from "node:util";
import { render } from "ink";
import { rm } from "node:fs/promises";
import chalk from "chalk";

import { loadConfig, configPath } from "./config.ts";
import { getPlatform, allPlatforms, platformKeys } from "./emulator/platforms.ts";
import { detectEmulator } from "./emulator/detect.ts";
import { findAria2c } from "./downloader/aria2c.ts";
import { clearAllCache, cacheStats } from "./downloader/cache.ts";
import { App } from "./tui/App.tsx";

const VERSION = "0.1.0";

const HELP = `${chalk.magentaBright.bold("emu")} — terminal ROM launcher (MiNERVA Archive)

${chalk.bold("USAGE")}
  emu [search terms]        Launch the TUI, optionally pre-filling the search
  emu --platform <key>      Pre-filter to a platform (e.g. gba, snes, psx)
  emu --list-platforms      List supported platforms + emulator status
  emu --config              Open the config file in $EDITOR
  emu --clean               Delete the temp download folder and exit
  emu --help                Show this help
  emu --version             Print version

${chalk.bold("EXAMPLES")}
  emu pokemon emerald
  emu --platform snes "chrono trigger"
  emu -p psx

${chalk.bold("CONFIG")}  ${chalk.dim(configPath())}
`;

function fail(msg: string): never {
  console.error(chalk.red(msg));
  process.exit(1);
}

async function listPlatforms(): Promise<void> {
  const { raw: config } = await loadConfig();
  const aria = findAria2c(config);
  console.log(chalk.bold(`\nSupported platforms  ${chalk.dim(`(${platformKeys().length})`)}\n`));
  console.log(
    "  " +
      chalk.dim("KEY".padEnd(12) + "SYSTEM".padEnd(30) + "EMULATOR".padEnd(26) + "STATUS"),
  );
  const col = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s).padEnd(w);
  for (const p of allPlatforms()) {
    const det = detectEmulator(p, config);
    const status = det.ok ? chalk.green("✓ ready") : chalk.red("✗ missing");
    console.log(
      "  " +
        chalk.yellow(col(p.key, 12)) +
        col(p.name, 30) +
        col(p.emulator.label, 26) +
        status,
    );
  }
  console.log(
    "\n  aria2c (downloader): " +
      (aria ? chalk.green(`✓ ${aria}`) : chalk.red("✗ missing — brew install aria2")),
  );
  console.log(chalk.dim("\n  Override any emulator in your config: " + configPath() + "\n"));
}

async function openConfigInEditor(): Promise<void> {
  await loadConfig(); // ensures the file exists with defaults
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === "darwin" ? "open" : "nano");
  const proc = Bun.spawn([editor, configPath()], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await proc.exited;
}

async function clean(): Promise<void> {
  const { tempPath } = await loadConfig();
  const before = await cacheStats();
  await clearAllCache();
  await rm(tempPath, { recursive: true, force: true });
  console.log(
    chalk.green(
      `Cleaned temp folder + ROM cache (${before.count} game(s)): ${tempPath}`,
    ),
  );
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        platform: { type: "string", short: "p" },
        "list-platforms": { type: "boolean" },
        config: { type: "boolean" },
        clean: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
    });
  } catch (e) {
    fail(`${(e as Error).message}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;

  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(`emu-cli ${VERSION}`);
  if (values["list-platforms"]) return listPlatforms();
  if (values.config) return openConfigInEditor();
  if (values.clean) return clean();

  // Interactive TUI.
  const platformKey = (values.platform ?? "gba").toLowerCase();
  const platform = getPlatform(platformKey);
  if (!platform) {
    fail(`Unknown platform "${platformKey}". Known: ${platformKeys().join(", ")}`);
  }

  if (!process.stdin.isTTY) {
    fail("emu's interactive UI needs a TTY. Run it directly in your terminal (not piped).");
  }

  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    fail((e as Error).message);
  }

  const app = render(
    <App config={config} initialPlatform={platform} initialQuery={positionals.join(" ")} />,
    { exitOnCtrlC: true },
  );
  await app.waitUntilExit();
}

await main();
