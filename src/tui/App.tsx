import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

import type { LoadedConfig } from "../config.ts";
import { cacheDir } from "../config.ts";
import type { DownloadProgress as Progress, PlatformDef, RomEntry } from "../types.ts";
import { allPlatforms } from "../emulator/platforms.ts";
import { detectEmulator } from "../emulator/detect.ts";
import { launchEmulator } from "../emulator/launch.ts";
import { getIndex, MinervaError } from "../minerva/browse.ts";
import { createSearcher, search, type Searcher } from "../minerva/search.ts";
import { resolveDownloadTarget, cachedTorrentPath } from "../minerva/rom.ts";
import {
  startDownload,
  findAria2c,
  ARIA2C_INSTALL_HINT,
  downloadedFilePath,
  type DownloadHandle,
} from "../downloader/aria2c.ts";
import { detectExtractTools, prepareRom } from "../downloader/extract.ts";
import {
  findCached,
  recordDownload,
  touch,
  removeCached,
  dropFromManifest,
  enforceCap,
  cacheKey,
  cacheStats,
} from "../downloader/cache.ts";
import { findInLibrary, saveToLibrary } from "../downloader/library.ts";

import { SearchBar } from "./SearchBar.tsx";
import { GameList } from "./GameList.tsx";
import { InfoPanel } from "./InfoPanel.tsx";
import { DownloadProgress } from "./DownloadProgress.tsx";
import { PlatformPicker } from "./PlatformPicker.tsx";
import { formatBytes } from "../util/format.ts";

const VERSION = "0.1.0";

type Mode =
  | "loading"
  | "browse"
  | "platform"
  | "info"
  | "resolving"
  | "downloading"
  | "launching"
  | "post"
  | "error";

interface Current {
  rom: RomEntry;
  downloadDir: string;
  downloadedFile: string;
  extractedDir: string | null;
}

interface Props {
  config: LoadedConfig;
  initialPlatform: PlatformDef;
  initialQuery: string;
}

