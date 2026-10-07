// src/store.js — single source of truth + localStorage persistence.
// Framework-free: a tiny observable store with CRUD helpers that always
// stamp `updatedAt` so cross-device merge (src/merge.js) stays correct.

import { mergeDatasets } from "./merge.js";
import { uid, nowISO, todayStr, dateStr } from "./util.js";

export const STORAGE_KEY = "cadence.v1";

export function defaultState() {
  return {
    version: 1,
    modules: [],
    items: [],
    logs: [],
    settings: { theme: "auto", notifications: false },
  };
}

const LIVE = (r) => r && r.deleted !== true;

function normalize(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== "object") return d;
  return {
    version: raw.version ?? 1,
    modules: Array.isArray(raw.modules) ? raw.modules : [],
    items: Array.isArray(raw.items) ? raw.items : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    settings: { ...d.settings, ...(raw.settings || {}) },
  };
}

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : defaultState();
  } catch (err) {
    console.warn("[cadence] load failed, starting fresh:", err);
    return defaultState();
  }
}

let state = read();
const listeners = new Set();

function persist() {
  try {
    pruneLastFired();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[cadence] save failed:", err);
  }
}

// lastFired can grow forever; keep only the last 7 days of fired slot keys.
function pruneLastFired() {
  const lf = state.settings.lastFired;
  if (!lf) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(lf)) {
    if (Date.parse(lf[k]) < cutoff) delete lf[k];
  }
}

function commit(mutator) {
  mutator(state);
  persist();
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;

/* ----------------------------- reads ----------------------------- */

export const liveModules = () =>
  state.modules
    .filter(LIVE)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt > b.createdAt ? 1 : -1));

export const liveItems = (moduleId) =>
  state.items
    .filter((i) => LIVE(i) && (!moduleId || i.moduleId === moduleId))
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));

export const getModule = (id) => state.modules.find((m) => m.id === id && LIVE(m));
export const getItem = (id) => state.items.find((i) => i.id === id && LIVE(i));

export const liveLogs = (itemId) =>
  state.logs.filter((l) => LIVE(l) && (!itemId || l.itemId === itemId));

export function countToday(itemId) {
  const t = todayStr();
  return liveLogs(itemId).filter((l) => l.date === t).length;
}

/** Consecutive days (ending today or yesterday) with ≥1 log. */
export function streak(itemId, today = todayStr()) {
  const days = new Set(liveLogs(itemId).map((l) => l.date));
  if (days.size === 0) return 0;
  const cursor = new Date(today + "T00:00:00");
  if (!days.has(dateStr(cursor))) cursor.setDate(cursor.getDate() - 1); // allow "not yet today"
  let n = 0;
  while (days.has(dateStr(cursor))) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/* ----------------------------- writes ----------------------------- */

export function addModule({ name, color, emoji }) {
  const order = state.modules.filter(LIVE).reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;
  const mod = {
    id: uid(), name: String(name || "未命名模块").trim() || "未命名模块",
    color: color || "#5E6AD2", emoji: emoji || "📌",
    order, createdAt: nowISO(), updatedAt: nowISO(), deleted: false,
  };
  commit((s) => s.modules.push(mod));
  return mod;
}

export function updateModule(id, patch) {
  commit((s) => {
    const m = s.modules.find((x) => x.id === id);
    if (m) Object.assign(m, patch, { updatedAt: nowISO() });
  });
}

/** Tombstones the module and cascades the tombstone to its items. */
export function deleteModule(id) {
  const t = nowISO();
  commit((s) => {
    const m = s.modules.find((x) => x.id === id);
    if (m) Object.assign(m, { deleted: true, updatedAt: t });
    for (const it of s.items) {
      if (it.moduleId === id && !it.deleted) Object.assign(it, { deleted: true, updatedAt: t });
    }
  });
}

export function moveModule(id, delta) {
  commit((s) => {
    const live = s.modules.filter(LIVE).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = live.findIndex((m) => m.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= live.length) return;
    const a = live[i], b = live[j];
    const tmp = a.order; a.order = b.order; b.order = tmp;
    a.updatedAt = nowISO(); b.updatedAt = nowISO();
  });
}

export function addItem(moduleId, kind, fields = {}) {
  const base = {
    id: uid(), moduleId, kind, title: String(fields.title || "未命名").trim() || "未命名",
    notes: fields.notes || "", createdAt: nowISO(), updatedAt: nowISO(), deleted: false,
  };
  if (kind === "task") {
    base.done = false;
    base.dueDate = fields.dueDate || "";
    base.cadence = fields.cadence || null;
  } else if (kind === "habit") {
    base.cadence = fields.cadence || { times: [], intervalMin: 0, windowStart: "", windowEnd: "", days: [] };
  } else if (kind === "goal") {
    base.goal = fields.goal || { target: 100, current: 0, unit: "", direction: "increase", dueDate: "" };
  }
  commit((s) => s.items.push(base));
  return base;
}

export function updateItem(id, patch) {
  commit((s) => {
    const it = s.items.find((x) => x.id === id);
    if (it) Object.assign(it, patch, { updatedAt: nowISO() });
  });
}

export function deleteItem(id) {
  commit((s) => {
    const it = s.items.find((x) => x.id === id);
    if (it) Object.assign(it, { deleted: true, updatedAt: nowISO() });
  });
}

export function toggleTask(id) {
  commit((s) => {
    const it = s.items.find((x) => x.id === id);
    if (it) Object.assign(it, { done: !it.done, updatedAt: nowISO() });
  });
}

export function checkIn(itemId) {
  const log = {
    id: uid(), itemId, date: todayStr(), at: nowISO(), value: 1,
    createdAt: nowISO(), updatedAt: nowISO(), deleted: false,
  };
  commit((s) => s.logs.push(log));
  return log;
}

/** Removes the most recent check-in for today (undo). */
export function undoCheckIn(itemId) {
  const t = todayStr();
  commit((s) => {
    const todays = s.logs.filter((l) => LIVE(l) && l.itemId === itemId && l.date === t);
    const last = todays[todays.length - 1];
    if (last) Object.assign(last, { deleted: true, updatedAt: nowISO() });
  });
}

export function setSettings(patch) {
  commit((s) => Object.assign(s.settings, patch));
}

export function markFired(slotKey) {
  markFiredMany([slotKey]);
}

export function markFiredMany(slotKeys) {
  if (!slotKeys || slotKeys.length === 0) return;
  commit((s) => {
    if (!s.settings.lastFired) s.settings.lastFired = {};
    const t = nowISO();
    for (const k of slotKeys) s.settings.lastFired[k] = t;
  });
}

/* --------------------------- export / import --------------------------- */

/** Public export: full records including tombstones, minus device-local fire state. */
export function exportJSON() {
  const { lastFired, ...settings } = state.settings;
  const payload = {
    version: state.version,
    exportedAt: nowISO(),
    modules: state.modules,
    items: state.items,
    logs: state.logs,
    settings,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Smart-merge an imported payload into local state.
 * Older files neither duplicate nor lose data. Returns merge stats.
 */
export function importJSON(text) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.modules)) {
    throw new Error("文件格式不匹配（缺少 modules）");
  }
  const { data, stats } = mergeDatasets(state, incoming);
  commit((s) => {
    s.version = data.version;
    s.modules = data.modules;
    s.items = data.items;
    s.logs = data.logs;
    s.settings = { ...data.settings, lastFired: s.settings.lastFired || {} };
  });
  return stats;
}

export function replaceState(next) {
  state = normalize(next);
  persist();
  for (const fn of listeners) fn(state);
}
