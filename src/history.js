import {
  getHistory,
  removeFromHistory,
  clearHistory,
} from "./historyStore.js";

const els = {
  search: document.getElementById("search"),
  clearAll: document.getElementById("clear-all-btn"),
  meta: document.getElementById("meta"),
  empty: document.getElementById("empty-state"),
  entries: document.getElementById("entries"),
};

let entries = [];
let query = "";

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return "";
  }
}

function matchesQuery(entry, q) {
  if (!q) return true;
  const haystack = [
    entry.page?.title || "",
    entry.page?.url || "",
    entry.page?.siteName || "",
    ...Object.values(entry.results || {}),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

function render() {
  const filtered = query ? entries.filter((e) => matchesQuery(e, query)) : entries;

  els.entries.innerHTML = "";

  if (entries.length === 0) {
    els.empty.hidden = false;
    els.meta.textContent = "";
    els.clearAll.disabled = true;
    return;
  }
  els.empty.hidden = true;
  els.clearAll.disabled = false;

  if (filtered.length === 0) {
    els.meta.textContent = `共 ${entries.length} 条，搜索没有匹配的结果。`;
  } else if (query) {
    els.meta.textContent = `匹配 ${filtered.length} / ${entries.length} 条`;
  } else {
    els.meta.textContent = `共 ${entries.length} 条`;
  }

  filtered.forEach((entry) => {
    els.entries.appendChild(renderEntry(entry));
  });
}

function renderEntry(entry) {
  const card = document.createElement("article");
  card.className = "entry";
  card.dataset.id = entry.id;

  // Header: title + url + meta + actions
  const head = document.createElement("div");
  head.className = "entry-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "entry-title-wrap";

  const title = document.createElement("div");
  title.className = "entry-title";
  title.textContent = entry.page?.title || "(无标题)";

  const link = document.createElement("a");
  link.className = "entry-url";
  link.href = entry.page?.url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = entry.page?.url || "";

  titleWrap.append(title, link);

  const headActions = document.createElement("div");
  headActions.className = "entry-head-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "link-btn danger";
  deleteBtn.textContent = "删除";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm("确定删除这条记录？")) return;
    await removeFromHistory(entry.id);
    entries = entries.filter((e) => e.id !== entry.id);
    render();
  });

  headActions.append(deleteBtn);
  head.append(titleWrap, headActions);

  // Sub-meta: timestamp + provider + model + host
  const meta = document.createElement("div");
  meta.className = "entry-meta";
  const parts = [
    fmtDate(entry.savedAt),
    entry.provider && entry.model
      ? `${entry.provider} · ${entry.model}`
      : entry.provider || "",
    safeHost(entry.page?.url),
  ].filter(Boolean);
  meta.textContent = parts.join(" · ");

  // Cards for each style result.
  const cards = document.createElement("div");
  cards.className = "entry-cards";
  const styles = entry.styles || [];
  styles.forEach((style) => {
    const text = entry.results?.[style.id];
    if (!text) return;

    const cardEl = document.createElement("div");
    cardEl.className = "entry-card";

    const cardHead = document.createElement("div");
    cardHead.className = "entry-card-head";

    const label = document.createElement("span");
    label.className = "entry-card-label";
    label.textContent = style.label;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "entry-copy-btn";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", async () => {
      const url = entry.page?.url || "";
      const combined = url ? `${text}\n${url}` : text;
      try {
        await navigator.clipboard.writeText(combined);
        const orig = copyBtn.textContent;
        copyBtn.textContent = "已复制";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = orig;
          copyBtn.classList.remove("copied");
        }, 1200);
      } catch (_) {}
    });

    cardHead.append(label, copyBtn);

    const body = document.createElement("p");
    body.className = "entry-card-text";
    body.textContent = text;

    cardEl.append(cardHead, body);
    cards.appendChild(cardEl);
  });

  card.append(head, meta, cards);
  return card;
}

els.search.addEventListener("input", () => {
  query = els.search.value.trim().toLowerCase();
  render();
});

els.clearAll.addEventListener("click", async () => {
  if (entries.length === 0) return;
  if (!confirm(`确定清空全部 ${entries.length} 条历史记录？此操作无法撤销。`)) {
    return;
  }
  await clearHistory();
  entries = [];
  render();
});

// Live update if another window/tab modifies the history.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes["sharecraft.history.v1"]) return;
  entries = changes["sharecraft.history.v1"].newValue || [];
  render();
});

async function init() {
  entries = await getHistory();
  render();
}

init();