function useTermSize() {
  const [size, setSize] = useState({
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({ rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 });
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return size;
}

export function App({ config, initialPlatform, initialQuery }: Props) {
  const { exit } = useApp();
  const { rows } = useTermSize();

  const [platform, setPlatform] = useState<PlatformDef>(initialPlatform);
  const [mode, setMode] = useState<Mode>("loading");
  const [searcher, setSearcher] = useState<Searcher | null>(null);
  const [entries, setEntries] = useState<RomEntry[]>([]);
  const [stale, setStale] = useState(false);

  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [searchFocused, setSearchFocused] = useState(true);
  const [selected, setSelected] = useState(0);
  const [platformSel, setPlatformSel] = useState(0);

  const [progress, setProgress] = useState<Progress>({
    ratio: 0,
    completedBytes: 0,
    totalBytes: 0,
    downloadSpeed: 0,
    connections: 0,
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [keep, setKeep] = useState(config.raw.keepInLibrary);
  const [emuInfo, setEmuInfo] = useState<{ ok: boolean; text: string }>({ ok: false, text: "" });
  const [cacheInfo, setCacheInfo] = useState<{ count: number; totalBytes: number }>({
    count: 0,
    totalBytes: 0,
  });

  const downloadHandle = useRef<DownloadHandle | null>(null);
  const current = useRef<Current | null>(null);

  const platforms = useMemo(() => allPlatforms(), []);
  const listHeight = Math.max(3, rows - 9);

  // ── Index loading (on mount + platform change) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMode("loading");
    setStatus(`Loading ${platform.name} index…`);
    getIndex(platform, config.raw)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.index.entries);
        setSearcher(createSearcher(res.index));
        setStale(res.stale);
        setStatus("");
        setMode("browse");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setMode("error");
      });
    return () => {
      cancelled = true;
    };
  }, [platform.key]);

  // ── Debounced search ───────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    if (!searcher) return [];
    return search(searcher, entries, debounced, 500);
  }, [searcher, entries, debounced]);

  useEffect(() => {
    setSelected(0);
  }, [debounced, platform.key]);

  const refreshCacheInfo = useCallback(async () => {
    setCacheInfo(await cacheStats());
  }, []);
  useEffect(() => {
    void refreshCacheInfo();
  }, [refreshCacheInfo]);

  // Arcade games (e.g. Neo Geo) need their shared BIOS romset alongside them.
  const ensureArcadeBios = useCallback(
    async (aria: string | null, besideDir: string): Promise<string | null> => {
      const bios = platform.biosRomsets;
      if (!bios || bios.length === 0) return null;
      const downloadDir = join(config.tempPath, platform.key);
      for (const biosName of bios) {
        const besidePath = join(besideDir, biosName);
        if (existsSync(besidePath)) continue; // already next to the game
        const biosRom: RomEntry = {
          name: biosName,
          title: biosName,
          platform: platform.key,
          sizeBytes: 0,
          region: null,
          relPath: "",
        };
        let target;
        try {
          target = await resolveDownloadTarget(platform, biosRom, config.raw);
        } catch {
          continue; // BIOS not in this torrent — let the emulator report it if needed.
        }
        const cachedBios = downloadedFilePath(downloadDir, target.file);
        if (!existsSync(cachedBios)) {
          if (!aria) {
            return `Arcade BIOS "${biosName}" is required but aria2c isn't installed (${ARIA2C_INSTALL_HINT}).`;
          }
          setStatus(`Fetching arcade BIOS ${biosName}…`);
          setProgress({ ratio: 0, completedBytes: 0, totalBytes: target.file.length, downloadSpeed: 0, connections: 0 });
          setMode("downloading");
          const handle = startDownload({
            aria2c: aria,
            torrentPath: cachedTorrentPath(target.torrentName),
            file: target.file,
            downloadDir,
            config: config.raw,
            onProgress: setProgress,
          });
          downloadHandle.current = handle;
          await handle.completed;
          downloadHandle.current = null;
        }
        // Ensure the BIOS sits beside the launch file (e.g. when playing from library).
        if (cachedBios !== besidePath) {
          await mkdir(besideDir, { recursive: true });
          await Bun.write(besidePath, Bun.file(cachedBios));
        }
      }
      return null;
    },
    [platform, config],
  );

  // ── Actions ────────────────────────────────────────────────────────────
  const launchSelected = useCallback(async () => {
    const rom = results[selected];
    if (!rom) return;

    setMode("resolving");
    setStatus(`Resolving ${rom.name}…`);
    try {
      const det = detectEmulator(platform, config.raw);
      if (!det.ok) {
        setError(det.message);
        setMode("error");
        return;
      }
      const aria = findAria2c(config.raw);
      const downloadDir = join(config.tempPath, platform.key);

      // Permanent library hit: launch the kept copy, never re-download.
      const libHit = findInLibrary(config.libraryPath, platform.key, rom.name);
      if (libHit) {
        const prepared = await prepareRom(libHit, det.emulator.spec, platform.archive, detectExtractTools());
        const biosErr = await ensureArcadeBios(aria, dirname(prepared.launchPath));
        if (biosErr) {
          setError(biosErr);
          setMode("error");
          return;
        }
        current.current = { rom, downloadDir, downloadedFile: libHit, extractedDir: prepared.extractedDir };
        setMode("launching");
        setStatus(`Launching ${rom.title} (library) in ${det.emulator.spec.label}…`);
        const r = await launchEmulator(det.emulator, platform, prepared.launchPath, config.raw);
        if (prepared.extractedDir) await rm(prepared.extractedDir, { recursive: true, force: true }).catch(() => {});
        current.current = null;
        if (r.code !== 0) {
          setError(
            `${det.emulator.spec.label} exited with code ${r.code}.` +
              (r.stderrTail.length ? `\n${r.stderrTail.join("\n")}` : ""),
          );
          setMode("error");
        } else {
          setStatus(`Played from library: ${rom.title}`);
          setMode("browse");
        }
        return;
      }

      // Instant replay: already-cached ROMs skip downloading the game itself.
      if (config.raw.cacheEnabled) {
        const cached = await findCached(platform.key, rom.name);
        if (cached) {
          await touch(platform.key, rom.name);
          const biosErr = await ensureArcadeBios(aria, dirname(cached.launchPath));
          if (biosErr) {
            setError(biosErr);
            setMode("error");
            return;
          }
          current.current = {
            rom,
            downloadDir,
            downloadedFile: cached.downloadedFile,
            extractedDir: cached.extractedDir,
          };
          setMode("launching");
          setStatus(`Launching ${rom.title} (cached) in ${det.emulator.spec.label}…`);
          const replay = await launchEmulator(det.emulator, platform, cached.launchPath, config.raw);
          if (replay.code !== 0) {
            setError(
              `${det.emulator.spec.label} exited with code ${replay.code}.` +
                (replay.stderrTail.length ? `\n${replay.stderrTail.join("\n")}` : ""),
            );
          }
          await refreshCacheInfo();
          setMode("post");
          return;
        }
      }

      if (!aria) {
        setError(`aria2c is required for downloads but was not found.\n  Install it with:  ${ARIA2C_INSTALL_HINT}`);
        setMode("error");
        return;
      }

      const target = await resolveDownloadTarget(platform, rom, config.raw);
      const file = downloadedFilePath(downloadDir, target.file);

      setProgress({
        ratio: 0,
        completedBytes: 0,
        totalBytes: target.file.length,
        downloadSpeed: 0,
        connections: 0,
      });
      setMode("downloading");

      const handle = startDownload({
        aria2c: aria,
        torrentPath: cachedTorrentPath(target.torrentName),
        file: target.file,
        downloadDir,
        config: config.raw,
        onProgress: setProgress,
      });
      downloadHandle.current = handle;
      await handle.completed;
      downloadHandle.current = null;

      // Permanent keep: move the download into the library and play from there.
      if (keep) {
        setStatus("Saving to library…");
        const libFile = await saveToLibrary(config.libraryPath, platform.key, file);
        const prep = await prepareRom(libFile, det.emulator.spec, platform.archive, detectExtractTools());
        const biosErr = await ensureArcadeBios(aria, dirname(prep.launchPath));
        if (biosErr) {
          setError(biosErr);
          setMode("error");
          return;
        }
        current.current = { rom, downloadDir, downloadedFile: libFile, extractedDir: prep.extractedDir };
        setMode("launching");
        setStatus(`Launching ${rom.title} (library) in ${det.emulator.spec.label}…`);
        const r = await launchEmulator(det.emulator, platform, prep.launchPath, config.raw);
        if (prep.extractedDir) await rm(prep.extractedDir, { recursive: true, force: true }).catch(() => {});
        current.current = null;
        if (r.code !== 0) {
          setError(
            `${det.emulator.spec.label} exited with code ${r.code}.` +
              (r.stderrTail.length ? `\n${r.stderrTail.join("\n")}` : ""),
          );
          setMode("error");
        } else {
          setStatus(`Saved permanently to ${libFile}`);
          setMode("browse");
        }
        return;
      }

      setStatus("Preparing ROM…");
      const tools = detectExtractTools();
      const prepared = await prepareRom(file, det.emulator.spec, platform.archive, tools);
      current.current = {
        rom,
        downloadDir,
        downloadedFile: file,
        extractedDir: prepared.extractedDir,
      };

      if (config.raw.cacheEnabled) {
        await recordDownload({
          platform: platform.key,
          romName: rom.name,
          downloadedFile: file,
          launchPath: prepared.launchPath,
          extractedDir: prepared.extractedDir,
          sizeBytes: target.file.length,
        });
        const { evicted, freedBytes } = await enforceCap(config.raw, cacheKey(platform.key, rom.name));
        await refreshCacheInfo();
        if (evicted > 0) {
          setStatus(`Cache full — evicted ${evicted} game(s), freed ${formatBytes(freedBytes)}.`);
        }
      }

      const biosErr = await ensureArcadeBios(aria, dirname(prepared.launchPath));
      if (biosErr) {
        setError(biosErr);
        setMode("error");
        return;
      }

      setMode("launching");
      setStatus(`Launching ${rom.title} in ${det.emulator.spec.label}…`);
      const result = await launchEmulator(det.emulator, platform, prepared.launchPath, config.raw);

      if (result.code !== 0) {
        setError(
          `${det.emulator.spec.label} exited with code ${result.code}.` +
            (result.stderrTail.length ? `\n${result.stderrTail.join("\n")}` : ""),
        );
        // Still allow keep/delete of the downloaded file.
      }
      setMode("post");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancelled/i.test(msg)) {
        setStatus("Download cancelled.");
        setMode("browse");
      } else {
        setError(msg);
        setMode("error");
      }
    }
  }, [results, selected, platform, config, keep, refreshCacheInfo, ensureArcadeBios]);

  const postAction = useCallback(async (choice: "keep" | "delete" | "move") => {
    const cur = current.current;
    if (!cur) {
      setMode("browse");
      return;
    }
    try {
      if (choice === "delete") {
        await removeCached(platform.key, cur.rom.name);
        setStatus(`Deleted ${cur.rom.title}.`);
      } else if (choice === "move") {
        const dest = await saveToLibrary(config.libraryPath, platform.key, cur.downloadedFile);
        if (cur.extractedDir) await rm(cur.extractedDir, { recursive: true, force: true });
        await dropFromManifest(platform.key, cur.rom.name);
        setStatus(`Moved to ${dest}`);
      } else {
        setStatus(`Kept in cache: ${cur.rom.title}`);
      }
      await refreshCacheInfo();
    } catch (e: unknown) {
      setStatus(`Post-action failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    current.current = null;
    setError("");
    setMode("browse");
  }, [config, platform, refreshCacheInfo]);

  const refreshIndex = useCallback(async () => {
    setMode("loading");
    setStatus(`Refreshing ${platform.name} index…`);
    try {
      const res = await getIndex(platform, config.raw, { force: true });
      setEntries(res.index.entries);
      setSearcher(createSearcher(res.index));
      setStale(res.stale);
      setStatus("");
      setMode("browse");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setMode("error");
    }
  }, [platform, config]);

  const clearCache = useCallback(async () => {
    setMode("loading");
    setStatus("Clearing index cache…");
    await rm(join(cacheDir(), "index"), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheDir(), "collections"), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheDir(), "torrents.json"), { force: true }).catch(() => {});
    await refreshIndex();
  }, [refreshIndex]);

  // ── Input handling ──────────────────────────────────────────────────────
  useInput((input, key) => {
    // Overlays / transient states first.
    if (mode === "info") {
      if (key.escape || input === "i" || input === "I") setMode("browse");
      else if (key.return) {
        setMode("browse");
        void launchSelected();
      }
      return;
    }
    if (mode === "platform") {
      if (key.escape) {
        setMode("browse");
      } else if (key.upArrow) {
        setPlatformSel((s) => Math.max(0, s - 1));
      } else if (key.downArrow) {
        setPlatformSel((s) => Math.min(platforms.length - 1, s + 1));
      } else if (key.return) {
        const next = platforms[platformSel];
        setMode("browse");
        if (next && next.key !== platform.key) {
          setQuery("");
          setDebounced("");
          setPlatform(next);
        }
      }
      return;
    }
    if (mode === "downloading") {
      if (key.escape) downloadHandle.current?.cancel();
      return;
    }
    if (mode === "post") {
      const c = input.toLowerCase();
      if (c === "k") void postAction("keep");
      else if (c === "d") void postAction("delete");
      else if (c === "m") void postAction("move");
      return;
    }
    if (mode === "error") {
      // Any key dismisses back to browse.
      setError("");
      setMode("browse");
      return;
    }
    if (mode === "loading" || mode === "resolving" || mode === "launching") {
      return; // busy
    }

    // ── browse mode ──
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected((s) => Math.min(Math.max(0, results.length - 1), s + 1));
    } else if (key.pageUp) {
      setSelected((s) => Math.max(0, s - listHeight));
    } else if (key.pageDown) {
      setSelected((s) => Math.min(Math.max(0, results.length - 1), s + listHeight));
    } else if (key.return) {
      void launchSelected();
    } else if (key.tab) {
      setSearchFocused((f) => !f);
    } else if (key.escape) {
      setSearchFocused(false);
    } else if (!searchFocused) {
      // Command mode: single-letter shortcuts.
      switch (input.toLowerCase()) {
        case "p":
          setPlatformSel(Math.max(0, platforms.findIndex((p) => p.key === platform.key)));
          setMode("platform");
          break;
        case "i": {
          const rom = results[selected];
          if (rom) {
            const det = detectEmulator(platform, config.raw);
            setEmuInfo({
              ok: det.ok,
              text: det.ok
                ? `${det.emulator.spec.label} — ${det.emulator.bin}` +
                  (det.emulator.corePath ? `\n           core: ${det.emulator.corePath}` : "")
                : det.message,
            });
            setMode("info");
          }
          break;
        }
        case "l":
          setKeep((k) => !k);
          break;
        case "c":
          void clearCache();
          break;
        case "r":
          void refreshIndex();
          break;
        case "q":
          exit();
          break;
      }
    }
  });

  // ── Render ───────────────────────────────────────────────────────────────
  const selectedRom = results[selected];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text color="magentaBright" bold>
          emu
        </Text>
        <Text dimColor>{"  —  terminal ROM launcher"}</Text>
        <Box flexGrow={1} />
        <Text dimColor>{`cache ${formatBytes(cacheInfo.totalBytes)}/${config.raw.cacheMaxSizeGB}GB (${cacheInfo.count})  `}</Text>
        <Text color={keep ? "green" : "gray"}>{keep ? "library ✓" : "library ✗"}</Text>
        <Text dimColor>{`  v${VERSION}`}</Text>
      </Box>

      <SearchBar
        query={query}
        onChange={setQuery}
        focused={searchFocused && mode === "browse"}
        platformName={`${platform.name} (${platform.key})`}
      />

      {stale && (
        <Text color="yellow">⚠ Showing cached index (MiNERVA unreachable or rate-limited). Press R to retry.</Text>
      )}

      <Text dimColor>{"─".repeat(Math.min(process.stdout.columns || 60, 60))}</Text>

      {/* Main area by mode */}
      {mode === "loading" && <Text color="cyan">{status || "Loading…"}</Text>}

      {mode === "resolving" && <Text color="cyan">{status}</Text>}

      {(mode === "browse" || mode === "info") && (
        <GameList items={results} selected={selected} height={listHeight} />
      )}

      {mode === "info" && selectedRom && (
        <InfoPanel rom={selectedRom} platform={platform} emulator={emuInfo} />
      )}

      {mode === "platform" && (
        <PlatformPicker platforms={platforms} selected={platformSel} height={listHeight} />
      )}

      {mode === "downloading" && selectedRom && (
        <DownloadProgress name={selectedRom.name} progress={progress} />
      )}

      {mode === "launching" && (
        <Box marginY={1} flexDirection="column">
          <Text color="green">▶ {status}</Text>
          <Text dimColor>The TUI will resume when you quit the emulator.</Text>
        </Box>
      )}

      {mode === "post" && (
        <Box marginY={1} flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          {error ? (
            <Text color="red" wrap="truncate-end">
              {error.split("\n")[0]}
            </Text>
          ) : (
            <Text>
              Finished <Text color="cyanBright">{current.current?.rom.title}</Text>.
            </Text>
          )}
          <Text>
            Keep this download? <Text color="green">[K]eep</Text> · <Text color="red">[D]elete</Text> ·{" "}
            <Text color="yellow">[M]ove to library</Text>
          </Text>
          <Text dimColor>{`default: ${keep ? "keep" : "delete"} · ${formatBytes(progress.totalBytes)}`}</Text>
        </Box>
      )}

      {mode === "error" && (
        <Box marginY={1} flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red" bold>
            Error
          </Text>
          {error.split("\n").map((line, i) => (
            <Text key={i} color="red">
              {line}
            </Text>
          ))}
          <Box height={1} />
          <Text dimColor>Press any key to continue.</Text>
        </Box>
      )}

      {status && mode === "browse" && <Text dimColor>{status}</Text>}

      {/* Footer */}
      {mode === "browse" && (
        <>
          <Text dimColor>{"─".repeat(Math.min(process.stdout.columns || 60, 60))}</Text>
          {searchFocused ? (
            <Text dimColor>↑↓ move · Enter launch · Tab commands · Ctrl+C quit</Text>
          ) : (
            <Text>
              <Text color="yellow">[P]</Text>latform <Text color="yellow">[I]</Text>nfo{" "}
              <Text color="yellow">[L]</Text>library:{keep ? "on" : "off"} <Text color="yellow">[C]</Text>lear-cache{" "}
              <Text color="yellow">[R]</Text>efresh <Text color="yellow">[Q]</Text>uit ·{" "}
              <Text dimColor>Tab to search</Text>
            </Text>
          )}
        </>
      )}
    </Box>
  );
}
