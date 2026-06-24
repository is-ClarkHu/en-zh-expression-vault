#!/usr/bin/env python3
"""Periodic TAG-system reclustering — the only batch step (SPEC §5).

This operates on the *tag system*, not the words. As the vault grows, the tag
set degrades: near-duplicate tags accumulate ("gym" + "working out") and some
tags overload and should split ("ball-sports" -> "basketball" / "football").
This tool fixes that, on a manual trigger:

    1. Embed each tag (centroid of its members, or name + sample members).
    2. Merge tags whose semantics overlap above a threshold.
    3. Split tags whose members form clearly separate sub-groups (HDBSCAN).
    4. Auto-name new/changed tags via LLM; diff against prev_tag_id for stability.
    5. Refresh edges (similarity/antonym from embeddings; AI for progression).

Day-to-day app use never depends on this — live AI tagging keeps grouping
instant and stable. This only runs periodically (e.g. 200 words -> a better
8/10/12 tags), typically on the Mac (SPEC §7).

Status: planned. Scaffold only — pipeline stages land module by module.
"""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vault",
        help="Path to the exported vault file (JSON/SQLite) to recluster.",
    )
    parser.add_argument(
        "--provider",
        default="deepseek",
        help="LLM provider for tag auto-naming / AI-judged edges (key from .env).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute merges/splits and print the diff without writing back.",
    )
    args = parser.parse_args()

    raise SystemExit(
        "recluster.py is a scaffold (SPEC §5). Pipeline not implemented yet."
    )


if __name__ == "__main__":
    main()
