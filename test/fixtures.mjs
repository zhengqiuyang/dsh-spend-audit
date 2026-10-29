// Session-log fixtures modeled line-for-line on DSH's real snapshots
// (snapshots/session/... session.v4.jsonl structure, real field shapes).
export const SESSION_BASIC = [
  '{"type":"session","version":4,"id":"sess-demo-1","createdAt":1791315715000,"cwd":"/tmp/proj","isSeeded":false,"delegationDepth":0}',
  '{"type":"turn/start","data":{"turn":1}}',
  '{"type":"request/header","data":{"header":{"config":{"provider":"deepseek-official","model":"deepseek-chat"},"tools":["bash","read"]},"reason":"initial"}}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"tool-call","id":"call-1","name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}],"source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m1"},"usage":{"inputTokens":1500,"outputTokens":42,"cacheReadTokens":0,"reasoningTokens":28},"stream":[]},"surfaceOp":"append"}',
  '{"type":"tool/call","data":{"turn":1,"step":1,"callId":"call-1","name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}}',
  '{"type":"tool/result","data":{"turn":1,"step":1,"message":{"role":"tool","source":{"kind":"tool","callId":"call-1"},"toolCallId":"call-1","content":[{"type":"text","text":"file.txt"}]}}}',
  '{"type":"assistant/message","data":{"turn":1,"step":2,"message":{"role":"assistant","content":[{"type":"text","text":"done"}],"source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m2"},"usage":{"inputTokens":27,"outputTokens":9,"cacheReadTokens":1664},"stream":[]},"surfaceOp":"append"}',
  '{"type":"turn/end","data":{"turn":1}}',
].join('\n');

export const SESSION_WITH_COMPACTION = [
  '{"type":"session","version":4,"id":"sess-demo-2","createdAt":1791315716000,"cwd":"/tmp/proj","isSeeded":false,"delegationDepth":0}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m1"},"usage":{"inputTokens":1000,"outputTokens":100},"stream":[]},"surfaceOp":"append"}',
  '{"type":"compaction/summary","data":{"turn":1,"summary":"…"}}',
  '{"type":"assistant/message","data":{"turn":2,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m2"},"usage":{"inputTokens":400,"outputTokens":50},"stream":[]},"surfaceOp":"append"}',
].join('\n');

export const SESSION_WITH_UNPRICED_MODEL = [
  '{"type":"session","version":4,"id":"sess-demo-3","createdAt":1791315717000,"cwd":"/tmp/proj","isSeeded":false,"delegationDepth":0}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"openai","model":"gpt-x"},"id":"m1"},"usage":{"inputTokens":100,"outputTokens":20},"stream":[]},"surfaceOp":"append"}',
  '{"type":"assistant/message","data":{"turn":1,"step":2,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m2"},"usage":{"inputTokens":100,"outputTokens":20},"stream":[]},"surfaceOp":"append"}',
].join('\n');

export const SESSION_WITH_METER_TOTAL = [
  '{"type":"session","version":4,"id":"sess-demo-4","createdAt":1791315718000,"cwd":"/tmp/proj","isSeeded":false,"delegationDepth":0}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m1"},"usage":{"inputTokens":1000,"outputTokens":100},"stream":[]},"surfaceOp":"append"}',
  '{"type":"plugin:spend-meter","data":{"kind":"spend-meter-total","total":0.0015}}',
].join('\n');

export const SESSION_NO_USAGE = [
  '{"type":"session","version":4,"id":"sess-demo-5","createdAt":1791315719000,"cwd":"/tmp/proj","isSeeded":false,"delegationDepth":0}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m1"},"stream":[]},"surfaceOp":"append"}',
].join('\n');

export const SESSION_MALFORMED = [
  '{"type":"session","version":4,"id":"sess-demo-6"}',
  'not-json-at-all',
  '{"noType": true}',
  '',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","source":{"kind":"model","provider":"deepseek-official","model":"deepseek-chat"},"id":"m1"},"usage":{"inputTokens":500,"outputTokens":50},"stream":[]}}',
].join('\n');
