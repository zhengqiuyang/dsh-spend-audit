/**
 * The replay engine: fold parsed session events into a deterministic spend
 * ledger. Pure — no fs, no cordis. Attribution (plugin/tool) is injected by
 * the caller via a ToolAttribution map so the engine stays testable.
 */
import { type PriceTable, type CostBreakdown } from './prices.js';
import type { SessionEventLike } from './session-types.js';
/** tool name -> registering plugin (from runtime attribution or header plugin fields). */
export type ToolAttribution = Record<string, string>;
export interface CallEntry {
    seq?: number;
    turn?: number;
    step?: number;
    callId?: string;
    tool?: string;
    plugin?: string;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
    };
    cost: CostBreakdown;
}
export interface PhaseSplit {
    /** Calls before the first compaction/summary event. */
    preCompaction: {
        calls: number;
        total: number;
    };
    /** Calls after it. */
    postCompaction: {
        calls: number;
        total: number;
    };
}
export interface Reconciliation {
    /** Total recomputed by this engine, USD. */
    recomputed: number;
    /** Total self-reported by an in-process meter, when the log carries one. */
    selfReported?: number;
    /** Which plugin:* record type the number came from. */
    selfReportedBy?: string;
    /** selfReported − recomputed; present only when both sides exist. */
    delta?: number;
    /** |delta| / max(recomputed, epsilon). */
    deltaRatio?: number;
}
export interface SpendLedger {
    sessionId?: string;
    /** Every billed model call, in log order. */
    calls: CallEntry[];
    /** Aggregates. */
    total: number;
    perModel: Record<string, {
        calls: number;
        total: number;
        tokens: number;
    }>;
    perPlugin: Record<string, {
        calls: number;
        total: number;
    }>;
    perTool: Record<string, {
        calls: number;
        total: number;
    }>;
    phases: PhaseSplit;
    /** Calls whose model had no price entry — tokens counted, cost unknown. */
    unpricedModels: string[];
    /** Calls with no usage bucket (adapter did not report) — excluded, not zeroed. */
    callsWithoutUsage: number;
    /** Model config snapshots seen (request/header), latest wins. */
    modelConfigChanges: {
        reason?: string;
        provider?: string;
        model?: string;
    }[];
    reconciliation?: Reconciliation;
    /** Events the engine observed, for audit exposition. */
    stats: {
        events: number;
        assistantMessages: number;
        toolCalls: number;
        compactions: number;
    };
}
export declare function emptyLedger(): SpendLedger;
export interface ReplayOptions {
    table: PriceTable;
    attribution?: ToolAttribution;
    /** Seed a self-reported total + its emitting record type (from extractSelfReported). */
    selfReported?: {
        total: number;
        source: string;
    };
}
/**
 * Fold session events into a ledger. Known event handling:
 * - assistant/message: usage + model source → one CallEntry
 * - tool/call: pairs the nearest assistant/message by turn/step for tool attribution
 * - compaction/summary: flips the phase split
 * - request/header: model config snapshot history
 */
export declare function replay(events: SessionEventLike[], options: ReplayOptions): SpendLedger;
/**
 * Extract a self-reported total from plugin:* records in the log. Honesty
 * first: ANY plugin:* record carrying a numeric total is accepted, and the
 * emitting record type is returned alongside so reports can name their
 * source. Last record wins (logs are append-only; later = newer).
 */
export declare function extractSelfReported(events: SessionEventLike[]): {
    total: number;
    source: string;
} | undefined;
