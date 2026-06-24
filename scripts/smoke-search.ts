/**
 * Dev smoke test: scrape a platform index live and run a search.
 *   bun run scripts/smoke-search.ts gba pokemon
 */
import { loadConfig } from "../src/config.ts";
import { getPlatform } from "../src/emulator/platforms.ts";
import { getIndex } from "../src/minerva/browse.ts";
import { createSearcher, search } from "../src/minerva/search.ts";

const [platformKey = "gba", ...queryParts] = Bun.argv.slice(2);
const query = queryParts.join(" ") || "pokemon";

const { raw: config } = await loadConfig();
const platform = getPlatform(platformKey);
if (!platform) throw new Error(`Unknown platform: ${platformKey}`);

console.time("getIndex");
const { index, fromCache, stale } = await getIndex(platform, config);
console.timeEnd("getIndex");
console.log(`platform=${platform.key} entries=${index.entries.length} fromCache=${fromCache} stale=${stale}`);
console.log(`source=${index.source}`);
console.log("first 3:", index.entries.slice(0, 3).map((e) => e.name));

const searcher = createSearcher(index);
const hits = search(searcher, index.entries, query, 8);
console.log(`\nsearch "${query}" → ${hits.length} hits:`);
for (const h of hits) {
  console.log(`  ${h.title}  [${h.region ?? "?"}]  ${(h.sizeBytes / 1024 / 1024).toFixed(1)}MB  (${h.name})`);
}
