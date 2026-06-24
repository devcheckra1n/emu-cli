/**
 * Shared domain types for emu-cli.
 *
 * The MiNERVA model (see ARCHITECTURE.md): each platform is one large torrent on
 * the CDN, and an individual ROM is a single *file inside* that torrent. So a
 * "download target" is always (torrent URL, file index within it).
 */

export type ArchiveKind = "cart" | "disc" | "arcade";

export interface EmulatorSpec {
  /** Human label, e.g. "mGBA". */
  label: string;
  /** Candidate CLI binaries to probe with `which`, in priority order. */
  binaries: string[];
  /** macOS .app bundle names to probe under /Applications and ~/Applications. */
  macApps?: string[];
  /** If set, the platform is played through RetroArch with `-L <core>`. */
  retroarchCore?: string;
  /** Homebrew formula install hint (CLI tools). */
  brewFormula?: string;
  /** Homebrew cask install hint (GUI apps). */
  brewCask?: string;
  /** Default extra CLI args inserted before the ROM path. */
  defaultArgs?: string[];
  /** Archive extensions the emulator can load directly (e.g. ["zip"]). */
  nativeArchives?: string[];
  /** Disc emulators that cannot read .zip/.7z and require an extracted image. */
  needsExtractedDisc?: boolean;
}

export interface PlatformDef {
  /** Short key used on the CLI and in config, e.g. "gba". */
  key: string;
  /** Human name, e.g. "Game Boy Advance". */
  name: string;
  /** MiNERVA top-level collection, e.g. "No-Intro" | "Redump" | "MAME". */
  collection: string;
  /** Folder under the collection, e.g. "Nintendo - Game Boy Advance". */
  systemFolder: string;
  /** Override the CDN torrent base name (e.g. arcade single-collection torrents). */
  torrentBase?: string;
  /** BIOS romset filenames that must sit next to the game (e.g. ["neogeo.zip"]). */
  biosRomsets?: string[];
  /** Cartridge / disc / arcade — drives extraction + emulator behaviour. */
  archive: ArchiveKind;
  /** Default emulator mapping (overridable via config). */
  emulator: EmulatorSpec;
}

export interface RomEntry {
  /** Original filename incl. extension, e.g. "Advance Wars (USA).zip". */
  name: string;
  /** Cleaned title for display/search, e.g. "Advance Wars". */
  title: string;
  /** Platform key this entry belongs to. */
  platform: string;
  /** File size in bytes (best-effort from the directory listing). */
  sizeBytes: number;
  /** Region tag parsed from the No-Intro/Redump filename, e.g. "USA". */
  region: string | null;
  /** Path relative to the browse root: "<collection>/<systemFolder>/<name>". */
  relPath: string;
}

export interface PlatformIndex {
  platform: string;
  /** Epoch ms when the index was scraped. */
  fetchedAt: number;
  /** Browse URL the index was scraped from. */
  source: string;
  entries: RomEntry[];
}

export interface ResolvedEmulator {
  spec: EmulatorSpec;
  /** Absolute path to the runnable binary. */
  bin: string;
  /** Absolute path to a RetroArch core, when the platform uses RetroArch. */
  corePath?: string;
}

export interface TorrentFile {
  /** 1-based index as consumed by `aria2c --select-file`. */
  index: number;
  /** Full path of the file inside the torrent. */
  path: string;
  /** Basename of `path`. */
  name: string;
  /** File length in bytes. */
  length: number;
}

export interface DownloadTarget {
  torrentUrl: string;
  torrentName: string;
  file: TorrentFile;
}

export interface DownloadProgress {
  /** 0..1 completion of the *selected* file. */
  ratio: number;
  completedBytes: number;
  totalBytes: number;
  /** Bytes/sec download speed. */
  downloadSpeed: number;
  /** Number of connected peers/seeds, when reported. */
  connections: number;
}
