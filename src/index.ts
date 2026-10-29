/**
 * dsh-spend-audit — independent cost audit for DeepSeek Harness.
 *
 * Runtime half: wraps tools.register for tool→plugin attribution, then
 * exposes GET /spend-audit/api/report over the newest session log. The
 * replay engine itself is pure (src/replay.ts) and also drives the CLI.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { parseSessionLog } from './session-parse.js';
import { replay, type SpendLedger } from './replay.js';
import { loadPrices, type PriceConfig } from './prices.js';

export const name = 'dsh-spend-audit';
export const inject = ['tools'];

export interface Config {
  /** Root directory containing session logs (DSH session-persistence root). */
  sessionsRoot: string;
  /** Price configuration (builtins + overrides). */
  priceConfig: PriceConfig;
  /** Where the built-in price tables live (defaults to this package's prices/). */
  pricesDir: string;
  /** Warn when |selfReported − recomputed| / recomputed exceeds this ratio. */
  reconcileTolerance: number;
}

export const Config: Schema<Config> = Schema.object({
  sessionsRoot: Schema.string().default('./sessions').description('session log root to audit'),
  priceConfig: Schema.object({}).hidden().default({}),
  pricesDir: Schema.string().default('').description('override price table directory'),
  reconcileTolerance: Schema.number().default(0.01).description('reconciliation delta ratio that counts as a mismatch'),
});

function newestSessionFile(root: string): { path: string; mtimeMs: number } | null {
  return null; // replaced below (kept for typing clarity)
}

async function findNewestSessionLog(root: string): Promise<string | null> {
  let best: string | null = null;
  let bestM = -1;
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 4) await walk(full, depth + 1);
      } else if (/^session(?:\.v\d+)?\.jsonl$/.test(e.name)) {
        try {
          const st = await (await import('node:fs/promises')).stat(full);
          if (st.mtimeMs > bestM) { bestM = st.mtimeMs; best = full; }
        } catch { /* skip */ }
      }
    }
  };
  await walk(root, 0);
  return best;
}

export function apply(ctx: Context, config: Config): void {
  // 1. attribution: wrap tools.register so tool→plugin lands in our map
  const attribution = (await0(ctx)) as unknown as Record<string, string>;

  const webServer = (ctx as unknown as {
    inject(deps: string[], cb: (scoped: Context) => void): unknown;
  });

  ctx.inject(['webServer'], (scoped) => {
    const server = (scoped as unknown as {
      webServer?: { register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }): unknown };
    }).webServer;
    if (server === undefined) return;   // headless: attribution still collected above
    void server.register({
      kind: 'exact',
      path: '/spend-audit/api/report',
      handler: async (_req: unknown, res: unknown) => {
        const r = res as { setHeader(k: string, v: string): void; end(body: string): void };
        const logPath = await findNewestSessionLog(resolveRoot(config.sessionsRoot));
        if (logPath === null) {
          r.setHeader('content-type', 'application/json');
          r.end(JSON.stringify({ error: 'no session log found', sessionsRoot: resolveRoot(config.sessionsRoot) }));
          return;
        }
        const text = await readFile(logPath, 'utf8');
        const parsed = parseSessionLog(text);
        const { table } = await loadPrices(config.priceConfig, config.pricesDir === '' ? undefined : config.pricesDir);
        const ledger: SpendLedger = replay(parsed.lines.map((l) => l.event), {
          table,
          attribution,
        });
        r.setHeader('content-type', 'application/json');
        r.end(JSON.stringify({
          session: { id: parsed.sessionId, logPath, events: parsed.eventCount, skipped: parsed.skipped.length },
          ledger,
        }));
      },
    });
  });

  console.log('[dsh-spend-audit] auditor armed; attribution entries:', Object.keys(attribution).length);
}

function resolveRoot(root: string): string {
  if (root === './sessions' || root === 'sessions') {
    // DSH default persistence root lives under the dsh home; relative default
    // keeps working for source checkouts running from the repo root.
    return join(process.env.DSH_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh'), 'sessions');
  }
  return root;
}

// attribution collector (imported lazily to keep the shell thin)
import { collectAttribution } from './attribution.js';
function await0(ctx: Context): Record<string, string> {
  try {
    return collectAttribution(ctx);
  } catch {
    return {};
  }
}
