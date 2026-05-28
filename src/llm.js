// LLM client for OpenAI-compatible and Anthropic-compatible endpoints.
// Supports a configurable base URL so users can point at OpenAI proxies,
// Azure-style gateways, DeepSeek, Moonshot, OpenRouter, etc.
//
// 想改提示词、风格定义，去 src/prompts.js。
//
// 当前架构：每种风格走一次独立请求并发执行。这样总耗时 ≈ max(3 次)，
// 不再依赖模型一次输出 JSON。

import {
  SUPPORTED_LANGUAGES,
  buildSystemPromptForStyle,
  buildUserPromptForStyle,
} from "./prompts.js";

export { SUPPORTED_LANGUAGES };

// Forward-declarations of internals exported lower in the file. (See below.)

export const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

export const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

// Custom error type that preserves full error info for the UI to display.
export class LlmError extends Error {
  constructor(message, { status, body, url, cause } = {}) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.body = body;
    this.url = url;
    if (cause) this.cause = cause;
  }
}

function normalizeBaseUrl(url, provider) {
  const fallback = DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai;
  const raw = (url || "").trim() || fallback;
  return raw.replace(/\/+$/, "");
}

export { normalizeBaseUrl };

function buildUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith(path)) return base;
  return base + path;
}

async function fetchOrThrow(
  label,
  url,
  init,
  { timeoutMs = 120000, externalSignal } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Service workers in MV3 get suspended after ~30s of idle. setTimeout
  // does NOT keep the SW alive on its own, so a long-running fetch can
  // sit waiting forever for a slow gateway that never responds — the
  // timeout itself never fires because the SW is asleep.
  // We poke chrome.storage every 20s; storage access counts as activity
  // and keeps the SW alive while a fetch is in flight.
  const keepAlive = setInterval(() => {
    try {
      // Throwaway read; result is ignored.
      chrome.storage.local.get("__keepalive__").catch(() => {});
    } catch (_) {}
  }, 20000);

  // Wire an external signal (e.g. user-clicked "终止") so we can cancel
  // mid-flight without waiting for the timeout.
  let externalAborted = false;
  const onExternalAbort = () => {
    externalAborted = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      if (externalAborted) {
        const e = new LlmError(`${label} 已被用户终止`, { url, cause: err });
        e.name = "AbortedByUser";
        throw e;
      }
      throw new LlmError(
        `${label} 请求超时（${Math.round(timeoutMs / 1000)} 秒未响应）`,
        { url, cause: err }
      );
    }
    throw new LlmError(
      `${label} 网络请求失败：${err?.message || err}（可能是域名无法解析、DNS / 代理问题、或被浏览器拦截）`,
      { url, cause: err }
    );
  } finally {
    clearTimeout(timer);
    clearInterval(keepAlive);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new LlmError(
      `${label} 调用失败 (HTTP ${res.status} ${res.statusText || ""})`.trim(),
      { status: res.status, body: errText, url }
    );
  }
  return res;
}

// Strip fences, extra quotes, and accidental "Recommendation: " prefixes.
function cleanText(text) {
  if (!text) return "";
  let t = String(text).trim();
  t = t.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "");
  // If the model wraps the whole reply in matching quotes, drop them.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("“") && t.endsWith("”")) ||
    (t.startsWith("「") && t.endsWith("」"))
  ) {
    t = t.slice(1, -1).trim();
  }
  // Strip "Recommendation:" / "推荐语：" / "Output:" style preambles.
  t = t.replace(
    /^(recommendation|output|answer|推荐语|输出|结果)\s*[:：]\s*/i,
    ""
  );
  return t.trim();
}

