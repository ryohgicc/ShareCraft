// =============================================================================
// ShareCraft Prompts
// =============================================================================
// 这是插件的"提示词配置文件"。这里只放**默认值**——用户实际使用的 styles 列表
// 由设置页维护并存储在 settings.styles。
//
// 当前架构：每个分享模板（style）走一次独立的 LLM 请求，N 个并发。每次只让
// 模型输出纯文本，不再要求 JSON。
//
// 一个 style 的数据结构：
//   {
//     id:         string，全局唯一，用作存储 key 和卡片 data-style 属性
//     label:      string，UI 上显示的中文标题
//     prompt:     string，发给模型的核心 prompt（{MAX} 会被替换为字符上限）
//     maxChars:   number，输出字符上限，模型会被引导写到 80%-100%
//   }
//
// 共享规则（语气、禁词、解析约束）和长度规则由插件自动拼上，用户改不到。
// =============================================================================

export const LANGUAGE_LABELS = {
  "zh-CN": "Simplified Chinese (简体中文)",
  "zh-TW": "Traditional Chinese (繁體中文)",
  en: "English",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  es: "Spanish (Español)",
  fr: "French (Français)",
  de: "German (Deutsch)",
};

export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_LABELS);

function languageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

// -----------------------------------------------------------------------------
// 共享规则：所有模板都要遵守的写作规范
// -----------------------------------------------------------------------------
const SHARED_RULES = `Tone should be conversational and colloquial, like a real person talking in a chat, NOT robotic or like marketing copy.
Avoid clichés and hype words (e.g., "必读", "震撼", "amazing", "must-read", "yyds", "insightful", "worth reading").
Avoid generic praise — use specific details from the actual page content instead.
Do not use hashtags, excessive emoji, or markdown formatting. At most 1-2 tasteful emojis if natural.
Do not include the URL itself in the recommendation text.
Output ONLY the recommendation text. No prefix, no quotes around it, no explanation, no JSON, no code fences.`;

// -----------------------------------------------------------------------------
// 全局语言规则：所有模板都要遵守，且不可被 style prompt 覆盖
// -----------------------------------------------------------------------------
// 这一段会拼在 system prompt 的最末尾（在风格描述和长度规则之后），用最强的
// 措辞确保输出语言。重要的是必须明确：哪怕原文是另一种语言，引用 / 摘录的
// 内容也要翻译成目标语言再输出，避免出现"中文卡片里夹一段英文引用"。
const STRICT_LANGUAGE_RULE = `LANGUAGE LOCK (overrides any conflicting instruction above):
- The ENTIRE output, including every word, must be written in {LANGUAGE}.
- This applies regardless of the source page's original language.
- If you quote or paraphrase a sentence from the page, TRANSLATE it into {LANGUAGE} first. Never output the original-language sentence verbatim.
- Proper nouns (product names, person names, brand names) may stay in their original spelling if that is how they are commonly referenced.
- Do not output any text in any language other than {LANGUAGE}, even for emphasis or quotation.
- Use punctuation native to {LANGUAGE} (e.g. 「」 for Chinese, "" for English, 「」 for Japanese, etc.).`;

// -----------------------------------------------------------------------------
// 长度规则
// -----------------------------------------------------------------------------
const LENGTH_RULES = `LENGTH BUDGET: hard limit is {MAX} characters. NEVER exceed it.
Aim to use 80-100% of the budget — i.e. roughly {LOWER}-{MAX} characters.
Going significantly under wastes the format. Don't pad with filler or repetition,
but use the budget to add concrete details, specific takeaways, or a memorable line.
Stop only when ending earlier would genuinely feel more natural than continuing.`;

// -----------------------------------------------------------------------------
// 字符上限的全局上下界（所有模板共用）
// -----------------------------------------------------------------------------
export const MIN_STYLE_CHARS = 30;
export const MAX_STYLE_CHARS = 1500;

// -----------------------------------------------------------------------------
// 默认模板（点击"恢复默认"时使用）
// -----------------------------------------------------------------------------
export const DEFAULT_STYLES = [
  {
    id: "friend",
    label: "朋友安利",
    maxChars: 100,
    prompt: `Write the recommendation in style "friend":
Casually recommend it to a close friend in IM chat.
Feel personal and warm, like a real friend saying "you'll like this".
Example tone: "看到一篇讲 X 的，挺有意思，你应该会感兴趣" or "Found this take on Y, pretty thought-provoking".
EXAMPLE OUTPUT (≈90 chars): 这篇写得真实，讲了职场人的真实困境，还有几条挺实用的建议，不是那种鸡汤说教，你看了肯定有共鸣`,
  },
  {
    id: "quote",
    label: "金句安利",
    maxChars: 200,
    prompt: `Write the recommendation in style "quote":
Lead with 1-2 short sentences summarizing what the content is about.
Then quote or highlight 1-2 of the most striking, punchy, or memorable lines/insights from the page.
If the source language differs from the output language, translate the quote (don't keep the original-language sentence).
Use punctuation native to the OUTPUT language (e.g. 「」 in Chinese, "" in English).
Goal: Make people want to click because they're curious about that key insight.
EXAMPLE OUTPUT (≈180 chars): 一篇关于人生选择和焦虑感的反思，作者把"该选哪条路"这个问题拆得挺透。最戳的是这句：「你现在的焦虑，大多源于对未来的高估，对现在的低估，以及对自己的不耐烦」，看完会想停下来想想`,
  },
  {
    id: "detailed",
    label: "详细安利",
    maxChars: 200,
    prompt: `Write the recommendation in style "detailed":
Explain what the page is about, why it's worth reading, and who would benefit.
Feel conversational, like you're writing to a friend group.
Mention 2-3 specific points or takeaways from the actual content.
Should naturally answer "why should I open this?".
EXAMPLE OUTPUT (≈180 chars): 深入聊了 AI 时代普通人怎么保持竞争力，作者从技能可迁移性、个人品牌、副业杠杆三个角度展开，对正在迷茫或者考虑转行的人很有参考价值，里面有很多具体的执行建议`,
  },
];

