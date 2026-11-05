/**
 * dsh-spend-audit — independent cost audit for DeepSeek Harness.
 *
 * Runtime half: wraps tools.register for tool→plugin attribution (armed at
 * plugin activation, before other plugins register when patch order puts this
 * bundle first), and exposes GET /spend-audit/api/report over the newest
 * session log (plaintext or zstd). The replay engine is pure (src/replay.ts)
 * and also drives the CLI.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { parseSessionLog } from './session-parse.js';
import { replay, extractSelfReported } from './replay.js';
import { loadPrices } from './prices.js';
import { loadSessionLog } from './load-log.js';
import { collectAttribution } from './attribution.js';
export const name = 'dsh-spend-audit';
export const inject = ['tools'];
export const Config = Schema.object({
    sessionsRoot: Schema.string().default('').description('session log root (default: $DSH_HOME/sessions)'),
    priceConfig: Schema.object({}).hidden().default({}),
    pricesDir: Schema.string().default('').description('override price table directory'),
    reconcileTolerance: Schema.number().default(0.01).description('reconciliation delta ratio that counts as a mismatch'),
});
function defaultSessionsRoot() {
    const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh');
    return join(home, 'sessions');
}
/** Newest session log (any generation, plaintext or zstd) under root. */
async function findNewestSessionLog(root) {
    let best = null;
    let bestM = -1;
    const walk = async (dir, depth) => {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                if (depth < 4)
                    await walk(full, depth + 1);
            }
            else if (/^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(e.name)) {
                try {
                    const st = await stat(full);
                    if (st.mtimeMs > bestM) {
                        bestM = st.mtimeMs;
                        best = full;
                    }
                }
                catch { /* skip */ }
            }
        }
    };
    await walk(root, 0);
    return best;
}
export function apply(ctx, config) {
    const root = config.sessionsRoot === '' ? defaultSessionsRoot() : config.sessionsRoot;
    // 1. attribution: wrap tools.register as early as possible. Plugins whose
    // patch order lands BEFORE this bundle were already registered — their
    // tools fall back to header-plugin fields at replay time (see replay docs).
    const attribution = collectAttribution(ctx);
    // 2. web route (web compositions only; attribution above works headless too)
    ctx.inject(['webServer'], (scoped) => {
        const server = scoped.webServer;
        if (server === undefined)
            return;
        void server.register({
            kind: 'exact',
            path: '/spend-audit/api/report',
            handler: async (_req, res) => {
                const r = res;
                const logPath = await findNewestSessionLog(root);
                if (logPath === null) {
                    r.setHeader('content-type', 'application/json');
                    r.end(JSON.stringify({ error: 'no session log found', sessionsRoot: root }));
                    return;
                }
                try {
                    const { text, compression } = await loadSessionLog(logPath);
                    const parsed = parseSessionLog(text);
                    const events = parsed.lines.map((l) => l.event);
                    const { table } = await loadPrices(config.priceConfig, config.pricesDir === '' ? undefined : config.pricesDir);
                    const selfReportedRec = extractSelfReported(events);
                    const ledger = replay(events, { table, attribution, selfReported: selfReportedRec });
                    r.setHeader('content-type', 'application/json');
                    r.end(JSON.stringify({
                        session: {
                            id: parsed.sessionId,
                            logPath,
                            compression,
                            events: parsed.eventCount,
                            skipped: parsed.skipped.length,
                        },
                        ledger,
                    }));
                }
                catch (e) {
                    r.setHeader('content-type', 'application/json');
                    r.end(JSON.stringify({ error: `audit failed: ${e.message}` }));
                }
            },
        });
    });
    console.log(`[dsh-spend-audit] auditor armed (root: ${root}); attribution entries: ${Object.keys(attribution).length}`);
}
//# sourceMappingURL=index.js.map