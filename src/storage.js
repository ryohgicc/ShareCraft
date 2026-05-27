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
