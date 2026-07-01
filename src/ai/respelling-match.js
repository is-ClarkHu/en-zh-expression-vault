// Respelling comparison for the proper-noun pronunciation consensus (v4 §1c).
// Pure, dependency-free string logic — split out of pronounce.js so it carries no
// browser deps and can be exercised directly by a Node test against real model
// output. pronounce.js imports agree() from here.

// Collapse a respelling to a comparison key: lowercase, letters only.
export const norm = (r) => String(r || "").toLowerCase().replace(/[^a-z]/g, "");

// The stressed syllable = the all-caps token (the model marks stress in CAPS).
// Stress placement is the decisive signal for "settled vs not": Mbappé came back
// EM-bah-pay vs em-BAP-ay (stress differs → no settled reading), whereas Subaru's
// SOO-bah-roo vs SOO-buh-roo agree on stress and differ only in an unstressed
// vowel's notation (same reading).
const stressTok = (r) => {
  const caps = String(r || "").split(/[\s-]+/).find((t) => /[A-Z]{2,}/.test(t));
  return (caps || "").toLowerCase().replace(/[^a-z]/g, "");
};

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// Two respellings "agree" when they're effectively the same US reading despite
// notation noise. Requires (1) compatible STRESS — equal/prefix/edit-distance≤1 of
// the stressed syllable (so EM- vs em-BAP diverge, but SOO- vs SOO- and BROYN vs
// BROY agree) AND (2) a close letter-skeleton — equal, a prefix (absorbs a trailing
// schwa: duh-BROYN vs duh-BROY-nuh), or a small edit distance. Verified on the
// step-0 names: De Bruyne / Subaru / Szczęsny agree, Mbappé diverges. (Rhotic vs
// non-rhotic notation, e.g. Worcester WUUS-ter vs WUHS-tuh, can still read as a
// divergence — a safe miss: the card shows a correct respelling, just labeled
// "approximate".)
export function agree(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  const sa = stressTok(a), sb = stressTok(b);
  const stressOk = !sa || !sb || sa === sb || sa.startsWith(sb) || sb.startsWith(sa) || lev(sa, sb) <= 1;
  if (!stressOk) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  return lev(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 6));
}
