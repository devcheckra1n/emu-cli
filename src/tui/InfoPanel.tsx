import { Box, Text } from "ink";
import type { PlatformDef, RomEntry } from "../types.ts";
import { formatBytes } from "../util/format.ts";

interface Props {
  rom: RomEntry;
  platform: PlatformDef;
  /** Resolved emulator description, or an error message. */
  emulator: { ok: boolean; text: string };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text>
      <Text dimColor>{label.padEnd(11)}</Text>
      {children}
    </Text>
  );
}

export function InfoPanel({ rom, platform, emulator }: Props) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Text bold color="cyanBright" wrap="truncate-end">
        {rom.name}
      </Text>
      <Box height={1} />
      <Field label="System">
        {platform.name} <Text dimColor>({platform.key})</Text>
      </Field>
      <Field label="Region">{rom.region ?? "Unknown"}</Field>
      <Field label="Size">{formatBytes(rom.sizeBytes)}</Field>
      <Field label="Collection">{platform.collection}</Field>
      <Field label="Emulator">
        <Text color={emulator.ok ? "green" : "red"}>{emulator.text}</Text>
      </Field>
      <Box height={1} />
      <Text dimColor>Enter to launch · Esc / I to close</Text>
    </Box>
  );
}
