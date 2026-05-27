// Background service worker.
// Owns the long-running "generate recommendations" task. The popup is just a
// viewer that reads/writes task state in chrome.storage.local.

import {
  buildSystemPromptForStyle,
  buildUserPromptForStyle,
  normalizeStyles,
} from "./prompts.js";
import {
  DEFAULT_MODELS,
  LlmError,
  testConnection,
  callOpenAIStyle,
  callAnthropicStyle,
  normalizeBaseUrl,
} from "./llm.js";
import { getSettings } from "./storage.js";
import { getTask, setTask, patchTask } from "./task.js";
import { addToHistory, snapshotTaskForHistory } from "./historyStore.js";

// Map<taskId, AbortController> for the currently running task. Lives only in
// the SW's memory — if the SW is suspended/restarted the controller is gone,
// but storage's `cancelled` flag is the durable source of truth.
const taskControllers = new Map();

function serializeError(err) {
  if (!err) return { message: "未知错误（捕获到空错误对象）", name: "UnknownError" };
  if (typeof err === "string") return { message: err, name: "StringError" };
  return {
    message:
      err.message ||
      err.error?.message ||
      err.statusText ||
      (typeof err.toString === "function" ? err.toString() : "") ||
      "未知错误",
    status: err.status,
    body: err.body,
    url: err.url,
    name: err.name,
  };
}

async function startTask({ page, force = false, selectedStyleIds = null }) {
  const existing = await getTask();
  if (
    !force &&
    existing &&
    (existing.status === "running" ||
      existing.status === "done" ||
      existing.status === "error" ||
      existing.status === "cancelled")
  ) {
    return { ok: false, reason: "busy", task: existing };
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new LlmError("尚未配置 API Key，请先到设置页填写。");
  }

  const allStyles = normalizeStyles(settings.styles);
  if (allStyles.length === 0) {
    throw new LlmError("没有可用的分享模板，请到设置页新增或恢复默认模板。");
  }

  // Filter by user selection. If selectedStyleIds is null/undefined we run
  // all styles (backwards-compatible). Empty array means "user deselected
  // everything" — reject early so they don't get a confused empty task.
  let styles = allStyles;
  if (Array.isArray(selectedStyleIds)) {
    if (selectedStyleIds.length === 0) {
      throw new LlmError("请至少勾选一个模板再开始生成。");
    }
    const allowed = new Set(selectedStyleIds);
    styles = allStyles.filter((s) => allowed.has(s.id));
    if (styles.length === 0) {
      throw new LlmError("勾选的模板都已不存在，请重新选择。");
    }
  }

  const resolvedBase = normalizeBaseUrl(settings.baseUrl, settings.provider);
  const callOne =
    settings.provider === "anthropic" ? callAnthropicStyle : callOpenAIStyle;
  const lang = settings.language || "zh-CN";
  const styleIds = styles.map((s) => s.id);
  const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const initial = {
    id: taskId,
    status: "running",
    page,
    startedAt: Date.now(),
    finishedAt: null,
    cancelled: false,
    settingsSnapshot: {
      provider: settings.provider,
      model: settings.model || DEFAULT_MODELS[settings.provider],
      baseUrl: resolvedBase,
      language: lang,
      styles: styles.map((s) => ({
        id: s.id,
        label: s.label,
        maxChars: s.maxChars,
      })),
    },
    results: Object.fromEntries(styleIds.map((k) => [k, null])),
    progress: Object.fromEntries(styleIds.map((k) => [k, "running"])),
    errors: [],
  };
  await setTask(initial);

  const controller = new AbortController();
  taskControllers.set(taskId, controller);

  // Fire all style calls in parallel. Each one updates storage independently.
  const promises = styles.map(async (style) => {
    try {
      const text = await callOne({
        apiKey: settings.apiKey,
        model: settings.model,
        baseUrl: resolvedBase,
        systemPrompt: buildSystemPromptForStyle(lang, style),
        userPrompt: buildUserPromptForStyle(page, style),
        signal: controller.signal,
      });
      await patchTask((cur) => {
        if (!cur || cur.id !== taskId) return cur;
        // If the task was cancelled, drop results that came back after.
        if (cur.cancelled) {
          return {
            ...cur,
            progress: { ...cur.progress, [style.id]: "cancelled" },
          };
        }
        return {
          ...cur,
          results: { ...cur.results, [style.id]: text },
          progress: { ...cur.progress, [style.id]: "done" },
        };
      });
    } catch (err) {
      const isAbort =
        err?.name === "AbortedByUser" || err?.cause?.name === "AbortError";
      const serialized = serializeError(err);
      await patchTask((cur) => {
        if (!cur || cur.id !== taskId) return cur;
        if (isAbort) {
          // Don't add abort errors to the visible errors list — they were
          // requested by the user. Just mark this style cancelled.
          return {
            ...cur,
            progress: { ...cur.progress, [style.id]: "cancelled" },
          };
        }
        return {
          ...cur,
          progress: { ...cur.progress, [style.id]: "error" },
          errors: [
            ...cur.errors,
            { style: style.id, label: style.label, ...serialized },
          ],
        };
      });
    }
  });

  // When all settle, mark the task done/error. (For cancelled tasks the
  // status is set eagerly in cancelTask(); here we only finalize natural
  // completion, never overwrite a cancelled task.)
  Promise.allSettled(promises).then(async () => {
    taskControllers.delete(taskId);
    const finalized = await patchTask((cur) => {
      if (!cur || cur.id !== taskId) return cur;
      if (cur.cancelled || cur.status === "cancelled") return cur;
      const anySuccess = styleIds.some((k) => cur.results[k]);
      return {
        ...cur,
        status: anySuccess ? "done" : "error",
        finishedAt: Date.now(),
      };
    });
    // Save to history if we got at least one usable result.
    const snapshot = snapshotTaskForHistory(finalized);
    if (snapshot) await addToHistory(snapshot);
  });

  return { ok: true, task: initial };
}

