/**
 * Platform → emulator + MiNERVA-collection mapping.
 *
 * `collection` + `systemFolder` locate the platform's directory on
 * minerva-archive.org/browse/. The exact folder name is re-resolved against the
 * live collection listing at runtime (see minerva/browse.ts), so these strings
 * only need to be close. All emulator choices are overridable in config.
 */
import type { PlatformDef } from "../types.ts";

/** RetroArch cores ship as `<name>_libretro.{dylib,so,dll}`. */
function retroarch(core: string, label: string): PlatformDef["emulator"] {
  return {
    label: `RetroArch (${label})`,
    binaries: ["retroarch"],
    macApps: ["RetroArch"],
    retroarchCore: core,
    brewCask: "retroarch",
    nativeArchives: ["zip", "7z"],
  };
}

export const PLATFORMS: Record<string, PlatformDef> = {
  // ── No-Intro: cartridge systems ──────────────────────────────────────────
  gba: {
    key: "gba",
    name: "Game Boy Advance",
    collection: "No-Intro",
    systemFolder: "Nintendo - Game Boy Advance",
    archive: "cart",
    emulator: {
      label: "mGBA",
      binaries: ["mgba-qt", "mgba"],
      macApps: ["mGBA"],
      brewCask: "mgba",
      nativeArchives: ["zip"],
    },
  },
  gb: {
    key: "gb",
    name: "Game Boy",
    collection: "No-Intro",
    systemFolder: "Nintendo - Game Boy",
    archive: "cart",
    emulator: {
      label: "mGBA",
      binaries: ["mgba-qt", "mgba"],
      macApps: ["mGBA"],
      brewCask: "mgba",
      nativeArchives: ["zip"],
    },
  },
  gbc: {
    key: "gbc",
    name: "Game Boy Color",
    collection: "No-Intro",
    systemFolder: "Nintendo - Game Boy Color",
    archive: "cart",
    emulator: {
      label: "mGBA",
      binaries: ["mgba-qt", "mgba"],
      macApps: ["mGBA"],
      brewCask: "mgba",
      nativeArchives: ["zip"],
    },
  },
  nes: {
    key: "nes",
    name: "Nintendo Entertainment System",
    collection: "No-Intro",
    systemFolder: "Nintendo - Nintendo Entertainment System (Headered)",
    archive: "cart",
    emulator: retroarch("mesen_libretro", "Mesen"),
  },
  snes: {
    key: "snes",
    name: "Super Nintendo",
    collection: "No-Intro",
    systemFolder: "Nintendo - Super Nintendo Entertainment System",
    archive: "cart",
    emulator: retroarch("bsnes_hd_beta_libretro", "bsnes-hd"),
  },
  n64: {
    key: "n64",
    name: "Nintendo 64",
    collection: "No-Intro",
    systemFolder: "Nintendo - Nintendo 64 (BigEndian)",
    archive: "cart",
    emulator: retroarch("mupen64plus_next_libretro", "Mupen64Plus-Next"),
  },
  nds: {
    key: "nds",
    name: "Nintendo DS",
    collection: "No-Intro",
    systemFolder: "Nintendo - Nintendo DS (Decrypted)",
    archive: "cart",
    emulator: {
      label: "melonDS",
      binaries: ["melonDS"],
      macApps: ["melonDS"],
      brewCask: "melonds",
    },
  },
  genesis: {
    key: "genesis",
    name: "Sega Genesis / Mega Drive",
    collection: "No-Intro",
    systemFolder: "Sega - Mega Drive - Genesis",
    archive: "cart",
    emulator: retroarch("genesis_plus_gx_libretro", "Genesis Plus GX"),
  },
  gg: {
    key: "gg",
    name: "Game Gear",
    collection: "No-Intro",
    systemFolder: "Sega - Game Gear",
    archive: "cart",
    emulator: retroarch("genesis_plus_gx_libretro", "Genesis Plus GX"),
  },
  "3ds": {
    key: "3ds",
    name: "Nintendo 3DS",
    collection: "No-Intro",
    systemFolder: "Nintendo - Nintendo 3DS (Decrypted)",
    archive: "cart",
    emulator: {
      ...retroarch("azahar_libretro", "Azahar"),
      nativeArchives: [],
    },
  },
  vita: {
    key: "vita",
    name: "PlayStation Vita",
    collection: "No-Intro",
    systemFolder: "Sony - PlayStation Vita",
    archive: "cart",
    emulator: {
      label: "Vita3K",
      binaries: ["Vita3K"],
      macApps: ["Vita3K"],
      brewCask: "vita3k",
    },
  },

  // ── Redump: disc systems ─────────────────────────────────────────────────
  psx: {
    key: "psx",
    name: "PlayStation",
    collection: "Redump",
    systemFolder: "Sony - PlayStation",
    archive: "disc",
    emulator: {
      ...retroarch("mednafen_psx_hw_libretro", "Beetle PSX HW"),
      needsExtractedDisc: true,
      nativeArchives: [],
    },
  },
  ps2: {
    key: "ps2",
    name: "PlayStation 2",
    collection: "Redump",
    systemFolder: "Sony - PlayStation 2",
    archive: "disc",
    emulator: {
      label: "PCSX2",
      binaries: ["pcsx2-qt", "PCSX2"],
      macApps: ["PCSX2"],
      brewCask: "pcsx2",
      needsExtractedDisc: true,
    },
  },
  psp: {
    key: "psp",
    name: "PlayStation Portable",
    collection: "Redump",
    systemFolder: "Sony - PlayStation Portable",
    archive: "disc",
    emulator: {
      label: "PPSSPP",
      binaries: ["PPSSPPSDL", "ppsspp"],
      macApps: ["PPSSPP"],
      brewCask: "ppsspp",
      needsExtractedDisc: true,
    },
  },
  gc: {
    key: "gc",
    name: "GameCube",
    collection: "Redump",
    systemFolder: "Nintendo - GameCube",
    archive: "disc",
    emulator: {
      label: "Dolphin",
      binaries: ["dolphin-emu", "dolphin-emu-nogui"],
      macApps: ["Dolphin"],
      brewCask: "dolphin",
      needsExtractedDisc: true,
    },
  },
  wii: {
    key: "wii",
    name: "Wii",
    collection: "Redump",
    systemFolder: "Nintendo - Wii",
    archive: "disc",
    emulator: {
      label: "Dolphin",
      binaries: ["dolphin-emu", "dolphin-emu-nogui"],
      macApps: ["Dolphin"],
      brewCask: "dolphin",
      needsExtractedDisc: true,
    },
  },
  saturn: {
    key: "saturn",
    name: "Sega Saturn",
    collection: "Redump",
    systemFolder: "Sega - Saturn",
    archive: "disc",
    emulator: {
      ...retroarch("mednafen_saturn_libretro", "Beetle Saturn"),
      needsExtractedDisc: true,
      nativeArchives: [],
    },
  },
  dc: {
    key: "dc",
    name: "Dreamcast",
    collection: "Redump",
    systemFolder: "Sega - Dreamcast",
    archive: "disc",
    emulator: {
      ...retroarch("flycast_libretro", "Flycast"),
      needsExtractedDisc: true,
      nativeArchives: [],
    },
  },

  // ── Arcade (experimental: romset naming/BIOS handling is finicky) ─────────
  "arcade-fbn": {
    key: "arcade-fbn",
    name: "Arcade (FinalBurn Neo)",
    collection: "FinalBurn Neo",
    systemFolder: "arcade",
    torrentBase: "Minerva_Myrient - FinalBurn Neo",
    // Neo Geo games need the shared BIOS romset alongside them.
    biosRomsets: ["neogeo.zip"],
    archive: "arcade",
    emulator: {
      ...retroarch("fbneo_libretro", "FBNeo"),
      nativeArchives: ["zip"],
    },
  },
  "arcade-mame": {
    key: "arcade-mame",
    name: "Arcade (MAME)",
    collection: "MAME",
    systemFolder: "",
    archive: "arcade",
    emulator: {
      label: "MAME",
      binaries: ["mame"],
      macApps: ["MAME"],
      brewFormula: "mame",
      nativeArchives: ["zip"],
    },
  },
};

export function getPlatform(key: string): PlatformDef | undefined {
  return PLATFORMS[key.toLowerCase()];
}

export function platformKeys(): string[] {
  return Object.keys(PLATFORMS);
}

export function allPlatforms(): PlatformDef[] {
  return Object.values(PLATFORMS);
}
