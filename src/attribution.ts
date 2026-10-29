/**
 * Tool→plugin attribution, built at runtime: wraps ctx.tools.register so
 * every registered tool name is mapped to the registering plugin's display
 * name (the dsh-context ownerOf approach — reference implementation of the
 * only reliable runtime attribution path; the tools API itself does not
 * record the registering plugin).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolAttribution } from './replay.js';

interface RegisteringContext {
  /** cordis fiber display name — the plugin's own name. */
  pluginName?: string;
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
  let count = 0;
  (ctx as unknown as RegisteringContext).inject(['tools'], (scoped) => {
    const regCtx = scoped as unknown as RegisteringContext & { pluginName?: string };
    const tools = regCtx.tools;
    if (tools === undefined || typeof tools.register !== 'function') return;
    const pluginName = pluginNameOf(scoped) ?? regCtx.pluginName;
    const original = tools.register.bind(tools);
    tools.register = (definition: { name: string }) => {
      if (pluginName !== undefined && typeof definition?.name === 'string') {
        attribution[definition.name] = pluginName;
        count += 1;
      }
      return original(definition);
    };
  });
  void count;
  return attribution;
}
