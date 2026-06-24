import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  query: string;
  onChange: (v: string) => void;
  focused: boolean;
  platformName: string;
}

export function SearchBar({ query, onChange, focused, platformName }: Props) {
  return (
    <Box>
      <Text color="cyanBright" bold>
        Search{" "}
      </Text>
      <Text dimColor>[</Text>
      <Box width={32}>
        <TextInput
          value={query}
          onChange={onChange}
          focus={focused}
          placeholder="type to filter…"
        />
      </Box>
      <Text dimColor>]</Text>
      <Text dimColor>{"  Platform: "}</Text>
      <Text color="yellow" bold>
        {platformName}
      </Text>
      {!focused && <Text dimColor>{"  (Tab to type)"}</Text>}
    </Box>
  );
}
