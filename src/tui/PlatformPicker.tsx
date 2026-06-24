import { Box, Text } from "ink";
import type { PlatformDef } from "../types.ts";

interface Props {
  platforms: PlatformDef[];
  selected: number;
  height: number;
}

export function PlatformPicker({ platforms, selected, height }: Props) {
  const h = Math.max(1, height);
  let start = Math.max(0, selected - Math.floor(h / 2));
  start = Math.min(start, Math.max(0, platforms.length - h));
  const visible = platforms.slice(start, start + h);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Text bold color="yellow">
        Select platform
      </Text>
      <Box height={1} />
      {visible.map((p, i) => {
        const idx = start + i;
        const sel = idx === selected;
        return (
          <Text
            key={p.key}
            color={sel ? "black" : undefined}
            backgroundColor={sel ? "yellow" : undefined}
          >
            {sel ? "› " : "  "}
            {p.key.padEnd(12)}
            {p.name}
            <Text dimColor>{`  ${p.collection}`}</Text>
          </Text>
        );
      })}
      <Box height={1} />
      <Text dimColor>↑↓ move · Enter select · Esc cancel</Text>
    </Box>
  );
}
