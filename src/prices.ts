/**
 * Price table: model -> per-1M-token USD rates. Deterministic; the token is
 * the fact, the price is a projection — swapping the table never changes the
 * token counts in the ledger.
 */
import { readFile } from 'node:fs/promises';

export interface ModelPrice {
  input: number;
  output: number;
  /** Optional: when the table omits a tier, that tier is priced at the base rate (input/output). */
  cacheRead?: number;
  cacheWrite?: number;
}

export type PriceTable = Record<string, ModelPrice>;

export interface PriceConfig {
  /** model -> price overrides/extends the built-in table. */
  prices?: PriceTable;
  /** Built-in tables to load by name (files under prices/). Default: deepseek. */
  builtins?: string[];
}

export interface LoadedPrices {
  table: PriceTable;
  sources: string[];
}

export async function loadPrices(config: PriceConfig = {}, pricesDir?: string): Promise<LoadedPrices> {
  const table: PriceTable = {};
  const sources: string[] = [];
  const builtins = config.builtins ?? ['deepseek'];
  for (const name of builtins) {
    const text = await readBuiltin(name, pricesDir);
    if (text === null) continue;
    try {
      const parsed = JSON.parse(text) as PriceTable;
      Object.assign(table, parsed);
      sources.push(name);
    } catch {
      // malformed builtin table — skip, config overrides still apply
    }
  }
  if (config.prices !== undefined) {
    Object.assign(table, config.prices);
    sources.push('config');
  }
  return { table, sources };
}

async function readBuiltin(name: string, pricesDir?: string): Promise<string | null> {
  const candidates = pricesDir !== undefined
    ? [joinPath(pricesDir, `${name}.json`)]
    : [
        joinPath('prices', `${name}.json`),
        joinPath('..', 'prices', `${name}.json`),
      ];
  for (const p of candidates) {
    try {
      return await readFile(p, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

function joinPath(...parts: string[]): string {
  return parts.join('/');
}

export interface UsageBuckets {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  /** Sum of all present buckets, USD. */
  total: number;
  /** True when the model has no table entry — token buckets stay, cost is unknown. */
  unpriced: boolean;
}

/**
 * Price one usage record. DeepSeek bills reasoning tokens at the output rate
 * and folds them into output_tokens, so reasoningTokens (when reported
 * separately by the adapter) are added to the output bucket here.
 */
export function priceUsage(usage: UsageBuckets, table: PriceTable, model: string): CostBreakdown {
  const price = table[model];
  if (price === undefined) {
    return { inputCost: 0, outputCost: 0, total: 0, unpriced: true };
  }
  const perM = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;
  const inputCost = perM(usage.inputTokens, price.input);
  const outputBase = usage.outputTokens + (usage.reasoningTokens ?? 0);
  const outputCost = perM(outputBase, price.output);
  const out: CostBreakdown = { inputCost, outputCost, total: inputCost + outputCost, unpriced: false };
  if (usage.cacheReadTokens !== undefined && price.cacheRead !== undefined) {
    out.cacheReadCost = perM(usage.cacheReadTokens, price.cacheRead);
    out.total += out.cacheReadCost;
  }
  if (usage.cacheWriteTokens !== undefined && price.cacheWrite !== undefined) {
    out.cacheWriteCost = perM(usage.cacheWriteTokens, price.cacheWrite);
    out.total += out.cacheWriteCost;
  }
  return out;
}
