/**
 * Dev smoke test: mount the Ink App against the (cached) GBA index and assert
 * the first frame renders header, platform, and live search results.
 *   bun run scripts/smoke-tui.tsx
 */
import { render } from "ink-testing-library";
import { App } from "../src/tui/App.tsx";
import { loadConfig } from "../src/config.ts";
import { getPlatform } from "../src/emulator/platforms.ts";

const config = await loadConfig();
const platform = getPlatform("gba")!;

const { lastFrame, unmount } = render(
  <App config={config} initialPlatform={platform} initialQuery="pokemon" />,
);

await new Promise((r) => setTimeout(r, 1200)); // let the index load + debounce settle
const frame = lastFrame() ?? "";
console.log(frame);

console.log("\n--- assertions ---");
const checks: [string, boolean][] = [
  ["header 'emu'", frame.includes("emu")],
  ["platform label", frame.includes("Game Boy Advance")],
  ["search box", frame.toLowerCase().includes("search")],
  ["a Pokemon result", /pok[eé]mon/i.test(frame)],
  ["footer hint", frame.includes("Enter")],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  if (!pass) ok = false;
}
unmount();
console.log(ok ? "\nTUI smoke: PASS" : "\nTUI smoke: FAIL");
process.exit(ok ? 0 : 1);
