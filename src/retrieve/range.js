// Shared range model (SPEC v3 §2d / §5) — the single description of "which slice
// of the vault is in focus." The structure browser (retrieve) writes it when you
// pick a tag; the graph reads it so the selector and the graph share ONE range
// instead of each keeping its own. A range is one of:
//   { kind: "all" }                       every expression
//   { kind: "tag", axis, name }           one topic/intent tag
//   { kind: "register", name }            one register band
//   { kind: "recent", n }                 the most-recent N
//   { kind: "ids", ids, label }           an explicit set (e.g. a lasso patch)

import { getExpressions, getExpressionsByTag } from "../db/index.js";

let current = { kind: "all" };
const listeners = new Set();

export function getRange() {
  return current;
}

export function setRange(range) {
  current = range;
  for (const cb of listeners) cb(current);
}

// Subscribe to range changes; returns an unsubscribe fn.
export function onRange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function rangeLabel(r = current) {
  switch (r.kind) {
    case "tag": return r.name;
    case "register": return r.name;
    case "recent": return `Recent ${r.n}`;
    case "ids": return r.label || `${r.ids.length} selected`;
    default: return "All expressions";
  }
}

// Resolve a range to its expression rows (newest-first, as the db returns).
export async function rangeExpressions(r = current) {
  switch (r.kind) {
    case "tag": return getExpressionsByTag(r.axis, r.name);
    case "register": return (await getExpressions()).filter((e) => e.register === r.name);
    case "recent": return (await getExpressions()).slice(0, r.n);
    case "ids": {
      const set = new Set(r.ids);
      return (await getExpressions()).filter((e) => set.has(e.id));
    }
    default: return getExpressions();
  }
}
