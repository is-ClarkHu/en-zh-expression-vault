// Shared detail surface (SPEC v3 §2b) — ONE component, two presentations:
//   ≥1024px  a persistent right side panel; opening it adds `body.detail-open`,
//            which shrinks the shell so the card grid reflows to fewer columns.
//   <1024px  a bottom sheet that slides up from the bottom (map/share-sheet
//            style); drag the handle down (or tap the scrim / Esc) to dismiss.
// Deep-dive and full card detail live HERE, off the card, so the card itself
// stays fixed-size (§2a). A single body-level singleton serves every view.

let host = null; // { scrim, panel, body, titleEl }
let onCloseHook = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function build() {
  if (host) return host;

  const scrim = el("div", "detail-panel__scrim");
  scrim.hidden = true;
  scrim.addEventListener("click", closeDetail);

  const panel = el("aside", "detail-panel");
  panel.setAttribute("aria-hidden", "true");

  // Drag handle (the affordance for the bottom-sheet on narrow screens).
  const handle = el("div", "detail-panel__handle");
  const grip = el("div", "detail-panel__grip");
  handle.append(grip);

  const head = el("div", "detail-panel__head");
  const titleEl = el("div", "detail-panel__title");
  const close = el("button", "detail-panel__close");
  close.setAttribute("aria-label", "Close");
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  close.addEventListener("click", closeDetail);
  head.append(titleEl, close);

  const body = el("div", "detail-panel__body");

  panel.append(handle, head, body);
  document.body.append(scrim, panel);

  attachDrag(handle, panel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("detail-open")) closeDetail();
  });

  host = { scrim, panel, body, titleEl };
  return host;
}

// Bottom-sheet drag-to-dismiss: drag the handle down past a threshold to close;
// otherwise it snaps back. Pointer events cover both touch and mouse. No-op on
// wide screens (the side panel doesn't slide).
function attachDrag(handle, panel) {
  let startY = 0, dy = 0, dragging = false;
  const isSheet = () => !window.matchMedia("(min-width: 1024px)").matches;

  handle.addEventListener("pointerdown", (e) => {
    if (!isSheet()) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    panel.style.transition = "none";
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dy > 120) closeDetail();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// Open the panel/sheet with `contentNode` as its body and an optional title.
// onClose runs when it's dismissed (e.g. to clear a selected-card highlight).
export function openDetail(contentNode, { title = "", onClose = null } = {}) {
  const h = build();
  h.titleEl.textContent = title;
  h.body.innerHTML = "";
  h.body.append(contentNode);
  h.body.scrollTop = 0;
  onCloseHook = onClose;
  h.scrim.hidden = false;
  h.panel.setAttribute("aria-hidden", "false");
  // next frame so the slide-in transition runs from the closed state
  requestAnimationFrame(() => document.body.classList.add("detail-open"));
}

export function closeDetail() {
  if (!host) return;
  document.body.classList.remove("detail-open");
  host.panel.setAttribute("aria-hidden", "true");
  host.scrim.hidden = true;
  const cb = onCloseHook;
  onCloseHook = null;
  cb?.();
}

export function isDetailOpen() {
  return document.body.classList.contains("detail-open");
}
