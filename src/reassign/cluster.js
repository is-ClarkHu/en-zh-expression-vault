// Word-level reassign — the stability-diff core (SPEC v2 §8).
//
// The one-click reassign re-derives the AUTHORITATIVE grouping by looking at all
// expressions at once, per axis (topic / intent); the grouping itself comes from
// the LLM (reassign/index.js). These are pure functions over the new clusters +
// the current tags, so the whole restructure can be unit-tested off-DOM and
// previewed before anything is written.
//
//   cosine     embedding similarity, shared by the graphs + relatedness check
//   planAxis   map the new clusters back onto the old tags, deciding
//              kept / merged / split / new, and which need a fresh name

export function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const intersize = (a, setB) => a.reduce((n, id) => n + (setB.has(id) ? 1 : 0), 0);

// Map fresh clusters onto the existing tags of one axis, deciding each new
// class's provenance + whether it needs a new name. oldTags: [{name, member_ids}].
// clusters: [[id,...], ...]. Returns [{ members, name|null, status, from }]:
//   kept    — one old tag, mostly intact   → keep its name (stable)
//   merged  — absorbs ≥2 old tags          → keep the dominant name, record `from`
//   split   — one old tag broke into pieces → the non-dominant pieces, name=null
//   new     — no overlap with any old tag   → name=null
// name=null means "auto-name this one" (LLM, done by the orchestrator). On
// unchanged data every cluster reproduces an old tag exactly → all "kept",
// names unchanged, no moves → a true no-op (idempotent).
export function planAxis(clusters, oldTags) {
  const olds = oldTags.map((t) => ({ name: t.name, set: new Set(t.member_ids), size: t.member_ids.length }));

  // Overlaps of each cluster with every old tag, strongest first.
  const overlaps = clusters.map((ids) =>
    olds
      .map((o) => ({ name: o.name, size: o.size, inter: intersize(ids, o.set) }))
      .filter((o) => o.inter > 0)
      .sort((a, b) => b.inter - a.inter || b.size - a.size),
  );

  // For each old tag, the cluster that best represents it keeps the name; any
  // other cluster also dominated by that old tag is a split-off piece.
  const winnerForOld = {};
  overlaps.forEach((ov, i) => {
    if (!ov.length) return;
    const dom = ov[0].name;
    const cur = winnerForOld[dom];
    if (cur == null || ov[0].inter > overlaps[cur][0].inter) winnerForOld[dom] = i;
  });

  return clusters.map((members, i) => {
    const ov = overlaps[i];
    if (!ov.length) return { members, name: null, status: "new", from: [] };
    const dom = ov[0];
    if (winnerForOld[dom.name] !== i) {
      return { members, name: null, status: "split", from: [dom.name] };
    }
    // Winner of its dominant old tag. Did it also absorb other old tags whole-ish?
    const absorbed = ov.slice(1).filter((o) => o.inter >= Math.ceil(o.size / 2));
    if (absorbed.length) {
      return { members, name: dom.name, status: "merged", from: [dom.name, ...absorbed.map((o) => o.name)] };
    }
    return { members, name: dom.name, status: "kept", from: [dom.name] };
  });
}
