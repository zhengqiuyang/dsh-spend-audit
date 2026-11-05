/**
 * Price table: model -> per-1M-token USD rates. Deterministic; the token is
 * the fact, the price is a projection — swapping the table never changes the
 * token counts in the ledger.
 */
import { readFile } from 'node:fs/promises';
export async function loadPrices(config = {}, pricesDir) {
    const table = {};
    const sources = [];
    const builtins = config.builtins ?? ['deepseek'];
    for (const name of builtins) {
        const text = await readBuiltin(name, pricesDir);
        if (text === null)
            continue;
        try {
            const parsed = JSON.parse(text);
            Object.assign(table, parsed);
            sources.push(name);
        }
        catch {
            // malformed builtin table — skip, config overrides still apply
        }
    }
    if (config.prices !== undefined) {
        Object.assign(table, config.prices);
        sources.push('config');
    }
    return { table, sources };
}
async function readBuiltin(name, pricesDir) {
    const candidates = pricesDir !== undefined
        ? [joinPath(pricesDir, `${name}.json`)]
        : [
            joinPath('prices', `${name}.json`),
            joinPath('..', 'prices', `${name}.json`),
        ];
    for (const p of candidates) {
        try {
            return await readFile(p, 'utf8');
        }
        catch {
            // try next candidate
        }
    }
    return null;
}
function joinPath(...parts) {
    return parts.join('/');
}
/**
 * Price one usage record. DeepSeek bills reasoning tokens at the output rate
 * and folds them into output_tokens, so reasoningTokens (when reported
 * separately by the adapter) are added to the output bucket here.
 */
export function priceUsage(usage, table, model) {
    const price = table[model];
    if (price === undefined) {
        return { inputCost: 0, outputCost: 0, total: 0, unpriced: true };
    }
    const perM = (tokens, rate) => (tokens / 1_000_000) * rate;
    const inputCost = perM(usage.inputTokens, price.input);
    const outputBase = usage.outputTokens + (usage.reasoningTokens ?? 0);
    const outputCost = perM(outputBase, price.output);
    const out = { inputCost, outputCost, total: inputCost + outputCost, unpriced: false };
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
//# sourceMappingURL=prices.js.map