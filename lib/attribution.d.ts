/**
 * Tool→plugin attribution, built at runtime: wraps ctx.tools.register so
 * every registered tool name is mapped to the registering plugin's display
 * name (the dsh-context ownerOf approach — reference implementation of the
 * only reliable runtime attribution path; the tools API itself does not
 * record the registering plugin).
 *
 * Timing: this must be armed BEFORE other plugins register (bundle patch
 * order decides). Tools registered before this plugin activates cannot be
 * wrapped; at replay time those fall back to the `plugin` field that
 * dsh-context-style projections write into the session header.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolAttribution } from './replay.js';
export declare function collectAttribution(ctx: Context): ToolAttribution;
/**
 * Header-tool attribution fallback: session header tool entries may carry a
 * `plugin` field (written by attribution projections). Names missing from the
 * runtime map are filled from here — later wins are ignored (runtime map is
 * authoritative; the header only fills gaps).
 */
export declare function mergeHeaderAttribution(attribution: ToolAttribution, headerTools: {
    name: string;
    plugin?: string;
}[] | undefined): void;