export async function callOpenAIStyle({
  apiKey,
  model,
  baseUrl,
  systemPrompt,
  userPrompt,
  signal,
}) {
  const url = buildUrl(baseUrl, "/chat/completions");
  const res = await fetchOrThrow(
    "OpenAI",
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.openai,
        temperature: 0.9,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    { externalSignal: signal }
  );

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    throw new LlmError(`OpenAI 返回的不是合法 JSON：${err?.message || err}`, {
      url,
      body: rawText,
    });
  }
  if (data?.error) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || JSON.stringify(data.error);
    throw new LlmError(`OpenAI 接口返回错误：${msg}`, { url, body: rawText });
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new LlmError(
      "OpenAI 返回结构异常：找不到 choices[0].message.content（网关可能不兼容 OpenAI 协议）",
      { url, body: rawText }
    );
  }
  return cleanText(content);
}

export async function callAnthropicStyle({
  apiKey,
  model,
  baseUrl,
  systemPrompt,
  userPrompt,
  signal,
}) {
  const url = buildUrl(baseUrl, "/messages");
  const res = await fetchOrThrow(
    "Anthropic",
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS.anthropic,
        max_tokens: 1500,
        temperature: 0.9,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    },
    { externalSignal: signal }
  );

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    throw new LlmError(`Anthropic 返回的不是合法 JSON：${err?.message || err}`, {
      url,
      body: rawText,
    });
  }
  if (data?.error) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || JSON.stringify(data.error);
    throw new LlmError(`Anthropic 接口返回错误：${msg}`, {
      url,
      body: rawText,
    });
  }
  const content = (data?.content || [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (!content.trim()) {
    throw new LlmError("Anthropic 返回结构异常：找不到 content[].text", {
      url,
      body: rawText,
    });
  }
  return cleanText(content);
}

export async function generateRecommendations({ settings, page }) {
  // Legacy orchestrator. The service worker now drives generation directly
  // (see background.js). Kept here only for any external callers; it operates
  // on the user's `settings.styles` array.
  const { provider, apiKey, model, language, baseUrl, styles } = settings;
  if (!apiKey) throw new LlmError("尚未配置 API Key，请先到设置页填写。");

  const resolvedBase = normalizeBaseUrl(baseUrl, provider);
  const lang = language || "zh-CN";
  const callOne =
    provider === "anthropic" ? callAnthropicStyle : callOpenAIStyle;

  const list = Array.isArray(styles) ? styles : [];
  if (list.length === 0) {
    throw new LlmError("没有可用的分享模板。");
  }

  const settled = await Promise.allSettled(
    list.map((style) =>
      callOne({
        apiKey,
        model,
        baseUrl: resolvedBase,
        systemPrompt: buildSystemPromptForStyle(lang, style),
        userPrompt: buildUserPromptForStyle(page, style),
      })
    )
  );

  const result = {};
  const errors = [];
  list.forEach((style, i) => {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value) {
      result[style.id] = r.value;
    } else {
      const err = r.status === "rejected" ? r.reason : new LlmError("空结果");
      errors.push({ style: style.id, label: style.label, error: err });
      result[style.id] = "";
    }
  });

  if (Object.keys(result).every((k) => !result[k])) {
    const first = errors[0]?.error;
    if (first) throw first;
    throw new LlmError("生成失败（所有模板均无返回）");
  }

  if (errors.length) {
    result._errors = errors.map((e) => ({
      style: e.style,
      label: e.label,
      message: e.error?.message || String(e.error),
      status: e.error?.status,
      body: e.error?.body,
      url: e.error?.url,
    }));
  }
  return result;
}

// Minimal "is this key + model + base url reachable?" probe.
// Uses 1 token of generation so it's effectively free but still exercises auth,
// the chosen model id, and the base URL.
export async function testConnection({ provider, apiKey, model, baseUrl }) {
  if (!apiKey) throw new LlmError("请先填写 API Key。");
  const resolvedBase = normalizeBaseUrl(baseUrl, provider);
  const resolvedModel =
    (model || "").trim() || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;

  if (provider === "anthropic") {
    const url = buildUrl(resolvedBase, "/messages");
    await fetchOrThrow("Anthropic", url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    return { provider, model: resolvedModel, baseUrl: resolvedBase, url };
  }

  const url = buildUrl(resolvedBase, "/chat/completions");
  await fetchOrThrow("OpenAI", url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  return { provider, model: resolvedModel, baseUrl: resolvedBase, url };
}
