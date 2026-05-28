// =============================================================================
// ShareCraft Prompts
// =============================================================================
// 这里只放**默认值**——用户实际使用的 styles 列表由设置页维护并存储在
// settings.styles。
//
// 当前架构：每个分享模板（style）走一次独立的 LLM 请求，N 个并发。每次只让
// 模型输出纯文本，不再要求 JSON。
//
// 一个 style 的数据结构：
//   {
//     id:             string，全局唯一，用作存储 key 和卡片 data-style 属性
//     label:          string，UI 上显示的中文标题
//     prompt:         string，发给模型的核心 prompt（{MAX} 会被替换为字符上限）
//     maxChars:       number，输出字符上限，模型会被引导写到 80%-100%
//     requiresInput?: boolean，true 表示这个模板需要用户额外输入（润色场景）
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
// 全局语言规则
// -----------------------------------------------------------------------------
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
    prompt: `Write the recommendation in the "close friend" style:

VOICE & TONE
- Casual IM chat between close friends — warm, personal, low-pressure.
- Sound like you actually read it and genuinely want to share, not selling it.
- Avoid marketing language: no "必看", "震撼", "强烈推荐", "amazing", "must-read".
- Avoid clichés and 鸡汤/self-help phrasing.

CONTENT STRUCTURE (~80–100 chars, ONE short message)
1. A light hook — what it's about, or why it caught your eye.
2. One concrete reason it's worth their time (fresh angle / real cases / counter-intuitive insight / solid approach).
3. A natural ending (see ENDING RULE below).

ENDING RULE (mandatory — never end on a feature description)
The last clause MUST be ONE of these four types:
(a) LIGHT JUDGMENT — a brief personal take, not a verdict
    e.g. "思路是对的" / "算是把这事往前推了一步" / "挺扎实的"
(b) OPEN HOOK — tease without spelling it out, leave room for curiosity
    e.g. "具体怎么样你自己看" / "细节比我说的有意思" / "看完可能会改变点想法"
(c) SCENARIO SUGGESTION — when/how it'd be useful
    e.g. "下次做原型可以拿来玩玩" / "通勤路上翻翻刚好"
(d) FIT SIGNAL — who/what mindset it suits
    e.g. "适合最近在纠结 X 的人看" / "如果你也在想这事,挺对味的"

❌ Bad ending:   "...还能生成对比报告。"           (stops at a feature)
❌ Bad ending:   "...你一定要看!"                  (pushy, marketing tone)
✅ Good ending:  "...思路是对的,值得翻翻。"        (light judgment)
✅ Good ending:  "...具体效果你自己试,我觉得方向有意思。" (open hook + judgment)

STYLE RULES
- First-person, conversational; casual particles welcome (挺/还/嘛/吧/算是 in Chinese; "kinda", "pretty", "tbh" in English).
- ONE short message — no bullet points, no headings, no emoji spam.
- No spoilers of the main argument; tease, don't summarize.
- Match the language of the article (Chinese article → Chinese rec).
- Keep the ending SHORT — a clause, not another sentence pile-up.

TONE REFERENCES
- "看到一篇讲 X 的,挺有意思,你应该会感兴趣"
- "Found this take on Y, pretty thought-provoking"

EXAMPLE OUTPUTS (~90 chars):

[judgment ending]
这篇写得挺真实,讲职场人那种说不清的困境,还给了几条挺落地的建议,不鸡汤也不说教,算是难得讲明白了的一篇。

[open hook ending]
看到一个给 AI 设计代理用的 Lazyweb,不靠模型凭感觉画界面,而是拉了二十多万真实应用截图做参考,具体效果你自己试,思路挺有意思。

[scenario ending]
发现一个挺有意思的工具,把 Mobbin、Dribbble 这些库都接进来生成对比报告,下次做 side project 的原型可以拿来玩玩。

[fit ending]
一篇讲 AI 设计工程化的,不是空谈方法论,有真实数据和流程,如果你最近也在折腾这块,挺对味的。`,
  },
  {
    id: "quote",
    label: "金句安利",
    maxChars: 200,
    prompt: `Write the recommendation in style "quote":

Structure:
1. Open with 1-2 short sentences summarizing what the content is about and what angle it takes.
2. Then introduce and quote 1-2 of the most striking lines from the page, using 「」 for Chinese or "" for English.
3. Optionally end with a brief reaction (≤ 15 chars) like "看完想了很久" — keep it natural, not every output needs this.

What counts as a great quote (pick lines that match AT LEAST ONE):
- Counter-intuitive: breaks a common assumption
- Re-definition: redefines a familiar concept in a fresh way
- Sharp contrast: pairs opposing ideas to create tension
- Condensed insight: a complex truth compressed into one line
- Vivid metaphor: makes abstract ideas concrete
- Painful truth: says what people think but rarely say out loud

The quote MUST be:
- Self-contained: impactful even without the article's context
- Concise: every word earns its place
- Resonant: makes the reader pause and think "huh, that's true"

Hard rules:
- NEVER fabricate quotes. Only use lines actually from the page. If no line truly stands out, pick the sentence with the strongest viewpoint and quote it faithfully (light trimming for length is okay, but don't change the meaning).
- AVOID quoting factual statements, generic slogans, definitions, or jargon-heavy lines.
- AVOID hype intros like "金句来了" "划重点" "必看".
- The summary part should give just enough context — don't spoil the quote's punch.

Length: ≤ 200 characters total.

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
  {
    id: "polish",
    label: "自定义润色",
    maxChars: 500,
    requiresInput: true,
    prompt: `Polish the user's draft commentary about the page. The user's draft will be supplied separately as USER DRAFT.

CORE RULE — KEEP THE USER'S VOICE:
- The user's draft IS the source of truth for stance, opinion, attitude, and any specific claims.
- Do NOT replace their viewpoint with your own. Do NOT flip from negative to positive (or vice versa).
- Do NOT add new opinions the user did not express.
- You MAY: fix grammar, smooth awkward phrasing, tighten redundancy, replace vague words with concrete ones from the page, add at most 1 supporting detail from the page if the draft feels under-specified.

FORMAT:
- Output ONLY the polished text — no prefix, no surrounding quotes, no explanation.

LENGTH:
- Stay close to the user's draft length. If their draft is < 30 characters, you may extend up to ~200 characters to make it readable. Otherwise stay within roughly ±30% of the draft's length.`,
  },
];

// 内置预设模板的 id 集合，设置页可以借助它判断"恢复默认"是否还原过这些。
export const BUILTIN_STYLE_IDS = new Set(DEFAULT_STYLES.map((s) => s.id));

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
  const out = {
    id: id.slice(0, 64),
    label: label.slice(0, 40),
    prompt,
    maxChars: max,
  };
  // requiresInput: check the raw data first; if not present, fall back to the
  // built-in default for this id (handles upgrades where the field was added
  // after the user already saved their styles list).
  if (raw.requiresInput) {
    out.requiresInput = true;
  } else {
    const builtin = DEFAULT_STYLES.find((d) => d.id === id);
    if (builtin?.requiresInput) out.requiresInput = true;
  }
  return out;
}

function clampMax(n) {
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.max(MIN_STYLE_CHARS, Math.min(MAX_STYLE_CHARS, Math.round(n)));
}

function cloneStyle(s) {
  const out = { id: s.id, label: s.label, prompt: s.prompt, maxChars: s.maxChars };
  if (s.requiresInput) out.requiresInput = true;
  return out;
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
// style 是已归一化的对象：{ id, label, prompt, maxChars, requiresInput? }
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
// 如果模板设置了 requiresInput，会把用户在 popup 里输入的草稿拼到上下文末尾，
// 让模型在润色时知道哪段是用户的原话。
export function buildUserPromptForStyle(page, style, userInput) {
  const parts = [
    `Page title: ${page.title || "(unknown)"}`,
    page.siteName ? `Source: ${page.siteName}` : "",
    `URL: ${page.url}`,
    page.description ? `Meta description: ${page.description}` : "",
    "",
    "Page content (may be truncated):",
    page.body || "(no extractable body text)",
  ];

  if (style?.requiresInput) {
    parts.push("");
    parts.push("----");
    parts.push(
      "USER DRAFT (this is the text you should polish — keep their voice, opinion, and rough length):"
    );
    parts.push(
      typeof userInput === "string" && userInput.trim() ? userInput : "(empty)"
    );
  }

  parts.push("");
  parts.push("Now write the recommendation. Output ONLY the recommendation text, nothing else.");
  return parts.filter(Boolean).join("\n");
}
