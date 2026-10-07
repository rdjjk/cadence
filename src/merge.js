// src/merge.js — pure, dependency-free merge used by import + tests.
//
// Merge semantics (documented so smoke_test.py can mirror it exactly):
//   • Collections merged: modules, items, logs — union by record `id`.
//   • Per record, last-write-wins: the record with the GREATER `updatedAt`
//     wins. Ties keep the base record (import is a no-op → "unchanged").
//   • Deletions are tombstones: { id, deleted:true, updatedAt }. A newer
//     tombstone replaces a live record (deletion propagates); an older live
//     record does NOT resurrect a newer tombstone.
//   • New ids are added. Existing ids are updated or unchanged.
//   • `settings` is shallow-merged, incoming keys winning.
// Returns { data, stats } where stats counts { added, updated, unchanged }.

export const COLLECTIONS = ["modules", "items", "logs"];

// Timestamp comparison that tolerates Date objects, ISO strings and numbers.
export function ts(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

export function mergeDatasets(base = {}, incoming = {}) {
  const data = {
    version: incoming.version ?? base.version ?? 1,
    modules: [],
    items: [],
    logs: [],
    settings: { ...(base.settings || {}), ...(incoming.settings || {}) },
  };
  const stats = { added: 0, updated: 0, unchanged: 0 };

  for (const key of COLLECTIONS) {
    const map = new Map();
    for (const rec of base[key] || []) {
      if (rec && rec.id) map.set(rec.id, rec);
    }
    for (const rec of incoming[key] || []) {
      if (!rec || !rec.id) continue;
      const current = map.get(rec.id);
      if (!current) {
        map.set(rec.id, rec);
        stats.added += 1;
      } else if (ts(rec.updatedAt) > ts(current.updatedAt)) {
        map.set(rec.id, rec);
        stats.updated += 1;
      } else {
        stats.unchanged += 1;
      }
    }
    data[key] = Array.from(map.values());
  }

  return { data, stats };
}
