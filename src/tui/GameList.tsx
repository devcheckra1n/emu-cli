import { Box, Text } from "ink";
import type { RomEntry } from "../types.ts";
import { formatBytes } from "../util/format.ts";

interface Props {
  items: RomEntry[];
  selected: number;
  height: number;
}

export function GameList({ items, selected, height }: Props) {
  if (items.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No results.</Text>
      </Box>
    );
  }

  const h = Math.max(1, height);
  // Keep the cursor roughly centered within the visible window.
  let start = Math.max(0, selected - Math.floor(h / 2));
  start = Math.min(start, Math.max(0, items.length - h));
  const visible = items.slice(start, start + h);

  return (
    <Box flexDirection="column">
      {visible.map((it, i) => {
        const idx = start + i;
        const sel = idx === selected;
        const region = it.region ? ` (${it.region})` : "";
        const label = `${it.title}${region}  —  ${formatBytes(it.sizeBytes)}`;
        return (
          <Text
            key={it.relPath}
            wrap="truncate-end"
            color={sel ? "black" : undefined}
            backgroundColor={sel ? "cyan" : undefined}
          >
            {sel ? "› " : "  "}
            {label}
          </Text>
        );
      })}
      <Text dimColor>{`  ${selected + 1}/${items.length}`}</Text>
    </Box>
  );
}
