# dsh-spend-audit

> **If this helps you, please give it a star** — it helps others find it. Thanks!

Independent cost audit for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).
It does not trust any self-reported cost meter: it **replays the session log deterministically**
into a spend ledger — per call, per tool, per plugin, per model, before/after compaction —
prices tokens from a declarative table, and reconciles the recomputed total against whatever
an in-process meter claims. Zero LLM calls in the audit path.

```
session log (source of truth)          price table (declarative)
  assistant/message.usage        ──►   deepseek.json (+ config overrides)
  tool/call ↔ tool/result                │
  request/header (model)                 ▼
  compaction/summary              ──►  replay() ──► SpendLedger
                                                 │
                          self-reported total ──► reconcile ──► delta ⚠
```

## What it answers

- "How much did this session cost — recomputed, not self-reported?"
- "Which tool or plugin burned the most?" (attribution: the continuation that digests a tool's
  result carries that tool's marginal cost)
- "Did the compaction actually save money?" (pre/post-compaction phase split)
- "Does the runtime meter's total match the log?" (reconciliation with delta and ratio)

## Usage

### CLI

```sh
dsh-spend-audit session.jsonl --prices prices
dsh-spend-audit session.jsonl --self-reported 0.0021 --json
```

Report is Markdown (or JSON with `--json`): totals, per-model / per-plugin / per-tool tables,
phase split, reconciliation verdict, and a per-call table.

### As a dsh plugin

```sh
dsh plugin --profile web add dsh-spend-audit
```

Exposes `GET /spend-audit/api/report` (audits the newest session log under the configured
`sessionsRoot`) and arms tool→plugin attribution by wrapping `tools.register` at load time.
Works in headless compositions too — attribution is collected regardless of a webServer.

## Design notes

- **The token is the fact; the price is a projection.** Ledgers record token buckets
  (uncached input / output / cacheRead / cacheWrite / reasoning); prices come from a
  declarative table (`prices/deepseek.json` + `config.prices` overrides) and can be
  re-applied without touching facts. DeepSeek bills reasoning tokens at the output rate
  and folds them into `output_tokens` — the pricer does the same fold.
- **Deterministic replay.** Same log + same table ⇒ same ledger, byte for byte. Modeled on
  the harness's own `deriveTurnTokenUsage` replay state machine.
- **Missing usage is unknown, not zero.** Calls whose adapter reported no usage are excluded
  and counted (`callsWithoutUsage`) — never silently folded into a fake total.
- **Unpriced models stay honest.** Tokens are recorded, cost is marked unknown, and the
  model name is listed — never invented.
- **Attribution semantics**: a `tool/call` marks a pending tool; the *next* `assistant/message`
  (the continuation digesting the tool result) carries its cost, because that continuation's
  input includes the result. The requesting call's own tokens stay unattributed.
- **Reconciliation tolerance** defaults to 1% delta ratio; exceed it and the report flags a
  mismatch. dsh-budget's frozen README admits reconciliation was never on its roadmap;
  dsh-cost-meter reconciles totals only and documents that its token columns can never
  balance against official bills. This plugin is the item-level auditor for that gap.

## Compatibility

- DSH 0.2.x (session log v4 JSONL; zstd-compressed generations: decompress with `zstd -d`
  or point at an uncompressed `session.jsonl`).
- Node ≥ 20.

## License

MIT
