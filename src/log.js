// Lightweight diagnostic logger.
//
// Two destinations:
//   1. console (visible in the SW DevTools / popup DevTools)
//   2. a persistent ring buffer in chrome.storage.local (survives SW restarts
//      and can be opened in src/logs.html)
//
// Writes are serialized through a single promise chain to keep the buffer
// consistent — same pattern as patchTask in task.js.

const LOG_KEY = "sharecraft.log.v1";
const MAX_ENTRIES = 600;

let writeQueue = Promise.resolve();

function fmtConsole(scope, msg) {
  return `[ShareCraft][${scope}] ${msg}`;
}

// Strip obviously-sensitive values from a payload so we don't write API keys
// to storage. We only redact known field names; we don't try to scan strings.
function redact(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/(api[-_ ]?key|authorization|secret|token)/i.test(k)) {
      out[k] = "[redacted]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export function log(level, scope, msg, data) {
  const entry = {
    ts: Date.now(),
    level,
    scope,
    msg,
    data: data === undefined ? null : redact(data),
  };

  const consoleFn = console[level] || console.log;
  if (data !== undefined) {
    consoleFn(fmtConsole(scope, msg), data);
  } else {
    consoleFn(fmtConsole(scope, msg));
  }

  writeQueue = writeQueue
    .then(() => persist(entry))
    .catch(() => {}); // never let storage errors break the chain
}

async function persist(entry) {
  const data = await chrome.storage.local.get(LOG_KEY);
  const cur = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  cur.push(entry);
  if (cur.length > MAX_ENTRIES) {
    cur.splice(0, cur.length - MAX_ENTRIES);
  }
  await chrome.storage.local.set({ [LOG_KEY]: cur });
}

export async function getLogs() {
  const data = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
}

export async function clearLogs() {
  await chrome.storage.local.remove(LOG_KEY);
}

export const logger = {
  debug: (scope, msg, data) => log("debug", scope, msg, data),
  info: (scope, msg, data) => log("info", scope, msg, data),
  warn: (scope, msg, data) => log("warn", scope, msg, data),
  error: (scope, msg, data) => log("error", scope, msg, data),
};
