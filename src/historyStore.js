// Persisted generation history. Stored in chrome.storage.local so it doesn't
// pollute settings.sync (which has small quotas) and stays per-device.
//
// Entry shape (lightweight; we drop transient fields like progress/errors):
//   {
//     id:          string,        // task id (used for dedup)
//     savedAt:     number,        // ms epoch
//     page:        { title, url, siteName },
//     styles:      [{ id, label, maxChars }],
//     results:     { [styleId]: string },
//     provider:    string,
//     model:       string,
//     language:    string,
//   }

const KEY = "sharecraft.history.v1";

// Cap on stored entries. chrome.storage.local quota is ~5MB so this is
// extremely conservative, but we want browsing the history page to stay snappy.
export const HISTORY_LIMIT = 100;

export async function getHistory() {
  const data = await chrome.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? data[KEY] : [];
}

export async function setHistory(list) {
  await chrome.storage.local.set({ [KEY]: list });
}

// Insert at the front, dedup by id, trim to HISTORY_LIMIT.
export async function addToHistory(entry) {
  if (!entry || !entry.id) return;
  const list = await getHistory();
  const filtered = list.filter((e) => e.id !== entry.id);
  filtered.unshift(entry);
  await setHistory(filtered.slice(0, HISTORY_LIMIT));
}

export async function removeFromHistory(id) {
  const list = await getHistory();
  await setHistory(list.filter((e) => e.id !== id));
}

export async function clearHistory() {
  await chrome.storage.local.remove(KEY);
}

// Build a history entry from an in-flight task object.
export function snapshotTaskForHistory(task) {
  if (!task) return null;
  const styles = task.settingsSnapshot?.styles || [];
  const results = {};
  for (const s of styles) {
    const v = task.results?.[s.id];
    if (typeof v === "string" && v.trim()) results[s.id] = v;
  }
  if (Object.keys(results).length === 0) return null;
  return {
    id: task.id,
    savedAt: Date.now(),
    page: {
      title: task.page?.title || "",
      url: task.page?.url || "",
      siteName: task.page?.siteName || "",
    },
    styles: styles.map((s) => ({
      id: s.id,
      label: s.label,
      maxChars: s.maxChars,
    })),
    results,
    provider: task.settingsSnapshot?.provider,
    model: task.settingsSnapshot?.model,
    language: task.settingsSnapshot?.language,
  };
}
