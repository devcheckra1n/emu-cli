import { Box, Text } from "ink";
import type { DownloadProgress as Progress } from "../types.ts";
import { formatBytes, formatSpeed, progressBar } from "../util/format.ts";

interface Props {
  name: string;
  progress: Progress;
}

export function DownloadProgress({ name, progress }: Props) {
  const pct = Math.round(progress.ratio * 100);
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        Downloading <Text color="cyanBright">{name}</Text>
      </Text>
      <Box height={1} />
      <Text>
        <Text color="green">{progressBar(progress.ratio, 40)}</Text> {pct}%
      </Text>
      <Text dimColor>
        {formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}
        {"   "}
        {formatSpeed(progress.downloadSpeed)}
        {"   peers: "}
        {progress.connections}
      </Text>
      <Box height={1} />
      <Text dimColor>Esc to cancel</Text>
    </Box>
  );
}
