"""Shared helpers for the tools/eval_*.py scripts: load an exported vault
(Settings → Sync & data → Export vault) and the small stats both scripts use."""

import json
import math
import sys
from pathlib import Path

import numpy as np

AXES = {"topic": "topics", "intent": "intents"}


def load_embedded(path):
    """Expressions that carry an embedding, plus their unit-normalised matrix.

    Proper nouns are never embedded (they don't take part in grouping), so they
    drop out here the same way they do in the app.
    """
    vault = json.loads(Path(path).read_text())
    rows = vault.get("expressions", [])
    embedded = [e for e in rows if e.get("embedding")]
    if len(embedded) < 3:
        sys.exit(
            f"{path}: {len(embedded)} of {len(rows)} expressions have an embedding; need at least 3.\n"
            "Embeddings are computed in the app on save (or by opening Graph with an\n"
            "embedding key set). Export again once they exist."
        )
    X = np.array([e["embedding"] for e in embedded], dtype=np.float64)
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    return rows, embedded, X


def cosine_matrix(A, B):
    """A @ B.T on unit rows. numpy 2.0 + macOS Accelerate raises spurious
    divide/overflow warnings on small matmuls with finite output, so silence
    them and check the result instead."""
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        S = A @ B.T
    if not np.isfinite(S).all():
        sys.exit("non-finite cosine values; check the embeddings in the export")
    return S


def wilson(k, n, z=1.96):
    """95% Wilson score interval for k successes out of n."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (centre - half, centre + half)


def quartiles(values):
    if not len(values):
        return "n=0"
    q1, med, q3 = np.percentile(values, [25, 50, 75])
    return f"n={len(values)}  median {med:.3f}  IQR {q1:.3f}–{q3:.3f}"
