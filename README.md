# emu-cli

A terminal-first ROM launcher. Search, download, and play retro games from the
[MiNERVA Archive](https://minerva-archive.org) — the torrent-based successor to
Myrient — without leaving your terminal. Built with **Bun + TypeScript + Ink**.

```
emu  —  terminal ROM launcher                                   keep ✗  v0.1.0
Search [pokemon                         ]  Platform: Game Boy Advance (gba)
────────────────────────────────────────────────────────────────────────────
› Pokemon - Emerald Version (USA)        —  6.69 MB
  Pokemon - FireRed Version (USA, Rev 1) —  5.07 MB
  Pokemon - Ruby Version (USA, Rev 2)    —  4.73 MB
  …
────────────────────────────────────────────────────────────────────────────
↑↓ move · Enter launch · Tab commands · Ctrl+C quit
```

Downloaded ROMs are cached on disk for instant replay and auto-evicted (LRU)
once the cache passes a size cap — or move them to your permanent library.

## How it works

MiNERVA distributes **one torrent per platform** (not per ROM). emu-cli scrapes
each platform's browse page into a local, fuzzy-searchable index, then on launch
resolves your pick to its file *inside* the platform torrent and downloads just
that file with `aria2c --select-file` (head/tail piece priority for a fast
start). Played ROMs are cached on disk, so replays launch **instantly and
offline**, with an LRU size cap to keep the cache bounded. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full design (including why true
sub-file "streaming" into an emulator isn't possible here) and the research
behind it.

## Requirements

- **macOS (Apple Silicon)** — primary, fully tested target. **Linux** (x64/arm64)
  is supported as well.
- **[Bun](https://bun.sh)** ≥ 1.1 — `curl -fsSL https://bun.sh/install | bash`
- **aria2** (torrent downloader)
- **p7zip / sevenzip** (for `.7z` and disc images)
- **At least one emulator** (see the table below). Run `emu-cli --list-platforms`
  to see what's already installed.

**macOS (Homebrew):**

```sh
brew install bun aria2 sevenzip
brew install --cask retroarch mgba          # plus whichever emulators you want
```

**Linux:**

```sh
# Debian/Ubuntu
sudo apt install aria2 p7zip-full retroarch mgba-qt
# Arch:   sudo pacman -S aria2 p7zip retroarch
# Fedora: sudo dnf install aria2 p7zip retroarch
```

> **Flatpak emulators on Linux:** emu-cli finds RetroArch cores in the usual
> native *and* Flatpak locations, but it launches emulators by their binary on
> `$PATH`. For a Flatpak install, either use the native package, or point the
> config at a wrapper, e.g.
> `"platforms": { "snes": { "emulator": "flatpak", "args": ["run", "org.libretro.RetroArch"] } }`.

## Install

### Option A — run from source

```sh
git clone https://github.com/<you>/emu-cli && cd emu-cli
bun install
bun run src/index.tsx --help     # run directly
bun link                          # OR register `emu` + `emu-cli` on your PATH
```

### Option B — compile a standalone binary (no Bun needed at runtime)

```sh
bun install
bun run build                     # → ./emu  (bun build … --compile --outfile emu)
```

Cross-compile for another OS/arch with `--target`:

```sh
bun build ./src/index.tsx --compile --target=bun-linux-x64    --outfile emu-cli
bun build ./src/index.tsx --compile --target=bun-linux-arm64  --outfile emu-cli
bun build ./src/index.tsx --compile --target=bun-darwin-arm64 --outfile emu-cli
```

### Put it on your PATH as `emu-cli`

```sh
# user-local, no sudo (make sure ~/.local/bin is on your PATH):
mkdir -p ~/.local/bin && mv emu ~/.local/bin/emu-cli
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc

# …or system-wide:
sudo mv emu /usr/local/bin/emu-cli
```

Then just run `emu-cli`.

## Usage

```
emu [search terms]        Launch the TUI, optionally pre-filling the search
emu --platform <key>      Pre-filter to a platform (e.g. gba, snes, psx)
emu --list-platforms      List supported platforms + emulator status
emu --config              Open the config file in $EDITOR
emu --clean               Delete the temp download folder and exit
emu --help / --version
```

```sh
emu pokemon emerald
emu --platform snes "chrono trigger"
emu -p psx
```

### Keybindings

The search box is focused by default — just type to filter. Press **Tab** to
switch to command mode for the single-letter shortcuts.

| Key | Action |
| --- | --- |
| `↑` / `↓`, `PgUp` / `PgDn` | Move selection |
| `Enter` | Download + launch the selected ROM |
| `Tab` | Toggle between **search** and **command** mode |
| `P` | Platform picker |
| `I` | Info panel (size, region, emulator that will be used) |
| `L` | Toggle keep-by-default |
| `C` | Clear the index cache and refresh |
| `R` | Refresh the current platform index |
| `Q` / `Ctrl+C` | Quit |

After you quit the emulator you're prompted: **[K]eep** (leave in temp) ·
**[D]elete** · **[M]ove to library**.

## Supported platforms

| Key | System | Default emulator |
| --- | --- | --- |
| `gba` | Game Boy Advance | mGBA |
| `gb` / `gbc` | Game Boy / Color | mGBA |
| `nes` | NES | RetroArch (Mesen) |
| `snes` | SNES | RetroArch (bsnes-hd) |
| `n64` | Nintendo 64 | RetroArch (Mupen64Plus-Next) |
| `nds` | Nintendo DS | melonDS |
| `genesis` / `gg` | Genesis / Game Gear | RetroArch (Genesis Plus GX) |
| `3ds` | Nintendo 3DS | RetroArch (Azahar) |
| `psx` | PlayStation | RetroArch (Beetle PSX HW) |
| `ps2` | PlayStation 2 | PCSX2 |
| `psp` | PSP | PPSSPP |
| `gc` / `wii` | GameCube / Wii | Dolphin |
| `saturn` | Sega Saturn | RetroArch (Beetle Saturn) |
| `dc` | Dreamcast | RetroArch (Flycast) |
| `vita` | PS Vita | Vita3K *(experimental)* |
| `arcade-fbn` / `arcade-mame` | Arcade | FBNeo / MAME *(experimental)* |

Every emulator is overridable in config. Arcade is experimental, but Neo Geo
works out of the box: the shared BIOS (`neogeo.zip`) is downloaded automatically
next to the game so FBNeo can boot it.

## Configuration

`~/.config/emu-cli/config.json` (created on first run, human-editable):

```json
{
  "libraryPath": "~/ROMs",
  "tempPath": "~/.cache/emu-cli/tmp",
  "defaultKeep": false,
  "bufferThresholdMB": 50,
  "platforms": {
    "gba": { "emulator": "mgba", "args": [] }
  },
  "retroarchCorePath": null,
  "aria2cPath": null,
  "indexMaxAgeDays": 7,
  "minervaBaseUrl": "https://minerva-archive.org",
  "cdnBaseUrl": "https://cdn.minerva-archive.org",
  "seedAfterDownload": false,
  "cacheEnabled": true,
  "cacheMaxSizeGB": 20
}
```

- `platforms.<key>.emulator` — binary name or absolute path to override the default.
- `platforms.<key>.args` — extra args passed before the ROM path.
- `retroarchCorePath` — extra directory to search for RetroArch cores.
- `cacheEnabled` / `cacheMaxSizeGB` — keep played ROMs on disk for instant replay;
  least-recently-played games are auto-evicted once the cache exceeds the cap.
- Paths use `~` and are expanded at runtime.

## Development

```sh
bun run typecheck                              # tsc --noEmit (strict)
bun run scripts/build-indexes.ts               # build/verify all platform indexes
bun run scripts/smoke-search.ts gba pokemon    # live scrape + fuzzy search
bun run scripts/smoke-resolve.ts               # torrent → file-index resolution
bun run scripts/smoke-bios.ts                  # arcade game + BIOS resolution
bun run scripts/smoke-cache.ts                 # cache record + LRU eviction
bun run scripts/smoke-tui.tsx                  # mount the Ink UI headless
```

Layout follows `src/{tui,minerva,downloader,emulator}` + `config.ts` — see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Legal

Emulators and ROM-management tools are legal; **sourcing ROMs is your
responsibility**. Only download games you are legally entitled to — titles you
own, homebrew, or public-domain releases — and follow the laws in your
jurisdiction. This project is for preservation and personal use; it ships no
copyrighted content and is not affiliated with MiNERVA, Nintendo, Sony, Sega, or
any rights holder.

## Limitations

- Arcade (MAME/FBNeo) and PS Vita are best-effort/experimental.
- ROMs download fully before launching. True sub-file "streaming" into the
  emulator isn't possible with this stack (emulators need a complete file at
  random offsets; MiNERVA disc images are zipped and must be fully extracted) —
  instead the **smart cache** makes every replay instant. See ARCHITECTURE.md.
- Primarily developed and tested on macOS Apple Silicon; Linux (x64/arm64) is
  supported but less battle-tested.
