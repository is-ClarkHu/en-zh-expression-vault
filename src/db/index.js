// The vault store (SPEC §2) — IndexedDB, sync-friendly from day one.
//
// Three object stores mirror the data model:
//   expressions  §2.1  the core object (stable id + updated_at for §7 sync merge)
//   tags         §2.2  the organization layer, maintained live on save/delete so
//                      intent reverse-search (§6.1) works on the first word
//   edges        §2.3  knowledge-graph layer — store reserved; AI populates it
//                      later (and recluster.py refreshes it). Not written yet.
//
// Tags are keyed by `${axis}:${name}` so live upsert needs no lookup. Embedding,
// qa_log, example_gen, corpus, srs_state are reserved on the row (SPEC §2.1) for
// the modules that fill them. exportVault/importVault give the single-file,
// last-write-wins shape iCloud sync (§7) will build on.

const DB_NAME = "expression-vault";
const DB_VERSION = 3; // v2: tombstones (sync deletes). v3: ai_cache (don't re-bill identical AI calls)
// Keep deletion markers this long, then prune — by then every device has synced
// past the deletion, so the tombstone is no longer needed to prevent resurrection.
const TOMBSTONE_TTL = 90 * 86400 * 1000; // 90 days
const LEGACY_KEY = "ev-vault"; // the temporary localStorage store we migrate from

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("expressions")) {
        db.createObjectStore("expressions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("tags")) {
        db.createObjectStore("tags", { keyPath: "id" }); // id = `${axis}:${name}`
      }
      if (!db.objectStoreNames.contains("edges")) {
        db.createObjectStore("edges", { keyPath: "id" });
      }
      // Deletion markers {id, deleted_at}. Without these a delete on one device
      // is silently undone by another device that still holds the record.
      if (!db.objectStoreNames.contains("tombstones")) {
        db.createObjectStore("tombstones", { keyPath: "id" });
      }
      // Cache of AI responses keyed by provider+model+prompt, so repeating a
      // lookup / ask / deep-dive doesn't re-bill the user's key (SPEC §10).
      if (!db.objectStoreNames.contains("ai_cache")) {
        db.createObjectStore("ai_cache", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(async (db) => {
    await migrateLegacy(db);
    return db;
  });
  return dbPromise;
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// One-time pull of any rows saved by the temporary localStorage store, so the
// validation-slice data survives the switch to IndexedDB. Runs only if the
// expressions store is empty and the legacy key exists.
async function migrateLegacy(db) {
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
  } catch {
    legacy = [];
  }
  if (!Array.isArray(legacy) || !legacy.length) return;

  const count = await reqP(db.transaction("expressions").objectStore("expressions").count());
  if (count > 0) return; // already have IndexedDB data; leave it alone

  const tx = db.transaction(["expressions", "tags"], "readwrite");
  for (const row of legacy) {
    const expr = normalizeRow(row);
    tx.objectStore("expressions").put(expr);
    await indexTags(tx, expr, +1);
  }
  await txDone(tx);
  localStorage.removeItem(LEGACY_KEY);
}

// Fill in reserved fields so every stored row matches the §2.1 shape.
function normalizeRow(c) {
  const now = Date.now();
  return {
    id: c.id || crypto.randomUUID(),
    surface: c.surface,
    kind: c.kind || "word",
    pos: c.pos ?? null,
    reading: c.reading ?? null,
    gloss_cn: c.gloss_cn ?? null,
    intent_cn: c.intent_cn ?? null,
    register: c.register ?? null,
    corpus: c.corpus ?? null,
    sense_key: c.sense_key ?? null,
    example_src: c.example_src ?? "",
    example_parallel: c.example_parallel ?? null,
    example_gen: c.example_gen ?? null,
    topics: Array.isArray(c.topics) ? c.topics : [],
    intents: Array.isArray(c.intents) ? c.intents : [],
    embedding: c.embedding ?? null,
    qa_log: c.qa_log ?? null,
    srs_state: c.srs_state ?? null, // lightweight review state (§6.2 review); preserved across re-saves
    created_at: c.created_at ?? now,
    updated_at: c.updated_at ?? now,
  };
}

// Add (+1) or remove (-1) this expression's id from its topic/intent tags,
// upserting tag records. Empty tags are pruned on removal.
async function indexTags(tx, expr, dir) {
  const store = tx.objectStore("tags");
  const pairs = [
    ...expr.topics.map((name) => ["topic", name]),
    ...expr.intents.map((name) => ["intent", name]),
  ];
  for (const [axis, name] of pairs) {
    const id = `${axis}:${name}`;
    const existing = await reqP(store.get(id));
    const members = new Set(existing?.member_ids || []);
    if (dir > 0) members.add(expr.id);
    else members.delete(expr.id);

    if (members.size === 0) {
      if (existing) store.delete(id);
      continue;
    }
    store.put({
      id,
      axis,
      name,
      member_ids: [...members],
      prev_tag_id: existing?.prev_tag_id ?? null, // recluster lineage (§2.2)
      merged_from: existing?.merged_from ?? null,
      split_from: existing?.split_from ?? null,
    });
  }
}

// --- public API ---------------------------------------------------------

// Save a candidate card into the vault (enters only on tap — SPEC §0.2).
export async function saveExpression(candidate) {
  const db = await openDB();
  const expr = normalizeRow(candidate);
  const tx = db.transaction(["expressions", "tags"], "readwrite");
  tx.objectStore("expressions").put(expr);
  await indexTags(tx, expr, +1);
  await txDone(tx);
  return expr;
}

export async function getExpressions() {
  const db = await openDB();
  const rows = await reqP(db.transaction("expressions").objectStore("expressions").getAll());
  return rows.sort((a, b) => b.created_at - a.created_at);
}

export async function deleteExpression(id) {
  const db = await openDB();
  const tx = db.transaction(["expressions", "tags", "tombstones"], "readwrite");
  const expr = await reqP(tx.objectStore("expressions").get(id));
  if (expr) {
    tx.objectStore("expressions").delete(id);
    await indexTags(tx, expr, -1);
  }
  tx.objectStore("tombstones").put({ id, deleted_at: Date.now() }); // so the delete syncs
  await txDone(tx);
}

export async function getTombstones() {
  const db = await openDB();
  return reqP(db.transaction("tombstones").objectStore("tombstones").getAll());
}

// Append a {q, a} exchange to a saved expression's qa_log (SPEC §4.6 deep-dive).
// Bumps updated_at so the enriched card syncs.
export async function appendQaLog(id, entry) {
  const db = await openDB();
  const tx = db.transaction("expressions", "readwrite");
  const store = tx.objectStore("expressions");
  const expr = await reqP(store.get(id));
  if (expr) {
    expr.qa_log = [...(expr.qa_log || []), entry];
    expr.updated_at = Date.now();
    store.put(expr);
  }
  await txDone(tx);
  return expr;
}

// Store a word's embedding vector (SPEC v2 §8/§11). Computed once per word and
// bumps updated_at so it travels with the card on sync.
export async function setEmbedding(id, vec) {
  const db = await openDB();
  const tx = db.transaction("expressions", "readwrite");
  const store = tx.objectStore("expressions");
  const expr = await reqP(store.get(id));
  if (expr) {
    expr.embedding = vec;
    expr.updated_at = Date.now();
    store.put(expr);
  }
  await txDone(tx);
}

// Apply a global reassign (SPEC v2 §8): replace the tags on the given axes with
// the authoritative classes and rewrite each expression's axis arrays to match,
// so a misfiled word actually moves. axisPlans = { topic?: [class], intent?: [class] }
// where class = { name, members[], prev_tag_id?, merged_from?, split_from? }.
// One transaction, so the restructure lands all-or-nothing.
export async function applyReassign(axisPlans) {
  const db = await openDB();
  const tx = db.transaction(["expressions", "tags"], "readwrite");
  const tagStore = tx.objectStore("tags");
  const exprStore = tx.objectStore("expressions");
  const field = { topic: "topics", intent: "intents" };
  const wordClass = { topic: new Map(), intent: new Map() };
  const now = Date.now();

  // Drop the old tags of every reassigned axis, then write the new classes.
  for (const t of await reqP(tagStore.getAll())) if (axisPlans[t.axis]) tagStore.delete(t.id);
  for (const axis of Object.keys(axisPlans)) {
    for (const cls of axisPlans[axis]) {
      tagStore.put({
        id: `${axis}:${cls.name}`,
        axis,
        name: cls.name,
        member_ids: [...cls.members],
        prev_tag_id: cls.prev_tag_id ?? null,
        merged_from: cls.merged_from ?? null,
        split_from: cls.split_from ?? null,
      });
      for (const id of cls.members) wordClass[axis].set(id, cls.name);
    }
  }

  // Rewrite each expression's reassigned-axis arrays to its single authoritative
  // class (collapsing the provisional multi-tags); words outside every class go empty.
  for (const e of await reqP(exprStore.getAll())) {
    let changed = false;
    for (const axis of Object.keys(axisPlans)) {
      const cls = wordClass[axis].get(e.id);
      const next = cls ? [cls] : [];
      if (JSON.stringify(next) !== JSON.stringify(e[field[axis]] || [])) {
        e[field[axis]] = next;
        changed = true;
      }
    }
    if (changed) {
      e.updated_at = now;
      exprStore.put(e);
    }
  }
  await txDone(tx);
}

// Record a self-test answer (SPEC v2 §4 review). Lightweight, NON-coercive: a
// "wrong book" counter (unknown ++, known --, gone at 0) plus seen/got/last_seen
// for progress — no due dates, no scheduler, no mastery gates. Bumps updated_at
// so review state travels on sync.
export async function markReview(id, result) {
  const db = await openDB();
  const tx = db.transaction("expressions", "readwrite");
  const store = tx.objectStore("expressions");
  const e = await reqP(store.get(id));
  if (e) {
    const s = { wrong: 0, seen: 0, got: 0, last_seen: 0, ...(e.srs_state || {}) };
    s.seen += 1;
    s.last_seen = Date.now();
    if (result === "known") {
      s.got += 1;
      s.wrong = Math.max(0, s.wrong - 1);
    } else {
      s.wrong += 1;
    }
    e.srs_state = s;
    e.updated_at = Date.now();
    store.put(e);
  }
  await txDone(tx);
  return e?.srs_state;
}

// AI response cache (SPEC §10). Keyed by provider+model+prompt; values are the
// raw completion text. Lives in the vault DB but is excluded from export/import
// (it's a regenerable local cache, not vault data).
export async function getCached(key) {
  const db = await openDB();
  const row = await reqP(db.transaction("ai_cache").objectStore("ai_cache").get(key));
  return row ? row.value : null;
}

export async function setCached(key, value) {
  const db = await openDB();
  const tx = db.transaction("ai_cache", "readwrite");
  tx.objectStore("ai_cache").put({ key, value, created_at: Date.now() });
  await txDone(tx);
}

export async function getTags(axis) {
  const db = await openDB();
  const rows = await reqP(db.transaction("tags").objectStore("tags").getAll());
  return axis ? rows.filter((t) => t.axis === axis) : rows;
}

// Intent reverse-search building block (§6.1): every expression under a tag.
export async function getExpressionsByTag(axis, name) {
  const db = await openDB();
  const tx = db.transaction(["tags", "expressions"]);
  const tag = await reqP(tx.objectStore("tags").get(`${axis}:${name}`));
  if (!tag) return [];
  const exprStore = tx.objectStore("expressions");
  const rows = await Promise.all(tag.member_ids.map((id) => reqP(exprStore.get(id))));
  return rows.filter(Boolean);
}

// Knowledge-graph edges (§2.3). Typed AI relations (synonym/antonym/progression/
// collocation) populated on demand from the graph; similarity is computed live
// instead (v2 §11). Exposed for the dashboard count + the graph overlay.
export async function getEdges() {
  const db = await openDB();
  return reqP(db.transaction("edges").objectStore("edges").getAll());
}

// Upsert typed edges (SPEC §2.3). Keyed by id so re-running relations on a word
// replaces its prior edges rather than duplicating them.
export async function putEdges(edges) {
  const db = await openDB();
  const tx = db.transaction("edges", "readwrite");
  for (const e of edges) tx.objectStore("edges").put(e);
  await txDone(tx);
}

// --- single-file sync shape (§7) ---------------------------------------

export async function exportVault() {
  const db = await openDB();
  const [expressions, tags, edges, tombstones] = await Promise.all([
    reqP(db.transaction("expressions").objectStore("expressions").getAll()),
    reqP(db.transaction("tags").objectStore("tags").getAll()),
    reqP(db.transaction("edges").objectStore("edges").getAll()),
    reqP(db.transaction("tombstones").objectStore("tombstones").getAll()),
  ]);
  return { version: 1, exported_at: Date.now(), expressions, tags, edges, tombstones };
}

// Per-record last-write-wins merge (SPEC §7), across add / edit / delete: for
// each id, the event with the greatest timestamp wins — an upsert's updated_at
// vs a deletion's deleted_at. So adds union, the later edit of the same record
// wins, and a delete propagates (and isn't resurrected by a stale copy).
// Tags/edges are coarse-replaced from the incoming file (recluster regenerates
// them; live re-save rebuilds the tag index).
export async function importVault(data) {
  const db = await openDB();
  const tx = db.transaction(["expressions", "tags", "edges", "tombstones"], "readwrite");
  const exprStore = tx.objectStore("expressions");
  const tombStore = tx.objectStore("tombstones");
  const remoteTombs = new Map((data.tombstones || []).map((t) => [t.id, t.deleted_at || 0]));

  for (const expr of data.expressions || []) {
    const t = expr.updated_at || 0;
    const localTomb = await reqP(tombStore.get(expr.id));
    const delT = Math.max(localTomb?.deleted_at || 0, remoteTombs.get(expr.id) || 0);
    if (delT > t) continue; // a deletion is newer — don't resurrect
    const cur = await reqP(exprStore.get(expr.id));
    if (!cur || t >= (cur.updated_at || 0)) {
      exprStore.put(expr);
      if (localTomb) tombStore.delete(expr.id); // record came back; clear stale tombstone
    }
  }

  for (const [id, delT] of remoteTombs) {
    const cur = await reqP(exprStore.get(id));
    if (cur && (cur.updated_at || 0) > delT) continue; // a local edit is newer — keep it
    if (cur) exprStore.delete(id);
    const localTomb = await reqP(tombStore.get(id));
    if (!localTomb || delT >= localTomb.deleted_at) tombStore.put({ id, deleted_at: delT });
  }

  for (const tag of data.tags || []) tx.objectStore("tags").put(tag);
  for (const edge of data.edges || []) tx.objectStore("edges").put(edge);

  // Prune deletion markers past the retention window so they don't grow forever.
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const tb of await reqP(tombStore.getAll())) {
    if ((tb.deleted_at || 0) < cutoff) tombStore.delete(tb.id);
  }
  await txDone(tx);
}
