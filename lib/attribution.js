/** Resolve a cordis context's plugin display name (fiber.runtime.name). */
function pluginNameOf(ctx) {
    try {
        const fiber = ctx.fiber;
        const name = fiber?.runtime?.name;
        return typeof name === 'string' && name.length > 0 ? name : undefined;
    }
    catch {
        return undefined;
    }
}
export function collectAttribution(ctx) {
    const attribution = {};
    // The tools service may already exist (this plugin loaded late) or may need
    // injection (loaded early). Handle both: try direct wrap first, then inject.
    const tryWrap = (scoped) => {
        const regCtx = scoped;
        const tools = regCtx.tools;
        if (tools === undefined || typeof tools.register !== 'function')
            return false;
        if (tools.__spendAuditWrapped)
            return true; // already wrapped
        const pluginName = pluginNameOf(scoped);
        const original = tools.register.bind(tools);
        const wrapped = (definition) => {
            if (pluginName !== undefined && typeof definition?.name === 'string') {
                attribution[definition.name] = pluginName;
            }
            return original(definition);
        };
        wrapped.__spendAuditWrapped = true;
        tools.register = wrapped;
        return true;
    };
    const direct = ctx;
    if (!tryWrap(direct)) {
        direct.inject(['tools'], (scoped) => {
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
export function mergeHeaderAttribution(attribution, headerTools) {
    if (headerTools === undefined)
        return;
    for (const t of headerTools) {
        if (typeof t?.name === 'string' && typeof t.plugin === 'string' && attribution[t.name] === undefined) {
            attribution[t.name] = t.plugin;
        }
    }
}
//# sourceMappingURL=attribution.js.map