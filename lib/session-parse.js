export function parseSessionLog(text) {
    const lines = [];
    const skipped = [];
    let sessionId;
    let headerCount = 0;
    let eventCount = 0;
    const rawLines = text.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i] ?? '';
        const trimmed = raw.trim();
        if (trimmed === '')
            continue;
        let event;
        try {
            event = JSON.parse(trimmed);
        }
        catch (e) {
            skipped.push({ line: i + 1, reason: `invalid JSON: ${e.message.slice(0, 60)}` });
            continue;
        }
        if (typeof event !== 'object' || event === null || typeof event.type !== 'string') {
            skipped.push({ line: i + 1, reason: 'not an event object' });
            continue;
        }
        if (event.type === 'session') {
            headerCount += 1;
            const id = event.id;
            if (typeof id === 'string')
                sessionId = id;
            lines.push({ raw: trimmed, event });
            continue;
        }
        eventCount += 1;
        lines.push({ raw: trimmed, event });
    }
    return { lines, skipped, sessionId, headerCount, eventCount };
}
//# sourceMappingURL=session-parse.js.map