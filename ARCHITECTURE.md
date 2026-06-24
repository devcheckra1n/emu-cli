# Architecture

`emu-cli` is a terminal ROM launcher for the **MiNERVA Archive**
(`minerva-archive.org`), the torrent-based successor to Myrient (which shut down
2026-03-31). This document records how the archive actually works — several
details differ from common assumptions — and the design decisions that follow.

## TL;DR of the research (verified live, not assumed)

| Assumption (common) | Reality (verified against the live site) |
| --- | --- |
| Per-ROM `.torrent` / magnet links at `/rom?id=<id>` | ❌ No such thing. Torrents are **per platform/collection**, hosted on a CDN. |
| ROM info page is `/rom?id=` | It's `/rom?name=<url-encoded path>`, and it is **JS-rendered** (hashes/size/links load via JS) — unusable for static scraping. |
| Browse pages might be paginated/JS | ✅ Fully **server-rendered HTML**, no pagination (GBA = 3688 ROMs in one 1.6 MB page). |
| Search endpoint is scrapable | `/search/` is JS-rendered. We build a **local index** instead. |

### The distribution model

MiNERVA publishes **one torrent per platform**, flat on a CDN:

```
https://cdn.minerva-archive.org/torrents/Minerva_Myrient - No-Intro - Nintendo - Game Boy Advance.torrent
```

That single torrent contains every GBA ROM as a separate file. An individual
game is therefore **one file inside a multi-file torrent**, not its own torrent.
This is exactly how the existing community tool
[`gcpadua/Minerva-Myrient-Downloader`](https://github.com/gcpadua/Minerva-Myrient-Downloader)
works (download the platform torrent, select the files you want).

Browse pages list each ROM with a link to its info page and a size:

```html
<div class="entry" data-name="advance wars (usa).zip">
  <a href="/rom?name=.%2FNo-Intro%2FNintendo%20-%20Game%20Boy%20Advance%2FAdvance%20Wars%20(USA).zip">Advance Wars (USA).zip</a>
  <span>2.30 MB</span>
</div>
```

## Downloader: aria2c (not webtorrent-cli)

**Decision: aria2c.** Rationale:

1. **Per-file selection.** Our whole model depends on downloading *one file* from
   a large multi-file torrent. `aria2c --select-file=<index>` does this natively
   and only fetches the pieces covering that file. webtorrent-cli's `--select`
   is less ergonomic for this and the CLI is geared toward whole-torrent or
   streaming-to-player use.
2. **Fast-start.** `--bt-prioritize-piece=head,tail` orders the first/last
   pieces of the selected file first — important for formats the emulator reads
   sequentially, and it makes small ROMs (the common case, < 16 MB) usable
   almost immediately.
3. **Stability & ubiquity.** aria2 is a mature C++ daemon, trivially installed
   via Homebrew (`brew install aria2`), and is what the existing MiNERVA
   community tooling standardized on.
4. **Parseable progress.** aria2c's console readout (`[#gid 1.2MiB/2.3MiB(52%)
   CN:5 DL:2.5MiB]`) is stable and easy to parse in real time.

The file index aria2c needs is **1-based, in torrent file order**. We obtain it
by downloading the platform `.torrent` once and parsing it with a small,
dependency-free **bencode decoder** (`src/minerva/torrent.ts`) operating on raw
bytes (the `pieces` field is binary and must never be decoded as text).

### aria2c invocation

```
aria2c \
  --dir=<tempPath>/<platform> \
  --select-file=<index> \
  --bt-prioritize-piece=head,tail \
  --seed-time=0 \
  --file-allocation=none \
  --summary-interval=1 --console-log-level=warn --enable-color=false \
  "<cached .torrent path>"
```

The selected file lands at `<dir>/<torrent-internal-path>`, e.g.
`…/Minerva_Myrient/No-Intro/Nintendo - Game Boy Advance/Advance Wars (USA).zip`.
Selected-file pieces are BitTorrent piece-hash verified inherently, so no extra
integrity check is needed.

## "Streaming" — why it's whole-ROM caching, not sub-file demand paging

A natural ask is to *stream* a game: download chunks on demand as the emulator
reads them, evicting what's no longer needed. That is **not feasible** with this
stack, for concrete reasons:

- **Emulators read the ROM as a complete file at arbitrary offsets.** A cart
  ROM is mapped into the CPU address space — the game can read any byte the
  instant it boots. There is no hook to say "this byte isn't downloaded yet,
  fetch it and block." A missing region just reads as zeros → crash/corruption.
- **Torrents are piece-based, not byte-range-on-demand**, and aria2 has **no
  sequential-download mode for BitTorrent** and no API to fetch "the bytes the
  emulator just tried to read." It can't keep the download ahead of the read
  head. (Intercepting reads would need a FUSE virtual filesystem + a custom
  piece scheduler — a research project, and emulators don't tolerate blocking
  reads.)
- **The case where streaming would matter — large disc images — is exactly
  where it can't work**, because MiNERVA disc ROMs are `.zip`/`.7z` archives
  that must be **fully downloaded before extraction** (a zip's central directory
  is at the end; partial archives can't be opened). There is no valid partial
  state to launch from.
- For cart ROMs streaming is moot anyway: they're 2–32 MB and finish in ~1–2 s
  on a working connection.

So the feasible, useful version operates at **whole-ROM granularity**: a smart
on-disk cache (`downloader/cache.ts`).

- Downloaded ROMs stay under `tempPath` and are tracked in a manifest
  (`~/.cache/emu-cli/cache-manifest.json`) with size + last-access time.
- **Instant replay:** before downloading, a manifest lookup by
  `(platform, filename)` short-circuits to launch directly — no torrent
  resolve, no aria2, works offline.
- **Size cap + LRU eviction:** after each download the cache is trimmed to
  `cacheMaxSizeGB` by evicting the least-recently-played games (never the one
  just downloaded/playing). This is the "load onto storage when needed, delete
  and replace" behavior, done where it actually works.
- Keep / Delete / Move-to-library at the post-play prompt give explicit control;
  Move drops the manifest entry without deleting (the file relocated).

## Index + search

```
browse HTML ──scrape──▶ PlatformIndex (RomEntry[]) ──cache──▶ ~/.cache/emu-cli/index/<platform>.json
                                                   └──fuse.js──▶ fuzzy search (debounced 150 ms)
