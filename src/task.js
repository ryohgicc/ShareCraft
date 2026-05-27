// Persisted task state shared between the popup and the service worker.
// The popup is just a view; the SW is the source of truth.
//
// Task lifecycle:
//   null → running → done | error | cancelled → (user acknowledges) → null
//
// We store in chrome.storage.local so state survives:
//   - popup close/reopen
//   - service worker restart
//   - browser restart (within reason — stale tasks get cleaned up on load)

const KEY = "sharecraft.task.v1";

// Task records older than this with status "running" are considered abandoned
// (the SW probably got killed mid-fetch). They're auto-promoted to "error" so
// the user can acknowledge and start a new one.
export const STALE_RUNNING_MS = 5 * 60 * 1000;

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
// and one writer's update silently clobbers the other (the symptom is a
// card stuck on "running" forever even though its fetch already finished).
let patchQueue = Promise.resolve();

export function patchTask(updater) {
  const run = async () => {
    const current = (await chrome.storage.local.get(KEY))[KEY] || null;
    const next = typeof updater === "function" ? updater(current) : updater;
    if (next === null || next === undefined) {
      await chrome.storage.local.remove(KEY);
      return null;
    }
    return setTask(next);
  };
  // Chain onto the queue; swallow errors in the chain itself so one failure
  // doesn't poison subsequent patches, but still surface the error to caller.
  const result = patchQueue.then(run, run);
  patchQueue = result.catch(() => {});
  return result;
}
