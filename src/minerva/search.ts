/**
 * Local fuzzy search over a cached platform index using fuse.js.
 */
import Fuse from "fuse.js";
import type { PlatformIndex, RomEntry } from "../types.ts";

export type Searcher = Fuse<RomEntry>;

export function createSearcher(index: PlatformIndex): Searcher {
  return new Fuse(index.entries, {
    keys: [
      { name: "title", weight: 0.7 },
      { name: "name", weight: 0.3 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
}

/** Search, or list the first `limit` entries when the query is empty. */
export function search(
  searcher: Searcher,
  entries: RomEntry[],
  query: string,
  limit = 250,
): RomEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, limit);
  return searcher.search(q, { limit }).map((r) => r.item);
}