async function cancelTask(taskId) {
  const cur = await getTask();
  if (!cur) return { ok: true };
  if (taskId && cur.id !== taskId) {
    return { ok: false, reason: "stale", task: cur };
  }
  if (cur.status !== "running") {
    return { ok: false, reason: "not-running", task: cur };
  }

  // Eagerly finalize the task to "cancelled" right now. Don't wait for the
  // in-flight fetches to actually unwind — that can take a moment, and the
  // user expects clicking "终止" to feel instant. Any results that arrive
  // late will be discarded by the per-style handler (which checks
  // cur.cancelled before writing results).
  const next = await patchTask((c) => {
    if (!c) return c;
    const styles = c.settingsSnapshot?.styles || [];
    const newProgress = { ...c.progress };
    for (const s of styles) {
      if (newProgress[s.id] === "running") {
        newProgress[s.id] = "cancelled";
      }
    }
    return {
      ...c,
      cancelled: true,
      progress: newProgress,
      status: "cancelled",
      finishedAt: Date.now(),
    };
  });

  // Abort any in-flight fetches owned by this SW instance. The fetches will
  // throw AbortedByUser, which the per-style handler ignores because the
  // task is already finalized as cancelled.
  const controller = taskControllers.get(cur.id);
  if (controller) controller.abort();

  // If we kept any partial results, persist them to history so the user can
  // come back to them later.
  const snapshot = snapshotTaskForHistory(next);
  if (snapshot) await addToHistory(snapshot);

  return { ok: true, task: next };
}

async function acknowledgeTask(taskId) {
  const cur = await getTask();
  if (!cur) return { ok: true };
  if (taskId && cur.id !== taskId) {
    return { ok: false, reason: "stale", task: cur };
  }
  if (cur.status === "running") {
    return { ok: false, reason: "still-running", task: cur };
  }
  await setTask(null);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "startTask") {
    (async () => {
      try {
        const out = await startTask({
          page: message.page,
          force: !!message.force,
          selectedStyleIds: message.selectedStyleIds ?? null,
        });
        sendResponse(out);
      } catch (err) {
        sendResponse({ ok: false, error: serializeError(err) });
      }
    })();
    return true;
  }

  if (message?.type === "getTask") {
    (async () => {
      const task = await getTask();
      sendResponse({ ok: true, task });
    })();
    return true;
  }

  if (message?.type === "cancelTask") {
    (async () => {
      try {
        const out = await cancelTask(message.taskId);
        sendResponse(out);
      } catch (err) {
        sendResponse({ ok: false, error: serializeError(err) });
      }
    })();
    return true;
  }

  if (message?.type === "acknowledgeTask") {
    (async () => {
      try {
        const out = await acknowledgeTask(message.taskId);
        sendResponse(out);
      } catch (err) {
        sendResponse({ ok: false, error: serializeError(err) });
      }
    })();
    return true;
  }

  if (message?.type === "testConnection") {
    (async () => {
      try {
        const result = await testConnection(message.payload || {});
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, error: serializeError(err) });
      }
    })();
    return true;
  }

  return false;
});
