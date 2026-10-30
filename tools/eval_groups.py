#!/usr/bin/env python3
"""Group quality: do the topic / intent groups hold together in embedding space?

The groups come from the LLM (Settings → Organize), not from the embeddings, so
this measures how far the two views agree. Three outputs per axis:

  silhouette      cosine-distance silhouette of each word's group. Words in
                  single-word groups score 0 (scikit-learn's convention) and are
                  counted separately.
  pair bands      cosine of same-group pairs vs cross-group pairs, and how many
                  of each clear --threshold (default 0.58, the app's relatedness
                  threshold). This is the number behind dropping cosine-threshold
                  grouping: it shows how many same-theme pairs a threshold misses.
  manual audit    --audit-out writes a sample of words with their group for a
                  person to mark y/n; --audit-in scores the filled file.

A word's group on an axis is its first tag there (after a reassign every word
has exactly one).

  python tools/eval_groups.py vault.json
  python tools/eval_groups.py vault.json --audit-out groups-audit.csv --audit-n 40
  python tools/eval_groups.py --audit-in groups-audit.csv
"""

import argparse
import csv
import random
import sys
from collections import defaultdict

import numpy as np

from vault_io import AXES, cosine_matrix, load_embedded, quartiles, wilson


def silhouette(S, labels):
    """Per-word silhouette with distance = 1 - cosine. S is the cosine matrix."""
    D = 1.0 - S
    groups = defaultdict(list)
    for i, g in enumerate(labels):
        groups[g].append(i)
    out = np.zeros(len(labels))
    for i, g in enumerate(labels):
        own = [j for j in groups[g] if j != i]
        if not own:
            continue  # singleton → 0
        a = D[i, own].mean()
        b = min(D[i, idx].mean() for h, idx in groups.items() if h != g)
        out[i] = (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return out, groups


def report_axis(axis, embedded, X, threshold):
    field = AXES[axis]
    idx = [i for i, e in enumerate(embedded) if e.get(field)]
    labels = [embedded[i][field][0] for i in idx]
    print(f"\n== {axis} ==")
    if len(set(labels)) < 2:
        print(f"  {len(idx)} tagged word(s) in {len(set(labels))} group(s); need ≥2 groups.")
        return
    S = cosine_matrix(X[idx], X[idx])
    s, groups = silhouette(S, labels)
    multi = [i for i, g in enumerate(labels) if len(groups[g]) > 1]
    singletons = sum(1 for g in groups.values() if len(g) == 1)
    print(f"  words {len(idx)} · groups {len(groups)} · single-word groups {singletons}")
    if multi:
        print(f"  silhouette, words in groups of ≥2: mean {s[multi].mean():+.3f} (n={len(multi)})")
    print(f"  silhouette, all words (singletons = 0): mean {s.mean():+.3f}")

    same, cross = [], []
    for i in range(len(idx)):
        for j in range(i + 1, len(idx)):
            (same if labels[i] == labels[j] else cross).append(S[i, j])
    print(f"  same-group pair cosine:  {quartiles(same)}")
    print(f"  cross-group pair cosine: {quartiles(cross)}")
    for name, vals in (("same-group", same), ("cross-group", cross)):
        if vals:
            k = sum(v >= threshold for v in vals)
            print(f"  {name} pairs ≥ {threshold}: {k}/{len(vals)} ({k / len(vals):.0%})")

    print("  per group (size · mean silhouette):")
    for g, members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"    {g:<28} {len(members):>3}  {s[members].mean():+.3f}")


def audit_out(path, embedded, n, seed):
    rng = random.Random(seed)
    rows = []
    for axis, field in AXES.items():
        members = defaultdict(list)
        for e in embedded:
            if e.get(field):
                members[e[field][0]].append(e["surface"])
        pool = [e for e in embedded if e.get(field)]
        for e in rng.sample(pool, min(n, len(pool))):
            g = e[field][0]
            others = [w for w in members[g] if w != e["surface"]][:6]
            rows.append([axis, e["surface"], e.get("gloss_cn", ""), g, "; ".join(others), ""])
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["axis", "word", "gloss_cn", "group", "other_members", "agree (y/n)"])
        w.writerows(rows)
    print(f"wrote {len(rows)} row(s) → {path}; mark the last column y or n, then --audit-in")


def audit_in(path):
    tally = defaultdict(lambda: [0, 0])
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            mark = (row.get("agree (y/n)") or "").strip().lower()
            if mark in ("y", "n"):
                tally[row["axis"]][0] += mark == "y"
                tally[row["axis"]][1] += 1
    if not tally:
        sys.exit(f"{path}: no rows marked y/n yet.")
    for axis, (k, n) in tally.items():
        lo, hi = wilson(k, n)
        print(f"{axis}: {k}/{n} agree ({k / n:.0%}), 95% CI {lo:.0%}–{hi:.0%}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("vault", nargs="?", help="Exported vault JSON.")
    p.add_argument("--threshold", type=float, default=0.58)
    p.add_argument("--audit-out", help="Write a CSV sample for manual y/n marking.")
    p.add_argument("--audit-n", type=int, default=30, help="Words sampled per axis.")
    p.add_argument("--audit-in", help="Score a marked audit CSV (no vault needed).")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    if args.audit_in:
        audit_in(args.audit_in)
        return
    if not args.vault:
        p.error("vault path required (or --audit-in)")
    rows, embedded, X = load_embedded(args.vault)
    print(f"{args.vault}: {len(rows)} expressions, {len(embedded)} embedded ({X.shape[1]}-d)")
    for axis in AXES:
        report_axis(axis, embedded, X, args.threshold)
    if args.audit_out:
        audit_out(args.audit_out, embedded, args.audit_n, args.seed)


if __name__ == "__main__":
    main()
