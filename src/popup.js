import { getSettings } from "./storage.js";
import { normalizeStyles } from "./prompts.js";

const SELECTION_KEY = "sharecraft.styleSelection.v1";
const ONBOARDING_KEY = "sharecraft.onboardingDismissed.v1";
const TOTAL_ONBOARDING_STEPS = 4;

const els = {
  pageTitle: document.getElementById("page-title"),
  pageUrl: document.getElementById("page-url"),
  generateBtn: document.getElementById("generate-btn"),
  regenerateBtn: document.getElementById("regenerate-btn"),
  cancelBtn: document.getElementById("cancel-btn"),
  ackBtn: document.getElementById("ack-btn"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  emptyConfig: document.getElementById("empty-config"),
  pageInfo: document.getElementById("page-info"),
  controls: document.querySelector(".controls"),
  errorDetail: document.getElementById("error-detail"),
  errorDetailBody: document.getElementById("error-detail-body"),
  copyErrorBtn: document.getElementById("copy-error-btn"),
  activeConfig: document.getElementById("active-config"),
  activeConfigText: document.getElementById("active-config-text"),
  activeConfigEdit: document.getElementById("active-config-edit"),
  picker: document.getElementById("style-picker"),
  pickerList: document.getElementById("style-picker-list"),
  pickerAllBtn: document.getElementById("picker-all"),
  pickerNoneBtn: document.getElementById("picker-none"),
};

let currentPage = null;
let currentTask = null;
let availableStyles = []; // user's saved styles from settings
let selectedStyleIds = new Set(); // ids currently checked in the picker
let renderedStyles = [];

// ---------- UI helpers ----------

function showStatus(message, kind = "info") {
  els.status.hidden = false;
  els.status.textContent = message;
  els.status.classList.remove("error", "info");
  els.status.classList.add(kind);
}

function hideStatus() {
  els.status.hidden = true;
  els.status.textContent = "";
}

function clearErrorDetail() {
  els.errorDetail.hidden = true;
  els.errorDetailBody.textContent = "";
}

function showErrorDetail(text) {
  els.errorDetail.hidden = false;
  els.errorDetailBody.textContent = text;
}

function formatErrorOne(e) {
  return [
    `[${e.label || e.style || "error"}]`,
    e.url ? `Request : ${e.url}` : "",
    e.status != null ? `HTTP    : ${e.status}` : "",
    `Message : ${e.message || "(no message)"}`,
    e.body ? `\nResponse body:\n${e.body}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function setControlsForState(state) {
  switch (state) {
    case "running":
      els.generateBtn.disabled = true;
      els.generateBtn.querySelector(".btn-label").textContent = "生成中…";
      els.regenerateBtn.disabled = true;
      els.regenerateBtn.hidden = true;
      els.cancelBtn.hidden = false;
      els.cancelBtn.disabled = false;
      els.cancelBtn.textContent = "终止";
      els.ackBtn.hidden = true;
      els.picker.hidden = true;
      break;
    case "done":
      els.generateBtn.disabled = true;
      els.generateBtn.querySelector(".btn-label").textContent = "生成推荐语";
      els.regenerateBtn.disabled = true;
      els.regenerateBtn.hidden = true;
      els.cancelBtn.hidden = true;
      els.ackBtn.hidden = false;
      els.ackBtn.disabled = false;
      els.ackBtn.textContent = "完成";
      els.picker.hidden = true;
      break;
    case "error":
      els.generateBtn.disabled = true;
      els.generateBtn.querySelector(".btn-label").textContent = "生成推荐语";
      els.regenerateBtn.disabled = true;
      els.regenerateBtn.hidden = true;
      els.cancelBtn.hidden = true;
      els.ackBtn.hidden = false;
      els.ackBtn.disabled = false;
      els.ackBtn.textContent = "确认并清除";
      els.picker.hidden = true;
      break;
    case "cancelled":
      els.generateBtn.disabled = true;
      els.generateBtn.querySelector(".btn-label").textContent = "生成推荐语";
      els.regenerateBtn.disabled = true;
      els.regenerateBtn.hidden = true;
      els.cancelBtn.hidden = true;
      els.ackBtn.hidden = false;
      els.ackBtn.disabled = false;
      els.ackBtn.textContent = "确认";
      els.picker.hidden = true;
      break;
    case "idle":
    default: {
      const hasStyles = availableStyles.length > 0;
      els.generateBtn.disabled = !hasStyles || selectedStyleIds.size === 0;
      els.generateBtn.querySelector(".btn-label").textContent = "生成推荐语";
      els.regenerateBtn.hidden = true;
      els.cancelBtn.hidden = true;
      els.ackBtn.hidden = true;
      els.picker.hidden = !hasStyles;
    }
  }
}

// ---------- selection persistence ----------

async function loadSelection() {
  const data = await chrome.storage.local.get(SELECTION_KEY);
  return Array.isArray(data[SELECTION_KEY]) ? data[SELECTION_KEY] : null;
}

async function saveSelection() {
  await chrome.storage.local.set({
    [SELECTION_KEY]: Array.from(selectedStyleIds),
  });
}

// ---------- picker ----------

function renderPicker() {
  els.pickerList.innerHTML = "";
  if (availableStyles.length === 0) {
    return;
  }
  availableStyles.forEach((style) => {
    const id = `pick-${style.id}`;
    const wrap = document.createElement("label");
    wrap.className = "style-chip";
    wrap.htmlFor = id;
    if (selectedStyleIds.has(style.id)) wrap.classList.add("checked");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.checked = selectedStyleIds.has(style.id);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) selectedStyleIds.add(style.id);
      else selectedStyleIds.delete(style.id);
      wrap.classList.toggle("checked", checkbox.checked);
      await saveSelection();
      // Refresh generate button enabled-state when count changes.
      if (!currentTask) setControlsForState("idle");
    });

    const text = document.createElement("span");
    text.className = "style-chip-label";
    text.textContent = style.label;

    wrap.append(checkbox, text);
    els.pickerList.appendChild(wrap);
  });
}

els.pickerAllBtn.addEventListener("click", async () => {
  selectedStyleIds = new Set(availableStyles.map((s) => s.id));
  await saveSelection();
  renderPicker();
  if (!currentTask) setControlsForState("idle");
});
els.pickerNoneBtn.addEventListener("click", async () => {
  selectedStyleIds = new Set();
  await saveSelection();
  renderPicker();
  if (!currentTask) setControlsForState("idle");
});

// ---------- cards ----------

function renderCards(styles) {
  const ids = styles.map((s) => s.id).join("|");
  const currentIds = renderedStyles.map((s) => s.id).join("|");
  if (ids === currentIds) return;

  els.results.innerHTML = "";
  renderedStyles = styles;

  styles.forEach((style) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.style = style.id;

    const header = document.createElement("div");
    header.className = "card-header";

    const label = document.createElement("span");
    label.className = "card-label";
    label.textContent = style.label;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.dataset.target = style.id;
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", () => copyRecommendation(style.id));

    header.append(label, copyBtn);

    const text = document.createElement("p");
    text.className = "card-text";
    text.dataset.text = style.id;

    card.append(header, text);
    els.results.appendChild(card);
  });
}

function renderTaskCards(task) {
  if (!task) {
    els.results.hidden = true;
    return;
  }
  els.results.hidden = false;
  const styles = task.settingsSnapshot?.styles || [];
  renderCards(styles);

  styles.forEach((style) => {
    const card = els.results.querySelector(
      `.card[data-style="${cssEscape(style.id)}"]`
    );
    const text = els.results.querySelector(
      `[data-text="${cssEscape(style.id)}"]`
    );
    if (!card || !text) return;
    const progress = task.progress?.[style.id] || "running";
    const value = task.results?.[style.id] || "";

    card.classList.remove("running", "empty", "done-card", "cancelled-card");
    if (progress === "running") {
      card.classList.add("running");
      text.textContent = "";
    } else if (progress === "error") {
      card.classList.add("empty");
      text.textContent = "";
    } else if (progress === "cancelled") {
      card.classList.add("cancelled-card");
      text.textContent = value || "";
    } else {
      card.classList.add("done-card");
      text.textContent = value;
    }
  });
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function renderTask(task) {
  currentTask = task;

  if (!task) {
    setControlsForState("idle");
    hideStatus();
    clearErrorDetail();
    els.results.hidden = true;
    return;
  }

  const taskUrl = task.page?.url || "";
  if (currentPage && taskUrl && taskUrl !== currentPage.url) {
    showStatus(
      `当前任务对应的是「${task.page.title || taskUrl}」，与当前网页不同。`,
      "info"
    );
  } else {
    hideStatus();
  }

  if (task.status === "running") {
    const styles = task.settingsSnapshot?.styles || [];
    const total = styles.length;
    const done = styles.filter((s) => task.progress?.[s.id] === "done").length;
    const failed = styles.filter((s) => task.progress?.[s.id] === "error")
      .length;
    showStatus(
      `生成中… ${done}/${total} 已完成${failed ? `，${failed} 条失败` : ""}（关掉窗口也会继续）`,
      "info"
    );
    renderTaskCards(task);
    setControlsForState("running");
    clearErrorDetail();
    return;
  }

  // Done / Error / Cancelled
  renderTaskCards(task);

  if (task.status === "cancelled") {
    const styles = task.settingsSnapshot?.styles || [];
    const done = styles.filter((s) => task.progress?.[s.id] === "done").length;
    if (done > 0) {
      showStatus(
        `已终止生成（保留了 ${done} 条已完成的结果）`,
        "info"
      );
    } else {
      showStatus("已终止生成", "info");
    }
    clearErrorDetail();
    setControlsForState("cancelled");
    return;
  }

  if (task.errors?.length) {
    const styles = task.settingsSnapshot?.styles || [];
    const partialOk = styles.some((s) => task.results?.[s.id]);
    if (partialOk) {
      showStatus(
        `${task.errors.length} 条生成失败，已展示其余的（点下方查看详情）`,
        "error"
      );
    } else {
      showStatus("全部生成失败（点下方查看详情）", "error");
    }
    showErrorDetail(task.errors.map(formatErrorOne).join("\n\n———\n\n"));
  } else {
    clearErrorDetail();
  }

  setControlsForState(task.status === "done" ? "done" : "error");
}

// ---------- task client ----------

async function fetchTask() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getTask" });
    return res?.task || null;
  } catch (_) {
    return null;
  }
}

async function startTask({ force = false } = {}) {
  if (selectedStyleIds.size === 0) {
    showStatus("请先勾选要生成的模板。", "error");
    return;
  }
  if (!currentPage) {
    try {
      currentPage = await readActiveTabContent();
      els.pageTitle.textContent = currentPage.title || "(无标题)";
      els.pageUrl.textContent = currentPage.url;
    } catch (err) {
      showStatus(err.message || String(err), "error");
      return;
    }
  }

  setControlsForState("running");
  showStatus("正在派发任务…", "info");

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "startTask",
      page: currentPage,
      force,
      selectedStyleIds: Array.from(selectedStyleIds),
    });
  } catch (err) {
    showStatus(`派发失败：${err.message || err}`, "error");
    setControlsForState("idle");
    return;
  }

  if (!res?.ok) {
    if (res?.reason === "busy") {
      renderTask(res.task);
      return;
    }
    const errMsg = res?.error?.message || "派发任务失败";
    showStatus(errMsg, "error");
    if (res?.error) showErrorDetail(formatErrorOne(res.error));
    setControlsForState("idle");
    return;
  }

  renderTask(res.task);
}

async function cancelCurrentTask() {
  if (!currentTask || currentTask.status !== "running") return;

  // Optimistically render the cancelled state right now so the click feels
  // instant. The SW will mirror this to storage; storage onChanged will then
  // confirm. If the SW round-trip fails we'll surface that as an error.
  const optimistic = {
    ...currentTask,
    status: "cancelled",
    cancelled: true,
    finishedAt: Date.now(),
    progress: Object.fromEntries(
      Object.entries(currentTask.progress || {}).map(([k, v]) => [
        k,
        v === "running" ? "cancelled" : v,
      ])
    ),
  };
  renderTask(optimistic);

  try {
    const res = await chrome.runtime.sendMessage({
      type: "cancelTask",
      taskId: currentTask.id,
    });
    if (!res?.ok && res?.reason !== "not-running") {
      showStatus(`终止失败：${res?.error?.message || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`终止失败：${err.message || err}`, "error");
  }
}

async function acknowledgeTask() {
  if (!currentTask) return;
  els.ackBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "acknowledgeTask",
      taskId: currentTask.id,
    });
    if (!res?.ok) {
      if (res?.reason === "still-running") {
        showStatus("任务仍在进行，无法确认完成。", "error");
        return;
      }
      showStatus("确认失败，请重试。", "error");
      return;
    }
    currentTask = null;
    renderTask(null);
  } finally {
    els.ackBtn.disabled = false;
  }
}

