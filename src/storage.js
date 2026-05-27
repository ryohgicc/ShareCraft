// Thin wrapper around chrome.storage.sync for settings.
import { DEFAULT_MODELS, DEFAULT_BASE_URLS } from "./llm.js";
import { DEFAULT_STYLES, normalizeStyles } from "./prompts.js";

const KEY = "sharecraft.settings.v1";

export const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  model: DEFAULT_MODELS.openai,
  baseUrl: DEFAULT_BASE_URLS.openai,
  language: "zh-CN",
  styles: DEFAULT_STYLES.map((s) => ({ ...s })),
};

export async function getSettings() {
  const data = await chrome.storage.sync.get(KEY);
  const raw = data[KEY] || {};
  const merged = { ...DEFAULT_SETTINGS, ...raw };

  // Migration from older shapes that used styleLimits / stylePrompts maps
  // keyed by style id. If a user upgraded mid-customization, we want to
  // preserve their tweaks.
  if (!Array.isArray(merged.styles)) {
    merged.styles = migrateLegacyStyles(raw);
  }
  merged.styles = normalizeStyles(merged.styles);

  // Auto-append any built-in styles that are missing from the user's list.
  // This handles the case where a new version adds a default template (like
  // "自定义润色") — existing users get it automatically without needing to
  // click "恢复默认". If the user explicitly deleted it later, it won't come
  // back because we only check on first upgrade (the id will be in the
  // "deletedBuiltins" set once we track that — for now, simple append).
  const existingIds = new Set(merged.styles.map((s) => s.id));
  for (const def of DEFAULT_STYLES) {
    if (!existingIds.has(def.id)) {
      merged.styles.push({ ...def });
    }
  }

  return merged;
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  if (partial.styles) {
    next.styles = normalizeStyles(partial.styles);
  }
  // Drop legacy fields so we don't keep migrating them every save.
  delete next.styleLimits;
  delete next.stylePrompts;
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

// One-time migration: take the old { styleLimits: {key: number},
// stylePrompts: {key: string} } and rebuild a styles array on top of
// DEFAULT_STYLES order/labels.
function migrateLegacyStyles(raw) {
  const oldLimits = raw?.styleLimits || {};
  const oldPrompts = raw?.stylePrompts || {};
  return DEFAULT_STYLES.map((d) => ({
    ...d,
    maxChars:
      typeof oldLimits[d.id] === "number" ? oldLimits[d.id] : d.maxChars,
    prompt:
      typeof oldPrompts[d.id] === "string" && oldPrompts[d.id].trim()
        ? oldPrompts[d.id]
        : d.prompt,
  }));
}
