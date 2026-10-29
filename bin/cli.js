#!/usr/bin/env node
/**
 * dsh-spend-audit CLI: replay a session log into a spend ledger and print a
 * Markdown report (or JSON with --json).
 *
 *   dsh-spend-audit <session.jsonl> [--prices <dir>] [--self-reported <usd>] [--json]
 */
import { readFile } from 'node:fs/promises';
import { parseSessionLog } from '../lib/session-parse.js';
import { replay, extractSelfReported } from '../lib/replay.js';
import { loadPrices } from '../lib/prices.js';

const args = process.argv.slice(2);
const positional = [];
let pricesDir;
let selfReported;
let json = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--prices') { pricesDir = args[++i]; }
  else if (a === '--self-reported') { selfReported = Number(args[++i]); }
  else if (a === '--json') { json = true; }
  else if (!a.startsWith('--')) positional.push(a);
}

const logPath = positional[0];
if (logPath === undefined) {
  console.error('usage: dsh-spend-audit <session.jsonl> [--prices <dir>] [--self-reported <usd>] [--json]');
  process.exit(1);
}

let text;
try {
  text = await readFile(logPath, 'utf8');
} catch (e) {
  console.error(`cannot read ${logPath}: ${e.message}`);
  process.exit(1);
}

// transparent zstd support when the CLI detects compressed generations
if (/\.zst$/i.test(logPath) && text.includes('\u28B5')) {
  console.error('this generation is zstd-compressed; decompress first (zstd -d) or point at session.jsonl');
  process.exit(1);
}

const parsed = parseSessionLog(text);
const events = parsed.lines.map((l) => l.event);
const self = selfReported ?? extractSelfReported(events);
const { table } = await loadPrices({}, pricesDir);
const ledger = replay(events, { table, selfReportedTotal: self });

const usd = (n) => `$${n.toFixed(4)}`;

if (json) {
  console.log(JSON.stringify({ session: { id: parsed.sessionId, logPath, events: parsed.eventCount, skipped: parsed.skipped.length }, ledger }, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`# Spend audit — session ${parsed.sessionId ?? '(unknown)'}`);
lines.push('');
lines.push(`- source: \`${logPath}\` (${parsed.eventCount} events, ${parsed.skipped.length} skipped)`);
lines.push(`- **recomputed total: ${usd(ledger.total)}** over ${ledger.calls.length} billed model call(s)`);
if (ledger.callsWithoutUsage > 0) lines.push(`- ${ledger.callsWithoutUsage} call(s) carried no usage bucket (excluded, not zeroed)`);
if (ledger.unpricedModels.length > 0) lines.push(`- ⚠ unpriced models (tokens counted, cost unknown): ${ledger.unpricedModels.join(', ')}`);
lines.push('');

lines.push('## By model');
lines.push('');
lines.push('| model | calls | total | tokens |');
lines.push('|---|---|---|---|');
for (const [m, v] of Object.entries(ledger.perModel).sort((a, b) => b[1].total - a[1].total)) {
  lines.push(`| ${m} | ${v.calls} | ${usd(v.total)} | ${v.tokens} |`);
}
lines.push('');

if (Object.keys(ledger.perPlugin).length > 0) {
  lines.push('## By plugin');
  lines.push('');
  lines.push('| plugin | calls | total |');
  lines.push('|---|---|---|');
  for (const [p, v] of Object.entries(ledger.perPlugin).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${p} | ${v.calls} | ${usd(v.total)} |`);
  }
  lines.push('');
}

if (Object.keys(ledger.perTool).length > 0) {
  lines.push('## By tool');
  lines.push('');
  lines.push('| tool | calls | total |');
  lines.push('|---|---|---|');
  for (const [t, v] of Object.entries(ledger.perTool).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${t} | ${v.calls} | ${usd(v.total)} |`);
  }
  lines.push('');
}

lines.push('## Phases');
lines.push('');
lines.push(`- before compaction: ${ledger.phases.preCompaction.calls} call(s), ${usd(ledger.phases.preCompaction.total)}`);
lines.push(`- after compaction: ${ledger.phases.postCompaction.calls} call(s), ${usd(ledger.phases.postCompaction.total)}`);
lines.push('');

if (ledger.reconciliation !== undefined && ledger.reconciliation.selfReported !== undefined) {
  const r = ledger.reconciliation;
  const flag = Math.abs(r.deltaRatio ?? 0) > 0.01 ? '⚠ **MISMATCH**' : '✅ within tolerance';
  lines.push('## Reconciliation');
  lines.push('');
  lines.push(`- self-reported: ${usd(r.selfReported)}`);
  lines.push(`- recomputed: ${usd(r.recomputed)}`);
  lines.push(`- delta: ${usd(r.delta ?? 0)} (${((r.deltaRatio ?? 0) * 100).toFixed(2)}%) — ${flag}`);
  lines.push('');
}

lines.push('## Per call');
lines.push('');
lines.push('| # | turn/step | tool | plugin | model | in | out | cached | total |');
lines.push('|---|---|---|---|---|---|---|---|---|');
ledger.calls.forEach((c, i) => {
  lines.push(`| ${i + 1} | ${c.turn ?? '?'}/${c.step ?? '?'} | ${c.tool ?? '—'} | ${c.plugin ?? '—'} | ${c.model} | ${c.usage.inputTokens + (c.usage.cacheReadTokens ?? 0)} | ${c.usage.outputTokens + (c.usage.reasoningTokens ?? 0)} | ${c.usage.cacheReadTokens ?? 0} | ${usd(c.cost.total)} |`);
});

console.log(lines.join('\n'));