// 新增自定义模板时用作初始 prompt。
export const NEW_STYLE_TEMPLATE = `Write the recommendation in your custom style:
Describe the angle / tone / audience here.
Mention any specific format rules (e.g. "lead with a question", "include one stat").
EXAMPLE OUTPUT (≈100 chars): （写一条范例输出，模型会从你的范例里学到风格）`;

// -----------------------------------------------------------------------------
// Style 列表归一化
// -----------------------------------------------------------------------------
// 处理来自 storage 的输入：
//   - undefined / 非数组 → 返回默认列表
//   - 缺字段 / 字段类型错 → 修复
//   - id 重复 → 加 -2、-3 后缀
//   - 完全空列表 → 同样保留为空（用户主动删光也是合法状态，但 UI 会提示）
function makeUniqueId(base, used) {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function normalizeStyles(input) {
  if (!Array.isArray(input)) return DEFAULT_STYLES.map(cloneStyle);
  const used = new Set();
  return input
    .map((raw, idx) => {
      const safe = sanitizeStyle(raw, idx);
      if (!safe) return null;
      safe.id = makeUniqueId(safe.id || `style-${idx + 1}`, used);
      used.add(safe.id);
      return safe;
    })
    .filter(Boolean);
}

function sanitizeStyle(raw, idx) {
  if (!raw || typeof raw !== "object") return null;
  const id = (typeof raw.id === "string" && raw.id.trim()) || `style-${idx + 1}`;
  const label =
    (typeof raw.label === "string" && raw.label.trim()) || `模板 ${idx + 1}`;
  const promptRaw = typeof raw.prompt === "string" ? raw.prompt : "";
  const prompt = promptRaw.trim() ? promptRaw : NEW_STYLE_TEMPLATE;
  const max = clampMax(Number(raw.maxChars));
  return { id: id.slice(0, 64), label: label.slice(0, 40), prompt, maxChars: max };
}

function clampMax(n) {
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.max(MIN_STYLE_CHARS, Math.min(MAX_STYLE_CHARS, Math.round(n)));
}

function cloneStyle(s) {
  return { id: s.id, label: s.label, prompt: s.prompt, maxChars: s.maxChars };
}

// 简单 ID 生成器，用于设置页"新增模板"。
export function generateStyleId() {
  return `custom-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

// -----------------------------------------------------------------------------
// 单条风格请求：system prompt
// -----------------------------------------------------------------------------
// style 是已归一化的对象：{ id, label, prompt, maxChars }
export function buildSystemPromptForStyle(language, style) {
  const label = languageLabel(language);
  const limit = clampMax(style?.maxChars);
  const lower = Math.max(1, Math.round(limit * 0.8));

  const stylePrompt = (style?.prompt || NEW_STYLE_TEMPLATE).replace(
    /\{MAX\}/g,
    String(limit)
  );
  const lengthRules = LENGTH_RULES.replace(/\{MAX\}/g, String(limit)).replace(
    /\{LOWER\}/g,
    String(lower)
  );
  // The strict language lock is appended LAST so it takes precedence over any
  // conflicting hints from the (user-editable) style prompt above.
  const languageLock = STRICT_LANGUAGE_RULE.replace(/\{LANGUAGE\}/g, label);

  return `You are a copywriter who specializes in writing recommendation copy for shared links in IM tools (WeChat, Slack, work groups, etc.).

You MUST write the recommendation entirely in ${label}. The page URL must NOT be translated or included in the output.

${SHARED_RULES}

${stylePrompt}

${lengthRules}

${languageLock}`;
}

// -----------------------------------------------------------------------------
// 单条风格请求：user prompt（页面上下文）
// -----------------------------------------------------------------------------
export function buildUserPromptForStyle(page, _style) {
  const parts = [
    `Page title: ${page.title || "(unknown)"}`,
    page.siteName ? `Source: ${page.siteName}` : "",
    `URL: ${page.url}`,
    page.description ? `Meta description: ${page.description}` : "",
    "",
    "Page content (may be truncated):",
    page.body || "(no extractable body text)",
    "",
    "Now write the recommendation. Output ONLY the recommendation text, nothing else.",
  ];
  return parts.filter(Boolean).join("\n");
}
