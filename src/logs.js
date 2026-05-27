import { getLogs, clearLogs } from "./log.js";

const els = {
  level: document.getElementById("level"),
  scope: document.getElementById("scope"),
  search: document.getElementById("search"),
  refresh: document.getElementById("refresh-btn"),
  copy: document.getElementById("copy-btn"),
  clear: document.getElementById("clear-btn"),
  meta: document.getElementById("meta"),
  empty: document.getElementById("empty"),
  table: document.getElementById("table"),
  rows: document.getElementById("rows"),
};

const LEVEL_ORDER = ["debug", "info", "warn", "error"];

let entries = [];

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}.${pad(d.getMilliseconds(), 3)}`;
}

function levelMeetsThreshold(level, threshold) {
  if (!threshold) return true;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(threshold);
}

function refreshScopeOptions() {
  const scopes = Array.from(new Set(entries.map((e) => e.scope))).sort();
  const cur = els.scope.value;
  els.scope.innerHTML = '<option value="">全部</option>';
  scopes.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === cur) opt.selected = true;
    els.scope.appendChild(opt);
  });
}

function render() {
  const level = els.level.value;
  const scope = els.scope.value;
  const q = els.search.value.trim().toLowerCase();

  const filtered = entries.filter((e) => {
    if (!levelMeetsThreshold(e.level, level)) return false;
    if (scope && e.scope !== scope) return false;
    if (q) {
      const haystack = (
        e.scope +
        " " +
        e.msg +
        " " +
        JSON.stringify(e.data || "")
      ).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  els.rows.innerHTML = "";
  if (entries.length === 0) {
    els.empty.hidden = false;
    els.table.hidden = true;
    els.meta.textContent = "";
    return;
  }
  els.empty.hidden = true;
  els.table.hidden = false;
  els.meta.textContent = `显示 ${filtered.length} / ${entries.length} 条`;

  filtered.forEach((e) => els.rows.appendChild(renderRow(e)));
}

function renderRow(e) {
  const tr = document.createElement("tr");
  tr.classList.add(`level-${e.level}`);

  const tdTime = document.createElement("td");
  tdTime.className = "col-time";
  tdTime.textContent = fmtTime(e.ts);

  const tdLevel = document.createElement("td");
  tdLevel.className = "col-level";
  tdLevel.textContent = e.level;

  const tdScope = document.createElement("td");
  tdScope.className = "col-scope";
  tdScope.textContent = e.scope;

  const tdMsg = document.createElement("td");
  tdMsg.className = "col-msg";
  tdMsg.textContent = e.msg;

  const tdData = document.createElement("td");
  tdData.className = "col-data";
  if (e.data && Object.keys(e.data).length) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(e.data, null, 2);
    tdData.appendChild(pre);
  } else {
    tdData.textContent = "—";
  }

  tr.append(tdTime, tdLevel, tdScope, tdMsg, tdData);
  return tr;
}

async function load() {
  entries = await getLogs();
  refreshScopeOptions();
  render();
}

els.refresh.addEventListener("click", load);
els.level.addEventListener("change", render);
els.scope.addEventListener("change", render);
els.search.addEventListener("input", render);

els.copy.addEventListener("click", async () => {
  const json = JSON.stringify(entries, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    const orig = els.copy.textContent;
    els.copy.textContent = "已复制";
    setTimeout(() => (els.copy.textContent = orig), 1200);
  } catch (_) {}
});

els.clear.addEventListener("click", async () => {
  if (!confirm("确定清空全部日志？")) return;
  await clearLogs();
  entries = [];
  refreshScopeOptions();
  render();
});

// Live update when new logs land while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes["sharecraft.log.v1"]) return;
  entries = changes["sharecraft.log.v1"].newValue || [];
  refreshScopeOptions();
  render();
});

load();
