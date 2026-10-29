import { strict as assert } from 'node:assert';
import { parseSessionLog } from '../lib/session-parse.js';
import { replay, extractSelfReported } from '../lib/replay.js';
import { loadPrices, priceUsage } from '../lib/prices.js';
import {
  SESSION_BASIC,
  SESSION_WITH_COMPACTION,
  SESSION_WITH_UNPRICED_MODEL,
  SESSION_WITH_METER_TOTAL,
  SESSION_NO_USAGE,
  SESSION_MALFORMED,
} from './fixtures.mjs';

let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };

const PRICES_DIR = 'C:/Users/Admin/.zcode/workspace/default/dsh-spend-audit/prices';

/* ---------- parser ---------- */

{
  const p = parseSessionLog(
    [
      '{"type":"session","version":4,"id":"s1"}',
      'not-json',
      '{"noType":true}',
      '',
      '{"type":"turn/start","data":{"turn":1}}',
    ].join('\n'),
  );
  assert.equal(p.eventCount, 1);
  assert.equal(p.headerCount, 1);
  assert.equal(p.sessionId, 's1');
  assert.equal(p.skipped.length, 2);
  assert.match(p.skipped[0].reason, /invalid JSON/);
  assert.match(p.skipped[1].reason, /not an event object/);
  ok('parser: header + events + skipped-with-reasons');
}

/* ---------- pricing ---------- */

{
  const { table, sources } = await loadPrices({}, PRICES_DIR);
  assert.ok(sources.includes('deepseek'));
  assert.ok(table['deepseek-chat'].input > 0);

  const c = priceUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, table, 'deepseek-chat');
  assert.ok(Math.abs(c.inputCost - 0.27) < 1e-9);
  assert.ok(Math.abs(c.outputCost - 1.1) < 1e-9);
  assert.ok(Math.abs(c.total - 1.37) < 1e-9);

  const c2 = priceUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }, table, 'deepseek-chat');
  assert.ok(Math.abs(c2.cacheReadCost - 0.07) < 1e-9);
  assert.ok(Math.abs(c2.cacheWriteCost - 0.27) < 1e-9);
  assert.ok(Math.abs(c2.total - 0.34) < 1e-9);

  const c3 = priceUsage({ inputTokens: 0, outputTokens: 100_000, reasoningTokens: 900_000 }, table, 'deepseek-chat');
  assert.ok(Math.abs(c3.outputCost - 1.1) < 1e-9);  // 1M output tokens incl. reasoning folded in

  const c4 = priceUsage({ inputTokens: 1e6, outputTokens: 1e6 }, table, 'mystery-model');
  assert.equal(c4.unpriced, true);
  assert.equal(c4.total, 0);
  ok('pricing: per-1M rates, cache tiers, reasoning folds to output, unpriced flag');
}

/* ---------- replay: basic ---------- */

{
  const p = parseSessionLog(SESSION_BASIC);
  const ledger = replay(p.lines.map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
    attribution: { bash: 'my-bash-plugin' },
  });
  assert.equal(ledger.calls.length, 2);
  assert.ok(ledger.total > 0);
  assert.equal(ledger.calls[0].tool, undefined);   // the call that REQUESTED bash: no result digested yet
  assert.equal(ledger.calls[1].tool, 'bash');      // the continuation that digested bash's result
  assert.equal(ledger.calls[1].plugin, 'my-bash-plugin');
  assert.equal(ledger.perPlugin['my-bash-plugin'].calls, 1);
  assert.equal(ledger.perTool.bash.calls, 1);
  assert.equal(ledger.perModel['deepseek-chat'].calls, 2);
  assert.equal(ledger.modelConfigChanges.length, 1);
  assert.equal(ledger.modelConfigChanges[0].model, 'deepseek-chat');
  assert.equal(ledger.phases.preCompaction.calls, 2);
  assert.equal(ledger.phases.postCompaction.calls, 0);
  ok('replay: calls, tool attribution, per-model, phases, headers');
}

/* ---------- replay: compaction phase split ---------- */

{
  const p = parseSessionLog(SESSION_WITH_COMPACTION);
  const ledger = replay(p.lines.map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
  });
  assert.equal(ledger.phases.preCompaction.calls, 1);
  assert.equal(ledger.phases.postCompaction.calls, 1);
  assert.equal(ledger.stats.compactions, 1);
  assert.ok(ledger.phases.postCompaction.total < ledger.phases.preCompaction.total);
  ok('replay: compaction splits phases');
}

/* ---------- replay: unpriced model ---------- */

{
  const p = parseSessionLog(SESSION_WITH_UNPRICED_MODEL);
  const ledger = replay(p.lines.map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
  });
  assert.deepEqual(ledger.unpricedModels, ['gpt-x']);
  assert.equal(ledger.calls.length, 2);
  assert.equal(ledger.calls[0].cost.unpriced, true);
  assert.equal(ledger.perModel['deepseek-chat'].calls, 1);
  ok('replay: unpriced model keeps tokens, cost unknown');
}

/* ---------- reconciliation ---------- */

{
  const p = parseSessionLog(SESSION_WITH_METER_TOTAL);
  const selfReported = extractSelfReported(p.lines.map((l) => l.event));
  assert.ok(selfReported !== undefined);
  const ledger = replay(p.lines.map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
    selfReported,
  });
  assert.ok(ledger.reconciliation.recomputed > 0);
  assert.ok(Math.abs(ledger.reconciliation.selfReported - 0.0015) < 1e-12);
  assert.equal(ledger.reconciliation.selfReportedBy, 'plugin:spend-meter');
  assert.ok(typeof ledger.reconciliation.delta === 'number');
  ok('reconciliation: self-reported vs recomputed with delta');
}

/* ---------- missing usage ---------- */

{
  const p = parseSessionLog(SESSION_NO_USAGE);
  const ledger = replay(p.lines.map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
  });
  assert.equal(ledger.calls.length, 0);
  assert.equal(ledger.callsWithoutUsage, 1);
  assert.equal(ledger.total, 0);
  ok('missing usage: excluded from ledger, counted, not zeroed');
}

/* ---------- malformed tolerance ---------- */

{
  const p = parseSessionLog(SESSION_MALFORMED.split('\n').join('\n'));
  assert.equal(p.skipped.length, 2);
  const ledger = replay(p.lines.filter((l) => l.event.type !== 'session').map((l) => l.event), {
    table: (await loadPrices({}, PRICES_DIR)).table,
  });
  assert.equal(ledger.calls.length, 1);
  ok('malformed lines: skipped with reasons, good events still replay');
}

console.log(`\n${passed} passed`);
