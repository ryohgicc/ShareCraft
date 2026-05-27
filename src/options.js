import { getSettings, saveSettings, DEFAULT_SETTINGS } from "./storage.js";
import { DEFAULT_MODELS, DEFAULT_BASE_URLS, testConnection } from "./llm.js";
import {
  DEFAULT_STYLES,
  NEW_STYLE_TEMPLATE,
  MIN_STYLE_CHARS,
  MAX_STYLE_CHARS,
  buildSystemPromptForStyle,
  generateStyleId,
  normalizeStyles,
} from "./prompts.js";

const form = document.getElementById("settings-form");
const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const baseUrlEl = document.getElementById("baseUrl");
const languageEl = document.getElementById("language");
const saveStatus = document.getElementById("save-status");
const keyHint = document.getElementById("key-hint");
const baseUrlHint = document.getElementById("baseurl-hint");
const testBtn = document.getElementById("test-btn");
const testDetail = document.getElementById("test-detail");
const testDetailTitle = document.getElementById("test-detail-title");
const testDetailBody = document.getElementById("test-detail-body");
const copyErrorBtn = document.getElementById("copy-error");
const stylesListEl = document.getElementById("styles-list");
const addStyleBtn = document.getElementById("add-style-btn");
const resetStylesBtn = document.getElementById("reset-styles-btn");
const resetConfirmEl = document.getElementById("reset-confirm");
const resetConfirmYesBtn = document.getElementById("reset-confirm-yes");
const resetConfirmNoBtn = document.getElementById("reset-confirm-no");

const PROVIDER_HINTS = {
  openai:
    'OpenAI Key 通常以 "sk-" 开头，在 platform.openai.com → API keys 创建。',
  anthropic:
    'Anthropic Key 通常以 "sk-ant-" 开头，在 console.anthropic.com → API Keys 创建。',
};

const BASEURL_HINTS = {
  openai:
    "默认 https://api.openai.com/v1。也可以填入兼容 OpenAI 接口的网关，比如 OpenRouter / DeepSeek / Moonshot / Azure 反代。",
  anthropic:
    "默认 https://api.anthropic.com/v1。如果走自建反代，填到 /v1 即可。",
};

// --- Working copy of styles ---
// We keep an in-memory list while the user edits. Saving normalizes & writes to
// chrome.storage.sync. "Restore defaults" replaces this list.
let workingStyles = [];

function renderHint() {
  keyHint.textContent = PROVIDER_HINTS[providerEl.value] || "";
  baseUrlHint.textContent = BASEURL_HINTS[providerEl.value] || "";
}

// ----- styles UI -----

function renderStyles() {
  stylesListEl.innerHTML = "";

  if (workingStyles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "styles-empty";
    empty.textContent = "还没有任何模板，点下方「新增模板」或「恢复默认模板」开始。";
    stylesListEl.appendChild(empty);
    return;
  }

  workingStyles.forEach((style, idx) => {
    stylesListEl.appendChild(renderStyleCard(style, idx));
  });
}

