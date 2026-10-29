// Extract SESSION_BASIC from fixtures.mjs into a real .jsonl file for CLI smoke testing.
// The fixture array holds single-quoted JS string literals; evaluating the array
// expression via Function gives the exact runtime strings without manual unescaping.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const src = await readFile('test/fixtures.mjs', 'utf8');
const m = src.match(/export const SESSION_BASIC = \[([\s\S]*?)\]\.join/);
const expr = `[
${m[1]}
]`;
const strs = (0, eval)(expr);
await mkdir('test/data', { recursive: true });
await writeFile('test/data/demo-session.jsonl', strs.join('\n'));
let ok = 0;
for (const l of strs.join('\n').split('\n')) {
  try { const o = JSON.parse(l); if (o.type) ok++; } catch { /* count only */ }
}
console.log('written', strs.length, 'lines,', ok, 'valid events');
