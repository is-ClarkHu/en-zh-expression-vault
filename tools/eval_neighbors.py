#!/usr/bin/env python3
"""Neighbour quality: are a word's nearest embedding neighbours actually related?

"Find relations" sends each word's top-8 cosine neighbours to the model to be
typed (synonym / antonym / progression / collocation / abbreviation / none), so
a bad neighbour list caps what the model can find. Two measures:

  tag overlap@k   share of the top-k neighbours that share at least one topic or
                  intent tag with the word, next to the same share for ALL other
                  words (what random neighbours would score). Automatic, but it
                  only measures agreement with the tags, not relevance.
  manual audit    --audit-out writes each sampled word's top-k for a person to
                  grade 0 (unrelated) / 1 (related) / 2 (strongly related);
                  --audit-in reports precision@1/@5/@k and mean grade.

  python tools/eval_neighbors.py vault.json
  python tools/eval_neighbors.py vault.json --audit-out nbr-audit.csv --queries 25
  python tools/eval_neighbors.py --audit-in nbr-audit.csv
"""

import argparse
import csv
import random
import sys
from collections import defaultdict

import numpy as np

from vault_io import AXES, cosine_matrix, load_embedded, wilson


def tagset(e):
    return {(axis, t) for axis, field in AXES.items() for t in e.get(field) or []}


def top_k(X, k):
    S = cosine_matrix(X, X)
    np.fill_diagonal(S, -np.inf)
    order = np.argsort(-S, axis=1)[:, :k]
    return S, order


def overlap_report(embedded, X, k):
    S, order = top_k(X, k)
    tags = [tagset(e) for e in embedded]
    hit, base = [], []
    for i, nbrs in enumerate(order):
        if not tags[i]:
            continue
        hit.append(np.mean([bool(tags[i] & tags[j]) for j in nbrs]))
        base.append(np.mean([bool(tags[i] & tags[j]) for j in range(len(embedded)) if j != i]))
    print(f"\ntag overlap@{k} over {len(hit)} tagged word(s):")
    print(f"  top-{k} neighbours: {np.mean(hit):.1%}")
    print(f"  all other words:  {np.mean(base):.1%}   (what random neighbours would score)")


def audit_out(path, embedded, X, k, n, seed):
    S, order = top_k(X, k)
    picks = random.Random(seed).sample(range(len(embedded)), min(n, len(embedded)))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["query", "query_gloss", "rank", "neighbour", "neighbour_gloss", "cosine", "grade (0/1/2)"])
        for i in picks:
            for r, j in enumerate(order[i], 1):
                q, nb = embedded[i], embedded[j]
                w.writerow([q["surface"], q.get("gloss_cn", ""), r, nb["surface"], nb.get("gloss_cn", ""), f"{S[i, j]:.4f}", ""])
    print(f"wrote {len(picks)} quer(ies) × top-{k} → {path}; grade the last column, then --audit-in")


def audit_in(path):
    by_query = defaultdict(dict)
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            g = (row.get("grade (0/1/2)") or "").strip()
            if g in ("0", "1", "2"):
                by_query[row["query"]][int(row["rank"])] = int(g)
    if not by_query:
        sys.exit(f"{path}: no rows graded yet.")
    k = max(max(r) for r in by_query.values())
    for cut in sorted({1, 5, k}):
        hits = n = 0
        for grades in by_query.values():
            ranked = [grades[r] for r in range(1, cut + 1) if r in grades]
            hits += sum(g >= 1 for g in ranked)
            n += len(ranked)
        lo, hi = wilson(hits, n)
        print(f"precision@{cut}: {hits}/{n} ({hits / n:.0%}), 95% CI {lo:.0%}–{hi:.0%}")
    allg = [g for grades in by_query.values() for g in grades.values()]
    print(f"mean grade: {np.mean(allg):.2f} over {len(allg)} graded pair(s), {len(by_query)} quer(ies)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("vault", nargs="?", help="Exported vault JSON.")
    p.add_argument("-k", type=int, default=8, help="Neighbours per word (the app sends 8).")
    p.add_argument("--audit-out", help="Write a CSV of top-k lists for manual grading.")
    p.add_argument("--queries", type=int, default=20, help="Words sampled for the audit.")
    p.add_argument("--audit-in", help="Score a graded audit CSV (no vault needed).")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    if args.audit_in:
        audit_in(args.audit_in)
        return
    if not args.vault:
        p.error("vault path required (or --audit-in)")
    rows, embedded, X = load_embedded(args.vault)
    k = min(args.k, len(embedded) - 1)
    print(f"{args.vault}: {len(rows)} expressions, {len(embedded)} embedded ({X.shape[1]}-d)")
    overlap_report(embedded, X, k)
    if args.audit_out:
        audit_out(args.audit_out, embedded, X, k, args.queries, args.seed)


if __name__ == "__main__":
    main()