// ---------- page extraction ----------

async function readActiveTabContent() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab || !tab.id) throw new Error("无法获取当前标签页");

  const url = tab.url || "";
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  ) {
    throw new Error("当前页面不支持抓取（浏览器内部页面）");
  }

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/extractor.js"],
  });
  if (!result) throw new Error("无法读取页面内容");
  return result;
}

// ---------- copy ----------

async function copyRecommendation(styleId) {
  if (!currentTask) return;
  const text = (currentTask.results?.[styleId] || "").trim();
  if (!text) return;
  const url = currentTask.page?.url || "";
  const combined = url ? `${text}\n${url}` : text;
  try {
    await navigator.clipboard.writeText(combined);
    flashCopied(styleId);
  } catch (err) {
    showStatus(`复制失败：${err.message || err}`, "error");
  }
}

function flashCopied(styleId) {
  const btn = els.results.querySelector(
    `.copy-btn[data-target="${cssEscape(styleId)}"]`
  );
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = "已复制";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("copied");
  }, 1200);
}

// ---------- live updates from storage ----------

function subscribeToTaskChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes["sharecraft.task.v1"];
    if (!change) return;
    renderTask(change.newValue || null);
  });
}

// ---------- bootstrap ----------

function renderConfigMissing() {
  els.emptyConfig.hidden = false;
  els.pageInfo.hidden = true;
  els.controls.hidden = true;
  els.activeConfig.hidden = true;
  els.picker.hidden = true;
}

