#!/usr/bin/env python3
"""Periodic TAG-system reclustering — the only batch step (SPEC §5).

Operates on the *tag system*, not the words. Live AI tagging (SPEC §4) keeps
day-to-day grouping instant and stable; this runs periodically to keep the tag
SET healthy as the vault grows, and to fill the embedding/edge layer the 2D
graph (§6.1) needs:

    1. Embed every expression that lacks one        (cheap embedding API)
    2. Merge tags whose member-centroids overlap     (cosine >= --merge)
    3. Split overloaded tags into sub-groups         (HDBSCAN on members)
    4. Auto-name new/changed tags                     (LLM, optional)
    5. Refresh similarity edges between expressions   (cosine >= --edge)

Reads and writes the single-file vault export (SPEC §7) — the same JSON shape
db.exportVault() / importVault() use: {version, expressions[], tags[], edges[]}.

Cost-conscious: embeddings are computed only for expressions missing one
(incremental), and every API step can be turned off (--no-embed / --no-name)
so the clustering/edge math can run offline on a pre-embedded vault.

  python tools/recluster.py --vault vault.json
  python tools/recluster.py --vault vault.json --dry-run
  python tools/recluster.py --vault vault.json --no-embed --no-name   # offline
"""

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np

# --- .env loading (no extra dep) ---------------------------------------------


def load_env(path=".env"):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


# --- HTTP (stdlib only, per SPEC §9) -----------------------------------------


