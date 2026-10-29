/**
 * Session-log parsing: JSONL lines (zstd-compressed generations must be
 * decompressed upstream — this parser takes plaintext lines). First line may
 * be a session header (type 'session'); every following line is an event.
 */
import type { SessionEventLike, SessionLine } from './session-types.js';

export interface ParsedSession {
  lines: SessionLine[];
  /** Malformed lines skipped, with reasons. */
  skipped: { line: number; reason: string }[];
  sessionId?: string;
  headerCount: number;
  eventCount: number;
}

export function parseSessionLog(text: string): ParsedSession {
  const lines: SessionLine[] = [];
  const skipped: { line: number; reason: string }[] = [];
  let sessionId: string | undefined;
  let headerCount = 0;
  let eventCount = 0;

  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? '';
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    let event: SessionEventLike;
    try {
      event = JSON.parse(trimmed) as SessionEventLike;
    } catch (e) {
      skipped.push({ line: i + 1, reason: `invalid JSON: ${(e as Error).message.slice(0, 60)}` });
      continue;
    }
    if (typeof event !== 'object' || event === null || typeof (event as SessionEventLike).type !== 'string') {
      skipped.push({ line: i + 1, reason: 'not an event object' });
      continue;
    }
    if (event.type === 'session') {
      headerCount += 1;
      const id = (event as unknown as { id?: string }).id;
      if (typeof id === 'string') sessionId = id;
      lines.push({ raw: trimmed, event });
      continue;
    }
    eventCount += 1;
    lines.push({ raw: trimmed, event });
  }

  return { lines, skipped, sessionId, headerCount, eventCount };
}
