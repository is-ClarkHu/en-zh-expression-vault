// Shared Markdown renderer (SPEC v2 §3) — the single place every AI prose blob
// passes through before it hits the DOM. Deep-dive answers, Q&A explanations,
// idiomatic-box renderings, and candidate notes all come back as Markdown
// (often with GFM tables); rendering them as plain text shows literal pipes and
// asterisks. So: parse full Markdown (GFM tables/lists/code/headings on), then
// sanitize the HTML before injecting it.
//
// marked does the parse; DOMPurify strips anything unsafe (scripts, event
// handlers, javascript: URLs). One renderer, used everywhere, so formatting and
// safety stay consistent and tables are styled once (.md styles in main.css).

import { marked } from "marked";
import DOMPurify from "dompurify";

// GFM (tables, strikethrough, autolinks) on; breaks:true so single newlines in
// chat-style answers become <br> the way the AI intends them.
marked.setOptions({ gfm: true, breaks: true });

// Markdown string → sanitized HTML string.
export function renderMarkdown(md) {
  if (md == null) return "";
  const raw = marked.parse(String(md));
  return DOMPurify.sanitize(raw);
}

// Render `md` into `node` as formatted HTML. Adds the `.md` class so the
// stylesheet can scope table/code/list styling to rendered AI prose only.
export function renderMarkdownInto(node, md) {
  node.classList.add("md");
  node.innerHTML = renderMarkdown(md);
  return node;
}

// Convenience: a fresh element with rendered Markdown inside.
export function markdownEl(md, className) {
  const el = document.createElement("div");
  if (className) el.className = className;
  return renderMarkdownInto(el, md);
}
