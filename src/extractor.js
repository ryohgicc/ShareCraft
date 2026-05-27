// Runs in the page context via chrome.scripting.executeScript.
// Extracts title, source, and a clean text excerpt from the current page.
function extractPageContent() {
  const MAX_LEN = 8000;

  function clean(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function metaContent(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const v = el && (el.getAttribute("content") || el.textContent);
      if (v && v.trim()) return v.trim();
    }
    return "";
  }

  const title =
    metaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ||
    document.title ||
    "";

  const description = metaContent([
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ]);

  const siteName =
    metaContent(['meta[property="og:site_name"]']) ||
    location.hostname.replace(/^www\./, "");

  // Prefer semantic content containers, fall back to body.
  const containers = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector('[role="main"]'),
    document.querySelector("#content"),
    document.querySelector(".content"),
    document.querySelector(".post"),
    document.querySelector(".article"),
    document.body,
  ].filter(Boolean);

  let bodyText = "";
  for (const node of containers) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(
        "script, style, noscript, nav, footer, header, aside, form, iframe, svg, .ad, .ads, .advertisement"
      )
      .forEach((el) => el.remove());
    // textContent works on detached cloned nodes (innerText does not).
    const text = clean(clone.textContent || "");
    if (text.length > bodyText.length) bodyText = text;
    if (bodyText.length >= MAX_LEN) break;
  }

  if (bodyText.length > MAX_LEN) {
    bodyText = bodyText.slice(0, MAX_LEN) + "…";
  }

  return {
    title: clean(title),
    description: clean(description),
    siteName: clean(siteName),
    url: location.href,
    body: bodyText,
  };
}

// Last expression is returned to chrome.scripting.executeScript callers.
extractPageContent();
