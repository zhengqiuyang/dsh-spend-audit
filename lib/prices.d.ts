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
export declare function loadPrices(config?: PriceConfig, pricesDir?: string): Promise<LoadedPrices>;
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
export declare function priceUsage(usage: UsageBuckets, table: PriceTable, model: string): CostBreakdown;