// ---------- onboarding ----------

const onboardingEls = {
  root: document.getElementById("onboarding"),
  steps: () => document.querySelectorAll(".onboarding-step"),
  dots: () => document.querySelectorAll(".onboarding-progress .dot"),
  prev: document.getElementById("onboarding-prev"),
  next: document.getElementById("onboarding-next"),
  skip: document.getElementById("onboarding-skip"),
};

let onboardingStep = 0;

async function shouldShowOnboarding() {
  const data = await chrome.storage.local.get(ONBOARDING_KEY);
  return !data[ONBOARDING_KEY];
}

function showOnboardingStep(idx) {
  onboardingStep = Math.max(0, Math.min(TOTAL_ONBOARDING_STEPS - 1, idx));
  onboardingEls.steps().forEach((el) => {
    el.hidden = Number(el.dataset.step) !== onboardingStep;
  });
  onboardingEls.dots().forEach((dot, i) => {
    dot.classList.toggle("active", i === onboardingStep);
  });
  onboardingEls.prev.hidden = onboardingStep === 0;
  onboardingEls.next.textContent =
    onboardingStep === TOTAL_ONBOARDING_STEPS - 1 ? "开始使用" : "下一步";
}

async function dismissOnboarding() {
  onboardingEls.root.hidden = true;
  await chrome.storage.local.set({ [ONBOARDING_KEY]: true });
}