def _post(url, headers, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


# Cheap hosted embeddings. DeepSeek has no embedding endpoint, so the default is
# OpenAI text-embedding-3-small (the cheapest reasonable option).
def embed_texts(texts, model, key):
    data = _post(
        "https://api.openai.com/v1/embeddings",
        {"authorization": f"Bearer {key}"},
        {"model": model, "input": texts},
    )
    return [np.array(d["embedding"], dtype=np.float32) for d in data["data"]]


# OpenAI-compatible chat (DeepSeek by default) for tag auto-naming.
LLM_ENDPOINTS = {
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
    "moonshot": "https://api.moonshot.cn/v1/chat/completions",
    "mistral": "https://api.mistral.ai/v1/chat/completions",
}


def llm_complete(prompt, provider, model, key):
    data = _post(
        LLM_ENDPOINTS[provider],
        {"authorization": f"Bearer {key}"},
        {"model": model, "max_tokens": 200, "messages": [{"role": "user", "content": prompt}]},
    )
    return data["choices"][0]["message"]["content"].strip()


# --- vector helpers -----------------------------------------------------------


def cosine(a, b):
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def vecs(expressions):
    """{id: np.array} for every expression that has an embedding."""
    out = {}
    for e in expressions:
        if e.get("embedding"):
            out[e["id"]] = np.array(e["embedding"], dtype=np.float32)
    return out


def centroid(ids, vmap):
    arrs = [vmap[i] for i in ids if i in vmap]
    return np.mean(arrs, axis=0) if arrs else None


# --- pipeline stages ----------------------------------------------------------


def step_embed(vault, model, key):
    """Embed expressions that lack one. Returns count newly embedded."""
    missing = [e for e in vault["expressions"] if not e.get("embedding")]
    if not missing:
        return 0
    texts = [f'{e["surface"]} — {e.get("gloss_cn") or ""}' for e in missing]
    embeddings = embed_texts(texts, model, key)
    for e, v in zip(missing, embeddings):
        e["embedding"] = [round(float(x), 6) for x in v]
        e["updated_at"] = e.get("updated_at", 0)
    return len(missing)


def step_merge(vault, threshold):
    """Merge same-axis tags whose member-centroids are near-duplicates.

    Greedy union-find: the larger tag keeps its name; the absorbed tag is
    recorded in merged_from and its members fold in. Returns list of (kept, gone).
    """
    vmap = vecs(vault["expressions"])
    tags = vault["tags"]
    by_id = {t["id"]: t for t in tags}
    cents = {t["id"]: centroid(t["member_ids"], vmap) for t in tags}
    gone = set()
    merges = []

    for axis in ("topic", "intent"):
        axis_tags = [t for t in tags if t["axis"] == axis and t["id"] not in gone]
        axis_tags.sort(key=lambda t: len(t["member_ids"]), reverse=True)
        for i, keep in enumerate(axis_tags):
            if keep["id"] in gone or cents[keep["id"]] is None:
                continue
            for other in axis_tags[i + 1 :]:
                if other["id"] in gone or cents[other["id"]] is None:
                    continue
                if cosine(cents[keep["id"]], cents[other["id"]]) >= threshold:
                    merged = sorted(set(keep["member_ids"]) | set(other["member_ids"]))
                    keep["member_ids"] = merged
                    keep["merged_from"] = (keep.get("merged_from") or []) + [other["id"]]
                    keep["prev_tag_id"] = keep["id"]
                    cents[keep["id"]] = centroid(merged, vmap)
                    gone.add(other["id"])
                    merges.append((keep["name"], other["name"]))

    vault["tags"] = [t for t in tags if t["id"] not in gone]
    # Drop merged tag names off any expression (members already point at keep).
    return merges


def step_split(vault, min_members):
    """Split overloaded tags whose members form clear sub-groups (HDBSCAN)."""
    try:
        import hdbscan
    except ImportError:
        print("  (hdbscan not installed — skipping split)", file=sys.stderr)
        return []

    vmap = vecs(vault["expressions"])
    splits = []
    new_tags = []
    survivors = []

    for tag in vault["tags"]:
        members = [m for m in tag["member_ids"] if m in vmap]
        if len(members) < min_members:
            survivors.append(tag)
            continue
        X = np.array([vmap[m] for m in members])
        labels = hdbscan.HDBSCAN(min_cluster_size=max(2, min_members // 2)).fit_predict(X)
        clusters = sorted(set(labels) - {-1})
        if len(clusters) < 2:
            survivors.append(tag)
            continue
        # Real split: one new sub-tag per cluster; noise (-1) stays on the original.
        for n, c in enumerate(clusters, 1):
            ids = [members[i] for i, lab in enumerate(labels) if lab == c]
            new_tags.append(
                {
                    "id": f'{tag["id"]}#{n}',
                    "axis": tag["axis"],
                    "name": f'{tag["name"]}-{n}',  # renamed by step_name if LLM on
                    "member_ids": sorted(ids),
                    "prev_tag_id": tag["id"],
                    "merged_from": None,
                    "split_from": tag["id"],
                }
            )
        noise = [members[i] for i, lab in enumerate(labels) if lab == -1]
        if noise:
            tag["member_ids"] = sorted(noise)
            survivors.append(tag)
        splits.append((tag["name"], len(clusters)))

    vault["tags"] = survivors + new_tags
    return splits


def step_name(vault, provider, model, key):
    """Auto-name tags that just changed (merged/split), via LLM. Best-effort."""
    changed = [t for t in vault["tags"] if t.get("merged_from") or t.get("split_from")]
    named = 0
    for tag in changed:
        sample = [e["surface"] for e in vault["expressions"] if e["id"] in tag["member_ids"]][:8]
        if not sample:
            continue
        prompt = (
            f'These English expressions share a {tag["axis"]} group: {", ".join(sample)}.\n'
            f"Give one short lowercase-kebab tag name for the group (e.g. \"describe-strong\"). "
            f"Reply with ONLY the tag name."
        )
        try:
            name = llm_complete(prompt, provider, model, key).strip().strip('"').split()[0]
            if name:
                tag["name"] = name
                named += 1
        except Exception as ex:  # noqa: BLE001 — naming is best-effort
            print(f"  (naming failed for {tag['id']}: {ex})", file=sys.stderr)
    return named


def step_edges(vault, threshold):
    """Rebuild similarity edges between expressions (cosine >= threshold)."""
    vmap = vecs(vault["expressions"])
    ids = list(vmap)
    edges = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            sim = cosine(vmap[ids[i]], vmap[ids[j]])
            if sim >= threshold:
                edges.append(
                    {
                        "id": f"{ids[i]}~{ids[j]}",
                        "from_id": ids[i],
                        "to_id": ids[j],
                        "type": "synonym",  # similarity-driven; antonym/progression are LLM work (SPEC §2.3)
                        "source": "ai",
                        "confidence": round(sim, 4),
                    }
                )
    vault["edges"] = edges
    return len(edges)


# --- main ---------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--vault", required=True, help="Path to the exported vault JSON.")
    p.add_argument("--embed-model", default="text-embedding-3-small", help="OpenAI embedding model.")
    p.add_argument("--llm-provider", default="deepseek", choices=list(LLM_ENDPOINTS))
    p.add_argument("--llm-model", default="deepseek-chat", help="Chat model for tag auto-naming.")
    p.add_argument("--merge", type=float, default=0.92, help="Tag-merge cosine threshold.")
    p.add_argument("--edge", type=float, default=0.82, help="Expression-edge cosine threshold.")
    p.add_argument("--min-split", type=int, default=8, help="Min members before a tag may split.")
    p.add_argument("--no-embed", action="store_true", help="Skip the embedding API call.")
    p.add_argument("--no-name", action="store_true", help="Skip LLM tag auto-naming.")
    p.add_argument("--dry-run", action="store_true", help="Compute everything but don't write back.")
    args = p.parse_args()

    load_env()
    vault = json.loads(Path(args.vault).read_text())
    vault.setdefault("expressions", [])
    vault.setdefault("tags", [])
    vault.setdefault("edges", [])
    print(f"vault: {len(vault['expressions'])} expressions, {len(vault['tags'])} tags")

    if not args.no_embed:
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            sys.exit("OPENAI_API_KEY not set (needed for embeddings; use --no-embed to skip).")
        n = step_embed(vault, args.embed_model, key)
        print(f"embedded: {n} new expression(s)")

    merges = step_merge(vault, args.merge)
    print(f"merged: {len(merges)} tag pair(s)" + (f" — {merges}" if merges else ""))

    splits = step_split(vault, args.min_split)
    print(f"split: {len(splits)} tag(s)" + (f" — {splits}" if splits else ""))

    if not args.no_name:
        key = os.environ.get(f"{args.llm_provider.upper()}_API_KEY")
        if key:
            print(f"auto-named: {step_name(vault, args.llm_provider, args.llm_model, key)} tag(s)")
        else:
            print(f"  ({args.llm_provider.upper()}_API_KEY not set — skipping auto-naming)")

    n_edges = step_edges(vault, args.edge)
    print(f"edges: {n_edges} similarity edge(s)")

    if args.dry_run:
        print("dry-run — not written.")
        return
    Path(args.vault).write_text(json.dumps(vault, ensure_ascii=False, indent=2))
    print(f"written → {args.vault}")


if __name__ == "__main__":
    main()