function renderStyleCard(style, idx) {
  const card = document.createElement("div");
  card.className = "style-card";
  card.dataset.styleId = style.id;

  // Header: label input + delete button.
  const head = document.createElement("div");
  head.className = "style-card-head";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "style-card-label";
  labelInput.value = style.label;
  labelInput.maxLength = 40;
  labelInput.placeholder = "模板名称（如：朋友安利）";
  labelInput.addEventListener("input", () => {
    workingStyles[idx].label = labelInput.value;
    renderDirty();
  });

  const headActions = document.createElement("div");
  headActions.className = "style-card-head-actions";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "link-btn";
  previewBtn.textContent = "查看完整提示词";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "link-btn danger";
  deleteBtn.textContent = "删除";
  deleteBtn.addEventListener("click", () => {
    if (!confirm(`确定删除模板「${workingStyles[idx].label}」？`)) return;
    workingStyles.splice(idx, 1);
    renderStyles();
    renderDirty();
  });

  headActions.append(previewBtn, deleteBtn);
  head.append(labelInput, headActions);

  // Char limit row.
  const limitRow = document.createElement("div");
  limitRow.className = "style-card-limit";
  const limitLabel = document.createElement("label");
  limitLabel.textContent = "字符上限";
  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.min = String(MIN_STYLE_CHARS);
  limitInput.max = String(MAX_STYLE_CHARS);
  limitInput.step = "10";
  limitInput.value = String(style.maxChars);
  limitInput.addEventListener("input", () => {
    const n = Number(limitInput.value);
    if (Number.isFinite(n)) {
      workingStyles[idx].maxChars = n;
      renderDirty();
      if (!preview.hidden) {
        preview.textContent = computePreview(workingStyles[idx]);
      }
    }
  });
  const limitSuffix = document.createElement("span");
  limitSuffix.className = "style-card-limit-suffix";
  limitSuffix.textContent = `字符（${MIN_STYLE_CHARS}-${MAX_STYLE_CHARS}，模型会尽量写到 80%-100%）`;
  limitRow.append(limitLabel, limitInput, limitSuffix);

  // Prompt textarea.
  const textarea = document.createElement("textarea");
  textarea.className = "style-card-prompt";
  textarea.rows = 8;
  textarea.spellcheck = false;
  textarea.value = style.prompt;
  textarea.placeholder = "这条模板的 prompt 内容…";
  textarea.addEventListener("input", () => {
    workingStyles[idx].prompt = textarea.value;
    renderDirty();
    if (!preview.hidden) {
      preview.textContent = computePreview(workingStyles[idx]);
    }
  });

  const preview = document.createElement("pre");
  preview.className = "style-card-preview";
  preview.hidden = true;

  previewBtn.addEventListener("click", () => {
    if (preview.hidden) {
      preview.textContent = computePreview(workingStyles[idx]);
      preview.hidden = false;
      previewBtn.textContent = "收起完整提示词";
    } else {
      preview.hidden = true;
      previewBtn.textContent = "查看完整提示词";
    }
  });

  card.append(head, limitRow, textarea, preview);
  return card;
}

function computePreview(style) {
  return buildSystemPromptForStyle(languageEl.value, style);
}

addStyleBtn.addEventListener("click", () => {
  workingStyles.push({
    id: generateStyleId(),
    label: `自定义模板 ${workingStyles.length + 1}`,
    maxChars: 200,
    prompt: NEW_STYLE_TEMPLATE,
  });
  renderStyles();
  renderDirty();
  // Scroll to & focus the new card's label input.
  const cards = stylesListEl.querySelectorAll(".style-card");
  const last = cards[cards.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: "smooth", block: "center" });
    last.querySelector(".style-card-label")?.focus();
  }
});

resetStylesBtn.addEventListener("click", () => {
  resetConfirmEl.hidden = false;
  resetStylesBtn.hidden = true;
});
resetConfirmNoBtn.addEventListener("click", () => {
  resetConfirmEl.hidden = true;
  resetStylesBtn.hidden = false;
});
resetConfirmYesBtn.addEventListener("click", () => {
  workingStyles = DEFAULT_STYLES.map((s) => ({ ...s }));
  renderStyles();
  renderDirty();
  resetConfirmEl.hidden = true;
  resetStylesBtn.hidden = false;
});

// ----- save / dirty / status -----

function flashSaved(message, isError = false) {
  saveStatus.hidden = false;
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", isError);
  if (!isError) {
    setTimeout(() => {
      saveStatus.hidden = true;
    }, 1800);
  }
}

function setStatus(message, kind = "ok") {
  saveStatus.hidden = false;
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", kind === "error");
}

function clearTestDetail() {
  testDetail.hidden = true;
  testDetail.classList.remove("error", "ok");
  testDetailBody.textContent = "";
  copyErrorBtn.hidden = true;
}

function showTestDetail({ kind, title, body }) {
  testDetail.hidden = false;
  testDetail.classList.remove("error", "ok");
  testDetail.classList.add(kind);
  testDetailTitle.textContent = title;
  testDetailBody.textContent = body;
  copyErrorBtn.hidden = kind !== "error";
}

function formatErrorReport({ provider, model, baseUrl, url, error }) {
  const lines = [
    `Provider : ${provider || "(unset)"}`,
    `Model    : ${model || "(unset)"}`,
    `Base URL : ${baseUrl || "(default)"}`,
  ];
  if (url) lines.push(`Request  : ${url}`);
  if (error?.status != null) lines.push(`HTTP     : ${error.status}`);
  lines.push("");
  lines.push(`Message  : ${error?.message || "(no message)"}`);
  if (error?.body) {
    lines.push("");
    lines.push("Response body:");
    lines.push(error.body);
  }
  return lines.join("\n");
}

