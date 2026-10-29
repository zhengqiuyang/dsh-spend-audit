/**
 * Session-log loading: plaintext JSONL or zstd-compressed generations
 * (DSH's default persistence encoding; magic 0x28 B5 2F FD).
 */
import { readFile } from 'node:fs/promises';

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isZstd(buf: Buffer): boolean {
  return buf.length >= 4 && ZSTD_MAGIC.every((b, i) => buf[i] === b);
}

export interface LoadedLog {
  text: string;
  compression: 'none' | 'zstd';
}

export async function loadSessionLog(path: string): Promise<LoadedLog> {
  const buf = await readFile(path);
  if (isZstd(buf)) {
    const { decompress } = await import('fzstd');
    const out = decompress(new Uint8Array(buf));
    return { text: new TextDecoder().decode(out), compression: 'zstd' };
  }
  return { text: buf.toString('utf8'), compression: 'none' };
}