function bindOnboardingEvents() {
  onboardingEls.next.addEventListener("click", async () => {
    if (onboardingStep < TOTAL_ONBOARDING_STEPS - 1) {
      showOnboardingStep(onboardingStep + 1);
    } else {
      await dismissOnboarding();
    }
  });
  onboardingEls.prev.addEventListener("click", () => {
    showOnboardingStep(onboardingStep - 1);
  });
  onboardingEls.skip.addEventListener("click", dismissOnboarding);
}

function showOnboarding() {
  onboardingEls.root.hidden = false;
  showOnboardingStep(0);
}

// ---------- bindEvents / init ----------

function bindEvents() {
  els.generateBtn.addEventListener("click", () => startTask());
  els.regenerateBtn.addEventListener("click", () => startTask({ force: true }));
  els.cancelBtn.addEventListener("click", cancelCurrentTask);
  els.ackBtn.addEventListener("click", acknowledgeTask);

  document
    .getElementById("open-options")
    .addEventListener("click", () => chrome.runtime.openOptionsPage());
  document
    .getElementById("goto-options")
    .addEventListener("click", () => chrome.runtime.openOptionsPage());

  document
    .getElementById("open-history")
    .addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("src/history.html"),
      });
    });

  els.copyErrorBtn.addEventListener("click", async () => {
    const text = els.errorDetailBody.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const original = els.copyErrorBtn.textContent;
      els.copyErrorBtn.textContent = "已复制";
      setTimeout(() => {
        els.copyErrorBtn.textContent = original;
      }, 1200);
    } catch (_) {}
  });

  els.activeConfigEdit.addEventListener("click", () =>
    chrome.runtime.openOptionsPage()
  );
}

