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
  // 用户主动删除过的内置模板 id 列表。自动补全逻辑会跳过这些 id，
  // 避免用户删了之后每次保存又被自动加回来。
  // 「恢复默认模板」按钮会清空这个列表。
  deletedBuiltins: [],
};

export async function getSettings() {
  const data = await chrome.storage.sync.get(KEY);
  const raw = data[KEY] || {};
  const merged = { ...DEFAULT_SETTINGS, ...raw };

  // 老版本数据迁移：styleLimits / stylePrompts → styles 数组。
  if (!Array.isArray(merged.styles)) {
    merged.styles = migrateLegacyStyles(raw);
  }
  merged.styles = normalizeStyles(merged.styles);

  if (!Array.isArray(merged.deletedBuiltins)) {
    merged.deletedBuiltins = [];
  }

  // 自动补全缺失的内置模板，但**跳过用户主动删除过的**。
  // 这样老用户升级后能自动看到新增的内置模板（如自定义润色），
  // 但删除过的不会被强制找回。
  const existingIds = new Set(merged.styles.map((s) => s.id));
  const deletedSet = new Set(merged.deletedBuiltins);
  for (const def of DEFAULT_STYLES) {
    if (!existingIds.has(def.id) && !deletedSet.has(def.id)) {
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

    // 检测用户是否删除了内置模板，写入 deletedBuiltins。
    const newIds = new Set(next.styles.map((s) => s.id));
    const newlyDeleted = DEFAULT_STYLES
      .map((d) => d.id)
      .filter((id) => !newIds.has(id));
    next.deletedBuiltins = Array.from(
      new Set([...(current.deletedBuiltins || []), ...newlyDeleted])
    );
    // 同时：用户重新加回某个内置模板时，从 deletedBuiltins 里移除。
    next.deletedBuiltins = next.deletedBuiltins.filter(
      (id) => !newIds.has(id)
    );
  }
  if (Array.isArray(partial.deletedBuiltins)) {
    next.deletedBuiltins = partial.deletedBuiltins;
  }
  // 删掉老版本字段，避免每次保存都重复迁移。
  delete next.styleLimits;
  delete next.stylePrompts;
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

// 老版本迁移：把 { styleLimits: {key: number}, stylePrompts: {key: string} }
// 重建成 styles 数组（基于 DEFAULT_STYLES 的顺序和标签）。
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
