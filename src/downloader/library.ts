/**
 * Permanent ROM library. Games kept here live at
 *   <libraryPath>/<platform>/<filename>
 * and are NEVER evicted (unlike the cache). They're recognized on the next
 * launch so a kept game plays instantly and is never re-downloaded.
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

export function libraryDir(libraryPath: string, platform: string): string {
  return join(libraryPath, platform);
}

export function libraryRomPath(libraryPath: string, platform: string, romName: string): string {
  return join(libraryDir(libraryPath, platform), romName);
}

/** Absolute path if this ROM is already saved in the library, else null. */
export function findInLibrary(libraryPath: string, platform: string, romName: string): string | null {
  const p = libraryRomPath(libraryPath, platform, romName);
  return existsSync(p) ? p : null;
}

/** Move a downloaded file into the permanent library; returns the new path. */
export async function saveToLibrary(
  libraryPath: string,
  platform: string,
  downloadedFile: string,
): Promise<string> {
  const destDir = libraryDir(libraryPath, platform);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, basename(downloadedFile));
  if (downloadedFile !== dest) {
    await Bun.write(dest, Bun.file(downloadedFile));
    await rm(downloadedFile, { force: true }).catch(() => {});
    await rm(`${downloadedFile}.aria2`, { force: true }).catch(() => {});
  }
  return dest;
}
