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

interface RegisteringContext {
  tools?: {
    register(definition: { name: string }): () => void;
  };
  inject(deps: string[], cb: (scoped: Context) => void): unknown;
}

/** Resolve a cordis context's plugin display name (fiber.runtime.name). */
function pluginNameOf(ctx: unknown): string | undefined {
  try {
    const fiber = (ctx as { fiber?: { runtime?: { name?: string } } }).fiber;
    const name = fiber?.runtime?.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

export function collectAttribution(ctx: Context): ToolAttribution {
  const attribution: ToolAttribution = {};
  // The tools service may already exist (this plugin loaded late) or may need
  // injection (loaded early). Handle both: try direct wrap first, then inject.
  const tryWrap = (scoped: unknown): boolean => {
    const regCtx = scoped as RegisteringContext;
    const tools = regCtx.tools;
    if (tools === undefined || typeof tools.register !== 'function') return false;
    if ((tools as { __spendAuditWrapped?: boolean }).__spendAuditWrapped) return true; // already wrapped
    const pluginName = pluginNameOf(scoped);
    const original = tools.register.bind(tools);
    const wrapped = (definition: { name: string }) => {
      if (pluginName !== undefined && typeof definition?.name === 'string') {
        attribution[definition.name] = pluginName;
      }
      return original(definition);
    };
    (wrapped as { __spendAuditWrapped?: boolean }).__spendAuditWrapped = true;
    tools.register = wrapped;
    return true;
  };

  const direct = ctx as unknown as RegisteringContext;
  if (!tryWrap(direct)) {
    (direct as { inject(deps: string[], cb: (scoped: Context) => void): unknown }).inject(['tools'], (scoped) => {
      tryWrap(scoped);
    });
  }
  return attribution;
}

/**
 * Header-tool attribution fallback: session header tool entries may carry a
 * `plugin` field (written by attribution projections). Names missing from the
 * runtime map are filled from here — later wins are ignored (runtime map is
 * authoritative; the header only fills gaps).
 */
export function mergeHeaderAttribution(attribution: ToolAttribution, headerTools: { name: string; plugin?: string }[] | undefined): void {
  if (headerTools === undefined) return;
  for (const t of headerTools) {
    if (typeof t?.name === 'string' && typeof t.plugin === 'string' && attribution[t.name] === undefined) {
      attribution[t.name] = t.plugin;
    }
  }
}
