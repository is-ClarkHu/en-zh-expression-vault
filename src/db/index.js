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
const DB_VERSION = 1;
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
    reading: c.reading ?? null,
    gloss_cn: c.gloss_cn ?? null,
    intent_cn: c.intent_cn ?? null,
    register: c.register ?? null,
    corpus: c.corpus ?? null,
    sense_key: c.sense_key ?? null,
    example_src: c.example_src ?? "",
    example_gen: c.example_gen ?? null,
    topics: Array.isArray(c.topics) ? c.topics : [],
    intents: Array.isArray(c.intents) ? c.intents : [],
    embedding: c.embedding ?? null,
    qa_log: c.qa_log ?? null,
    srs_state: null,
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
  const tx = db.transaction(["expressions", "tags"], "readwrite");
  const expr = await reqP(tx.objectStore("expressions").get(id));
  if (expr) {
    tx.objectStore("expressions").delete(id);
    await indexTags(tx, expr, -1);
  }
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

// Knowledge-graph edges (§2.3). Empty until the AI layer / recluster.py
// populate them; exposed now so the dashboard can report the count.
export async function getEdges() {
  const db = await openDB();
  return reqP(db.transaction("edges").objectStore("edges").getAll());
}

// --- single-file sync shape (§7) ---------------------------------------

export async function exportVault() {
  const db = await openDB();
  const [expressions, tags, edges] = await Promise.all([
    reqP(db.transaction("expressions").objectStore("expressions").getAll()),
    reqP(db.transaction("tags").objectStore("tags").getAll()),
    reqP(db.transaction("edges").objectStore("edges").getAll()),
  ]);
  return { version: 1, exported_at: Date.now(), expressions, tags, edges };
}

// Per-record last-write-wins merge by updated_at (SPEC §7 conflict rule).
export async function importVault(data) {
  const db = await openDB();
  const tx = db.transaction(["expressions", "tags", "edges"], "readwrite");
  for (const expr of data.expressions || []) {
    const store = tx.objectStore("expressions");
    const cur = await reqP(store.get(expr.id));
    if (!cur || (expr.updated_at || 0) >= (cur.updated_at || 0)) store.put(expr);
  }
  for (const tag of data.tags || []) tx.objectStore("tags").put(tag);
  for (const edge of data.edges || []) tx.objectStore("edges").put(edge);
  await txDone(tx);
}
