// Persisted task state shared between the popup and the service worker.
// The popup is just a view; the SW is the source of truth.
//
// Task lifecycle:
//   null → running → done | error | cancelled → (user clicks 完成) → null
//
// We store in chrome.storage.local so state survives:
//   - popup close/reopen
//   - service worker restart
//   - browser restart (within reason — stale tasks get cleaned up on load)

import { logger } from "./log.js";

const KEY = "sharecraft.task.v1";

// Task records older than this with status "running" are considered abandoned
// (the SW probably got killed mid-fetch). They're auto-promoted to "error" so
// the user can acknowledge and start a new one. Kept slightly above the
// fetch-level timeout (120s) so a slow-but-still-progressing fetch doesn't
// trip this prematurely.
export const STALE_RUNNING_MS = 3 * 60 * 1000;

export async function getTask() {
  const data = await chrome.storage.local.get(KEY);
  const task = data[KEY] || null;
  if (!task) return null;
  if (
    task.status === "running" &&
    Date.now() - (task.lastUpdatedAt || task.startedAt || 0) > STALE_RUNNING_MS
  ) {
    const recovered = {
      ...task,
      status: "error",
      error: {
        message:
          "上一次生成中断（后台服务被回收）。点击「完成」后可以重新生成。",
        name: "AbandonedTask",
      },
      finishedAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    logger.warn("task", "stale task auto-promoted to error", {
      id: task.id,
      ageMs: Date.now() - (task.lastUpdatedAt || task.startedAt || 0),
    });
    await chrome.storage.local.set({ [KEY]: recovered });
    return recovered;
  }
  return task;
}

export async function setTask(task) {
  if (!task) {
    await chrome.storage.local.remove(KEY);
    return null;
  }
  const stamped = { ...task, lastUpdatedAt: Date.now() };
  await chrome.storage.local.set({ [KEY]: stamped });
  return stamped;
}

export async function clearTask() {
  await chrome.storage.local.remove(KEY);
}

// Serialize all patchTask calls onto a single promise chain. Without this,
// concurrent style completions race read-modify-write on chrome.storage,
// and one writer's update silently clobbers the other.
let patchQueue = Promise.resolve();
let patchSeq = 0;

export function patchTask(updater) {
  const seq = ++patchSeq;
  const enqueuedAt = Date.now();

  const run = async () => {
    const startedAt = Date.now();
    const waitedMs = startedAt - enqueuedAt;
    const current = (await chrome.storage.local.get(KEY))[KEY] || null;
    const next = typeof updater === "function" ? updater(current) : updater;

    if (next === null || next === undefined) {
      await chrome.storage.local.remove(KEY);
      logger.debug("patchTask", `#${seq} cleared task`, {
        waitedMs,
        durMs: Date.now() - startedAt,
      });
      return null;
    }

    // Diff the keys that actually changed so we can spot lost-update bugs.
    const changedKeys = diffKeys(current, next);
    const result = await setTask(next);
    logger.debug("patchTask", `#${seq} applied`, {
      waitedMs,
      durMs: Date.now() - startedAt,
      taskId: next.id,
      status: next.status,
      cancelled: !!next.cancelled,
      changedKeys,
      progress: shortProgress(next),
    });
    return result;
  };

  const result = patchQueue.then(run, run);
  patchQueue = result.catch(() => {});
  return result;
}

function diffKeys(prev, next) {
  if (!prev) return Object.keys(next || {});
  const out = [];
  const all = new Set([...Object.keys(prev), ...Object.keys(next || {})]);
  for (const k of all) {
    if (k === "lastUpdatedAt") continue;
    if (JSON.stringify(prev[k]) !== JSON.stringify(next?.[k])) out.push(k);
  }
  return out;
}

function shortProgress(task) {
  const p = task?.progress;
  if (!p) return null;
  const counts = { running: 0, done: 0, error: 0, cancelled: 0 };
  for (const v of Object.values(p)) {
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}