async function load() {
  const settings = await getSettings();
  providerEl.value = settings.provider || DEFAULT_SETTINGS.provider;
  apiKeyEl.value = settings.apiKey || "";
  modelEl.value = settings.model || DEFAULT_MODELS[providerEl.value];
  baseUrlEl.value = settings.baseUrl || DEFAULT_BASE_URLS[providerEl.value];
  languageEl.value = settings.language || DEFAULT_SETTINGS.language;
  workingStyles = normalizeStyles(settings.styles).map((s) => ({ ...s }));
  renderStyles();
  renderHint();
  snapshotForm();
  renderDirty();
}

let savedSnapshot = "";

function currentFormSnapshot() {
  return JSON.stringify({
    provider: providerEl.value,
    apiKey: apiKeyEl.value,
    model: modelEl.value.trim(),
    baseUrl: baseUrlEl.value.trim(),
    language: languageEl.value,
    styles: workingStyles,
  });
}

function snapshotForm() {
  savedSnapshot = currentFormSnapshot();
}

function isDirty() {
  return currentFormSnapshot() !== savedSnapshot;
}

function renderDirty() {
  document.body.classList.toggle("is-dirty", isDirty());
}

[providerEl, apiKeyEl, modelEl, baseUrlEl, languageEl].forEach((el) => {
  el.addEventListener("input", renderDirty);
  el.addEventListener("change", renderDirty);
});

providerEl.addEventListener("change", () => {
  renderHint();
  const previousModelDefaults = Object.values(DEFAULT_MODELS);
  if (!modelEl.value || previousModelDefaults.includes(modelEl.value)) {
    modelEl.value = DEFAULT_MODELS[providerEl.value];
  }
  const previousBaseDefaults = Object.values(DEFAULT_BASE_URLS);
  if (!baseUrlEl.value || previousBaseDefaults.includes(baseUrlEl.value)) {
    baseUrlEl.value = DEFAULT_BASE_URLS[providerEl.value];
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();
  const model = modelEl.value.trim() || DEFAULT_MODELS[provider];
  const baseUrl = baseUrlEl.value.trim() || DEFAULT_BASE_URLS[provider];
  const language = languageEl.value;

  if (!apiKey) {
    flashSaved("请填写 API Key。", true);
    return;
  }

  try {
    await saveSettings({
      provider,
      apiKey,
      model,
      baseUrl,
      language,
      styles: workingStyles,
    });
    // Re-load so any normalization (de-duped ids, clamped numbers) shows up.
    await load();
    flashSaved("已保存。");
  } catch (err) {
    flashSaved(`保存失败：${err.message || err}`, true);
  }
});

testBtn.addEventListener("click", async () => {
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();
  const model = modelEl.value.trim() || DEFAULT_MODELS[provider];
  const baseUrl = baseUrlEl.value.trim() || DEFAULT_BASE_URLS[provider];

  clearTestDetail();
  if (!apiKey) {
    setStatus("请先填写 API Key。", "error");
    return;
  }

  const originalLabel = testBtn.textContent;
  testBtn.disabled = true;
  testBtn.textContent = "测试中…";
  setStatus("正在连接…");

  try {
    const result = await testConnection({ provider, apiKey, model, baseUrl });
    const usedModel = result.model || model;
    const usedBase = result.baseUrl || baseUrl;
    const usedUrl = result.url || "";

    let saveNote = "";
    if (isDirty()) {
      try {
        await saveSettings({
          provider,
          apiKey,
          model,
          baseUrl,
          language: languageEl.value,
          styles: workingStyles,
        });
        await load();
        saveNote = "（已自动保存）";
      } catch (saveErr) {
        saveNote = `（自动保存失败：${saveErr.message || saveErr}）`;
      }
    }

    setStatus(`连接成功，可以用模型 ${usedModel}。${saveNote}`);
    showTestDetail({
      kind: "ok",
      title: "测试成功",
      body: [
        `Provider : ${provider}`,
        `Model    : ${usedModel}`,
        `Base URL : ${usedBase}`,
        usedUrl ? `Request  : ${usedUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (err) {
    setStatus(`连接失败：${err.message || err}`, "error");
    showTestDetail({
      kind: "error",
      title: "测试失败 · 完整错误",
      body: formatErrorReport({
        provider,
        model,
        baseUrl,
        url: err?.url,
        error: err,
      }),
    });
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = originalLabel;
  }
});

copyErrorBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(testDetailBody.textContent);
    const original = copyErrorBtn.textContent;
    copyErrorBtn.textContent = "已复制";
    setTimeout(() => {
      copyErrorBtn.textContent = original;
    }, 1200);
  } catch (err) {
    setStatus(`复制失败：${err.message || err}`, "error");
  }
});

load();
