/**
 * The replay engine: fold parsed session events into a deterministic spend
 * ledger. Pure — no fs, no cordis. Attribution (plugin/tool) is injected by
 * the caller via a ToolAttribution map so the engine stays testable.
 */
import { priceUsage } from './prices.js';
export function emptyLedger() {
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
/**
 * Fold session events into a ledger. Known event handling:
 * - assistant/message: usage + model source → one CallEntry
 * - tool/call: pairs the nearest assistant/message by turn/step for tool attribution
 * - compaction/summary: flips the phase split
 * - request/header: model config snapshot history
 */
export function replay(events, options) {
    const ledger = emptyLedger();
    ledger.reconciliation = { recomputed: 0, ...(options.selfReported !== undefined ? { selfReported: options.selfReported.total, selfReportedBy: options.selfReported.source } : {}) };
    let sawCompaction = false;
    // tool/call events arrive AFTER their assistant/message in the log (the
    // message carries the tool-call block and the usage of the call that
    // produced it). Track pending calls per turn+step to bind tool attribution
    // onto the model call that requested them.
    let lastAssistant;
    // Tool attribution semantics: a tool/call marks a PENDING tool; the NEXT
    // assistant/message (the continuation that digests the tool result) carries
    // its cost — that continuation's input includes the tool result, so its
    // tokens are the tool's marginal cost.
    let pendingTool;
    for (const event of events) {
        ledger.stats.events += 1;
        const data = event.data;
        switch (event.type) {
            case 'assistant/message': {
                ledger.stats.assistantMessages += 1;
                const d = (data ?? {});
                const usage = d.usage;
                const source = d.message?.source ?? {};
                const model = source.model ?? '(unknown)';
                const provider = source.provider ?? '';
                if (usage === undefined) {
                    ledger.callsWithoutUsage += 1;
                    lastAssistant = undefined;
                    break;
                }
                const cost = priceUsage({
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cacheReadTokens: usage.cacheReadTokens,
                    cacheWriteTokens: usage.cacheWriteTokens,
                    reasoningTokens: usage.reasoningTokens,
                }, options.table, model);
                if (cost.unpriced && !ledger.unpricedModels.includes(model)) {
                    ledger.unpricedModels.push(model);
                }
                const entry = {
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
                if (provider !== '')
                    entry.provider = provider;
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
                ledger.reconciliation.recomputed += cost.total;
                lastAssistant = entry;
                pendingTool = undefined; // consumed by this continuation
                break;
            }
            case 'tool/call': {
                ledger.stats.toolCalls += 1;
                const d = (data ?? {});
                pendingTool = d.name;
                break;
            }
            case 'compaction/summary': {
                ledger.stats.compactions += 1;
                sawCompaction = true;
                break;
            }
            case 'request/header': {
                const d = (data ?? {});
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
        const delta = ledger.reconciliation.selfReported - ledger.reconciliation.recomputed;
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
export function extractSelfReported(events) {
    let found;
    for (const event of events) {
        if (typeof event.type === 'string' && event.type.startsWith('plugin:')) {
            const d = event.data;
            if (d !== undefined && typeof d.total === 'number') {
                found = { total: d.total, source: event.type };
            }
        }
    }
    return found;
}
//# sourceMappingURL=replay.js.map