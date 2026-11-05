import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type PriceConfig } from './prices.js';
export declare const name = "dsh-spend-audit";
export declare const inject: string[];
export interface Config {
    /** Root directory containing session logs. Default: $DSH_HOME/sessions. */
    sessionsRoot: string;
    /** Price configuration (builtins + overrides). */
    priceConfig: PriceConfig;
    /** Where the built-in price tables live (defaults to this package's prices/). */
    pricesDir: string;
    /** Reconciliation delta ratio that counts as a mismatch (default 0.01). */
    reconcileTolerance: number;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