```

- `minerva/browse.ts` scrapes a platform's browse page into `RomEntry[]`
  (filename, title, region parsed from the No-Intro/Redump filename, size).
- Folder names are **re-resolved against the live collection listing** so small
  drift in the hardcoded `systemFolder` self-corrects.
- Indexes cache to `~/.cache/emu-cli/` and refresh on demand or when older than
  `indexMaxAgeDays` (default 7). If the network fails, a stale cache is served
  with a UI warning.
- Search is local `fuse.js` over the cached entries — no network per keystroke.

## Torrent resolution (`minerva/rom.ts`)

1. Fetch + cache the CDN torrent listing (`/torrents/`).
2. Map platform → torrent name: `Minerva_Myrient - <collection> - <systemFolder>`.
   - **Exact match wins** (avoids `(Aftermarket)`, `(e-Reader)` … variants).
   - Else shortest name with that prefix (picks `MAME - ROMs (merged)` when the
     bare name is absent).
3. Download + cache the `.torrent`, bencode-parse it, find the file whose
   basename equals the chosen ROM → `{ torrentUrl, file: { index, length } }`.

## File handling & extraction (`downloader/extract.ts`)

- mGBA and RetroArch cart cores read `.zip` natively → archive passed straight
  through (no extraction).
- Disc emulators (DuckStation, PCSX2, Dolphin, Beetle Saturn, Flycast) and
  anything else get the archive extracted (`7z`/`unzip`), then the **primary
  file** is chosen: disc descriptor priority `.m3u > .cue > .gdi > .ccd > .mds >
  .chd > .iso > .bin`, multi-disc `.m3u` first; cart by known ROM extension;
  fallback = largest non-junk file. Multi-file pairs (`.bin`+`.cue`) extract
  together and the `.cue` is launched.

## Emulator launch (`emulator/launch.ts`)

- Detection order: config override → `Bun.which(binary)` → macOS `.app` bundles
  under `/Applications` and `~/Applications` → actionable install hint.
  RetroArch cores are resolved across the usual core directories. **Cross-platform:**
  on Linux, binaries resolve from `$PATH` and cores from native *and* Flatpak core
  dirs; the install hint switches between Homebrew and apt/pacman/Flatpak by OS.
- **Arcade BIOS:** Neo Geo games need the shared `neogeo.zip` romset beside them.
  A platform may declare `biosRomsets`; before launch, each listed BIOS is
  downloaded (from the same torrent, so it lands in the same directory) if not
  already present. That's what makes FBNeo Neo Geo titles boot.
- Args are **always an array**, never a shell string (no injection surface).
- RetroArch platforms run `retroarch -L <core> <rom>`; MAME takes a romset name
  + `-rompath`; everything else takes the ROM path as the final argument.
- Spawned with stdout ignored (keeps the Ink TUI clean while a GUI emulator
  runs) and stderr captured for error reporting.

## TUI (`tui/`, Ink + React)

State machine: `loading → browse → (info | platform) → resolving → downloading →
launching → post → browse`, with an `error` overlay. The search box and the
single-letter command shortcuts (`P/I/L/C/R/Q`) would collide, so input has two
zones toggled by **Tab**: *search* (type to filter) and *commands*. `↑↓`/`Enter`
work in both. All network/disk I/O is async and never blocks the render loop.

## Deviations from the original spec (intentional)

- ROM page param is `?name=` not `?id=`; that page is JS-rendered, so we never
  scrape it. Size comes from the browse listing, region from the filename,
  hashes are available from the torrent if needed.
- "Per-ROM magnet links" replaced by **per-platform torrent + file selection**
  (the only model the archive actually supports).
- Added a tiny bencode parser (no dependency) instead of a torrent library.
- Added `ink-text-input` (search box) and `minervaBaseUrl`/`cdnBaseUrl` config
  keys (so the tool survives the archive moving).

## Known limitations

- **Arcade (MAME/FBNeo)** is experimental: romset naming and parent/clone
  handling are finicky. Neo Geo works (BIOS auto-fetched via `biosRomsets`);
  other systems are best-effort.
- **PS Vita** mapping is best-effort; Vita3K needs more than a file path to run a
  title.
- Seeding after download is not wired in v0.1 (`--seed-time=0`).
