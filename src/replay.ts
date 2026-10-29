/**
 * The replay engine: fold parsed session events into a deterministic spend
 * ledger. Pure — no fs, no cordis. Attribution (plugin/tool) is injected by
 * the caller via a ToolAttribution map so the engine stays testable.
 */
import { priceUsage, type PriceTable, type CostBreakdown } from './prices.js';
import type { AssistantMessageData, ToolCallData, SessionEventLike } from './session-types.js';

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
  preCompaction: { calls: number; total: number };
  /** Calls after it. */
  postCompaction: { calls: number; total: number };
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
  perModel: Record<string, { calls: number; total: number; tokens: number }>;
  perPlugin: Record<string, { calls: number; total: number }>;
  perTool: Record<string, { calls: number; total: number }>;
  phases: PhaseSplit;
  /** Calls whose model had no price entry — tokens counted, cost unknown. */
  unpricedModels: string[];
  /** Calls with no usage bucket (adapter did not report) — excluded, not zeroed. */
  callsWithoutUsage: number;
  /** Model config snapshots seen (request/header), latest wins. */
  modelConfigChanges: { reason?: string; provider?: string; model?: string }[];
  reconciliation?: Reconciliation;
  /** Events the engine observed, for audit exposition. */
  stats: { events: number; assistantMessages: number; toolCalls: number; compactions: number };
}

export function emptyLedger(): SpendLedger {
  return {
    calls: [],
    total: 0,
    perModel: {},
    perPlugin: {},
    perTool: {},
    phases: {
      preCompaction: { calls: 0, total: 0 },
      postCompaction: { calls: 0, total: 0 },
    },
    unpricedModels: [],
    callsWithoutUsage: 0,
    modelConfigChanges: [],
    stats: { events: 0, assistantMessages: 0, toolCalls: 0, compactions: 0 },
  };
}

export interface ReplayOptions {
  table: PriceTable;
  attribution?: ToolAttribution;
  /** Seed a self-reported total + its emitting record type (from extractSelfReported). */
  selfReported?: { total: number; source: string };
}

/**
 * Fold session events into a ledger. Known event handling:
 * - assistant/message: usage + model source → one CallEntry
 * - tool/call: pairs the nearest assistant/message by turn/step for tool attribution
 * - compaction/summary: flips the phase split
 * - request/header: model config snapshot history
 */
export function replay(events: SessionEventLike[], options: ReplayOptions): SpendLedger {
  const ledger = emptyLedger();
  ledger.reconciliation = { recomputed: 0, ...(options.selfReported !== undefined ? { selfReported: options.selfReported.total, selfReportedBy: options.selfReported.source } : {}) };

  let sawCompaction = false;
  // tool/call events arrive AFTER their assistant/message in the log (the
  // message carries the tool-call block and the usage of the call that
  // produced it). Track pending calls per turn+step to bind tool attribution
  // onto the model call that requested them.
  let lastAssistant: CallEntry | undefined;
  // Tool attribution semantics: a tool/call marks a PENDING tool; the NEXT
  // assistant/message (the continuation that digests the tool result) carries
  // its cost — that continuation's input includes the tool result, so its
  // tokens are the tool's marginal cost.
  let pendingTool: string | undefined;

  for (const event of events) {
    ledger.stats.events += 1;
    const data = event.data as Record<string, unknown> | undefined;

    switch (event.type) {
      case 'assistant/message': {
        ledger.stats.assistantMessages += 1;
        const d = (data ?? {}) as AssistantMessageData;
        const usage = d.usage;
        const source = d.message?.source ?? {};
        const model = source.model ?? '(unknown)';
        const provider = source.provider ?? '';

        if (usage === undefined) {
          ledger.callsWithoutUsage += 1;
          lastAssistant = undefined;
          break;
        }

        const cost = priceUsage(
          {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            reasoningTokens: usage.reasoningTokens,
          },
          options.table,
          model,
        );
        if (cost.unpriced && !ledger.unpricedModels.includes(model)) {
          ledger.unpricedModels.push(model);
        }

        const entry: CallEntry = {
          seq: event.seq,
          turn: d.turn,
          step: d.step,
          tool: pendingTool,
          plugin: pendingTool !== undefined ? options.attribution?.[pendingTool] : undefined,
          model,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            reasoningTokens: usage.reasoningTokens,
          },
          cost,
        };
        if (provider !== '') (entry as { provider?: string }).provider = provider;

        ledger.calls.push(entry);
        ledger.total += cost.total;
        if (cost.unpriced === false) {
          const pm = (ledger.perModel[model] ??= { calls: 0, total: 0, tokens: 0 });
          pm.calls += 1;
          pm.total += cost.total;
          pm.tokens += usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
          const phase = sawCompaction ? ledger.phases.postCompaction : ledger.phases.preCompaction;
          phase.calls += 1;
          phase.total += cost.total;
        }
        ledger.reconciliation!.recomputed += cost.total;
        lastAssistant = entry;
        pendingTool = undefined;   // consumed by this continuation
        break;
      }

      case 'tool/call': {
        ledger.stats.toolCalls += 1;
        const d = (data ?? {}) as unknown as ToolCallData;
        pendingTool = d.name;
        break;
      }

      case 'compaction/summary': {
        ledger.stats.compactions += 1;
        sawCompaction = true;
        break;
      }

      case 'request/header': {
        const d = (data ?? {}) as { header?: { config?: { provider?: string; model?: string } }; reason?: string };
        if (d.header?.config !== undefined) {
          ledger.modelConfigChanges.push({ reason: d.reason, provider: d.header.config.provider, model: d.header.config.model });
        }
        break;
      }

      default:
        break;
    }
  }

  // tool attribution rollup: a call with a tool/plugin counts toward that
  // plugin's column (attribution implies tool, not vice versa).
  for (const call of ledger.calls) {
    if (call.plugin !== undefined) {
      const pp = (ledger.perPlugin[call.plugin] ??= { calls: 0, total: 0 });
      pp.calls += 1;
      pp.total += call.cost.total;
    }
    if (call.tool !== undefined) {
      const pt = (ledger.perTool[call.tool] ??= { calls: 0, total: 0 });
      pt.calls += 1;
      pt.total += call.cost.total;
    }
  }

  if (ledger.reconciliation !== undefined) {
    const delta = ledger.reconciliation.selfReported! - ledger.reconciliation.recomputed;
    ledger.reconciliation.delta = delta;
    ledger.reconciliation.deltaRatio = delta / Math.max(ledger.reconciliation.recomputed, 1e-9);
  }

  return ledger;
}

/**
 * Extract a self-reported total from plugin:* records in the log. Honesty
 * first: ANY plugin:* record carrying a numeric total is accepted, and the
 * emitting record type is returned alongside so reports can name their
 * source. Last record wins (logs are append-only; later = newer).
 */
export function extractSelfReported(events: SessionEventLike[]): { total: number; source: string } | undefined {
  let found: { total: number; source: string } | undefined;
  for (const event of events) {
    if (typeof event.type === 'string' && event.type.startsWith('plugin:')) {
      const d = event.data as { total?: number } | undefined;
      if (d !== undefined && typeof d.total === 'number') {
        found = { total: d.total, source: event.type };
      }
    }
  }
  return found;
}
