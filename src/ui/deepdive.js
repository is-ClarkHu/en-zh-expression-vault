// Deep-dive control (SPEC §4.6) shared by retrieve + review cards: shows the
// card's qa_log (originating Q&A + any prior deep-dives) and quick-ask buttons
// that fetch a focused follow-up and append it. stopPropagation so it works
// inside the clickable review flip card.

import { DEEP_DIVE_KINDS, deepDive } from "../ai/deepdive.js";
import { appendQaLog } from "../db/index.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

export function deepDiveControl(expr, { persist = true } = {}) {
  const wrap = el("div", "deepdive");

  const log = el("div", "deepdive__log");
  const renderLog = () => {
    log.innerHTML = "";
    for (const e of expr.qa_log || []) {
      const item = el("div", "deepdive__entry");
      item.append(el("div", "deepdive__q", e.q));
      item.append(el("div", "deepdive__a", e.a));
      log.append(item);
    }
  };
  renderLog();

  const buttons = el("div", "deepdive__buttons");
  buttons.append(el("span", "deepdive__label", "深挖"));
  for (const k of DEEP_DIVE_KINDS) {
    const b = el("button", "chip", k.label);
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      b.disabled = true;
      const orig = b.textContent;
      b.textContent = "…";
      try {
        const a = await deepDive(expr, k.id);
        const entry = { q: k.label, a };
        expr.qa_log = [...(expr.qa_log || []), entry];
        if (persist && expr.id) await appendQaLog(expr.id, entry);
        renderLog();
      } catch (e) {
        alert(e?.message === "NO_KEY" ? "先在 Capture 里填好 provider 的 API key。" : `Deep-dive failed: ${e?.message || e}`);
      } finally {
        b.disabled = false;
        b.textContent = orig;
      }
    });
    buttons.append(b);
  }

  wrap.append(buttons, log);
  return wrap;
}