async function init() {
  bindEvents();
  bindOnboardingEvents();
  subscribeToTaskChanges();

  if (await shouldShowOnboarding()) {
    showOnboarding();
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    renderConfigMissing();
    return;
  }

  // Show which endpoint is in use.
  try {
    const { DEFAULT_BASE_URLS } = await import("./llm.js");
    const base =
      (settings.baseUrl || "").trim() ||
      DEFAULT_BASE_URLS[settings.provider] ||
      DEFAULT_BASE_URLS.openai;
    let host = base;
    try {
      host = new URL(base).host;
    } catch (_) {}
    els.activeConfig.hidden = false;
    els.activeConfigText.textContent = `${settings.provider} · ${host} · ${settings.model || "(default)"}`;
  } catch (_) {}

  // Available styles + restore previous selection (default = all).
  availableStyles = normalizeStyles(settings.styles);
  if (availableStyles.length === 0) {
    showStatus(
      "还没有任何分享模板。请到设置页新增或恢复默认模板。",
      "error"
    );
    els.generateBtn.disabled = true;
    els.picker.hidden = true;
    return;
  }

  const saved = await loadSelection();
  const allIds = new Set(availableStyles.map((s) => s.id));
  if (saved) {
    // Drop ids that no longer exist in settings.
    selectedStyleIds = new Set(saved.filter((id) => allIds.has(id)));
    if (selectedStyleIds.size === 0) selectedStyleIds = new Set(allIds);
  } else {
    selectedStyleIds = new Set(allIds);
  }
  renderPicker();

  // Read current page info.
  try {
    currentPage = await readActiveTabContent();
    els.pageTitle.textContent = currentPage.title || "(无标题)";
    els.pageUrl.textContent = currentPage.url;
  } catch (err) {
    els.pageTitle.textContent = "无法读取当前页面";
    els.pageUrl.textContent = "";
    showStatus(err.message || String(err), "error");
    els.generateBtn.disabled = true;
  }

  // Hydrate from persisted task state.
  const task = await fetchTask();
  if (task) {
    renderTask(task);
  } else {
    setControlsForState("idle");
  }
}

init();
