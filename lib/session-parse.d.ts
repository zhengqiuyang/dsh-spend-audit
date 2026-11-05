/**
 * Session-log parsing: JSONL lines (zstd-compressed generations must be
 * decompressed upstream — this parser takes plaintext lines). First line may
 * be a session header (type 'session'); every following line is an event.
 */
import type { SessionLine } from './session-types.js';
export interface ParsedSession {
    lines: SessionLine[];
    /** Malformed lines skipped, with reasons. */
    skipped: {
        line: number;
        reason: string;
    }[];
    sessionId?: string;
    headerCount: number;
    eventCount: number;
}
export declare function parseSessionLog(text: string): ParsedSession;
