/**
 * Minimal session-log event shapes this auditor consumes. Structural only —
 * the full DSH types live in @deepseek-ai/dsh-session; we declare the fields
 * we read so the package stays standalone-installable.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface ModelSource {
  kind?: string;
  provider?: string;
  model?: string;
}

/** assistant/message.data */
export interface AssistantMessageData {
  turn?: number;
  step?: number;
  message?: {
    role?: string;
    source?: ModelSource;
    [k: string]: unknown;
  };
  usage?: TokenUsage;
}

/** tool/call.data */
export interface ToolCallData {
  turn?: number;
  step?: number;
  callId: string;
  name: string;
  arguments?: string;
}

/** request/header.data — model config snapshots */
export interface RequestHeaderData {
  header?: {
    config?: { provider?: string; model?: string };
    tools?: string[];
  };
  reason?: string;
}

/** tools/tokens style projection entry (dsh-context writes plugin attribution) */
export interface ToolHeaderEntry {
  name: string;
  tokens?: number;
  plugin?: string;
}

export interface SessionEventLike {
  type: string;
  seq?: number;
  time?: number;
  data?: unknown;
}

/** Parsed session-log line: header line carries type 'session'; event lines carry type/data. */
export interface SessionLine {
  raw: string;
  event: SessionEventLike;
}
