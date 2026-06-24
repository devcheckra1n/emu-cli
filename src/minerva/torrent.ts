/**
 * Minimal bencode decoder + .torrent file-list extraction.
 *
 * We only need each file's path, length, and 1-based index (the order aria2c
 * assigns for `--select-file`). Piece hashes and other binary fields are parsed
 * but ignored. Operates on raw bytes — never decode the whole torrent as text,
 * since `pieces` contains arbitrary binary.
 */
import type { TorrentFile } from "../types.ts";

type BValue = number | Uint8Array | BValue[] | { [key: string]: BValue };

class BDecoder {
  private pos = 0;
  private readonly td = new TextDecoder();

  constructor(private readonly buf: Uint8Array) {}

  decode(): BValue {
    return this.readValue();
  }

  private byte(): number {
    const b = this.buf[this.pos];
    if (b === undefined) throw new Error("bencode: unexpected end of input");
    return b;
  }

  private readValue(): BValue {
    const c = this.byte();
    if (c === 0x64) return this.readDict(); // 'd'
    if (c === 0x6c) return this.readList(); // 'l'
    if (c === 0x69) return this.readInt(); // 'i'
    if (c >= 0x30 && c <= 0x39) return this.readBytes(); // 0-9
    throw new Error(`bencode: unexpected byte 0x${c.toString(16)} at ${this.pos}`);
  }

  private readInt(): number {
    this.pos++; // 'i'
    let s = "";
    while (this.byte() !== 0x65) {
      s += String.fromCharCode(this.byte());
      this.pos++;
    }
    this.pos++; // 'e'
    return Number(s);
  }

  private readBytes(): Uint8Array {
    let lenStr = "";
    while (this.byte() !== 0x3a) {
      // ':'
      lenStr += String.fromCharCode(this.byte());
      this.pos++;
    }
    this.pos++; // ':'
    const len = Number(lenStr);
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  private readList(): BValue[] {
    this.pos++; // 'l'
    const out: BValue[] = [];
    while (this.byte() !== 0x65) out.push(this.readValue());
    this.pos++; // 'e'
    return out;
  }

  private readDict(): { [key: string]: BValue } {
    this.pos++; // 'd'
    const out: { [key: string]: BValue } = {};
    while (this.byte() !== 0x65) {
      const key = this.td.decode(this.readBytes());
      out[key] = this.readValue();
    }
    this.pos++; // 'e'
    return out;
  }
}

export interface ParsedTorrent {
  name: string;
  files: TorrentFile[];
  totalLength: number;
}

function asDict(v: BValue): { [key: string]: BValue } {
  if (typeof v !== "object" || v instanceof Uint8Array || Array.isArray(v)) {
    throw new Error("bencode: expected dictionary");
  }
  return v;
}

export function parseTorrent(buf: Uint8Array): ParsedTorrent {
  const td = new TextDecoder();
  const root = asDict(new BDecoder(buf).decode());
  const info = asDict(root["info"]);
  const name = info["name"] instanceof Uint8Array ? td.decode(info["name"]) : "download";

  const files: TorrentFile[] = [];
  let totalLength = 0;

  if (Array.isArray(info["files"])) {
    info["files"].forEach((entry, i) => {
      const f = asDict(entry);
      const segs = (f["path"] as Uint8Array[]).map((s) => td.decode(s));
      const rel = segs.join("/");
      const length = f["length"] as number;
      totalLength += length;
      files.push({
        index: i + 1,
        path: `${name}/${rel}`,
        name: segs[segs.length - 1] ?? rel,
        length,
      });
    });
  } else {
    const length = (info["length"] as number) ?? 0;
    totalLength = length;
    files.push({ index: 1, path: name, name, length });
  }

  return { name, files, totalLength };
}
