// src/reminders.js — the local reminder engine.
// No backend: reminders fire only while the app is open. A ~15s poll checks
// for due slots, dedupes via settings.lastFired, and surfaces a "missed" list.
//
// Slot semantics:
//   • fixed times   → one slot per "HH:MM" in cadence.times
//   • interval      → ticks every `intervalMin` from `windowStart` to `windowEnd`
//   • weekday filter→ slot counts only if today's index is in `days` (empty = every day)
// A slot is keyed `${itemId}|${YYYY-MM-DD}|${HH:MM}` so it fires at most once.

import { dateStr, dayIndex, minutesOfDay, parseHHMM, fmtTime } from "./util.js";

export const GRACE_MS = 90_000; // a due slot stays fireable for 90s after its minute
export const POLL_MS = 15_000;

const LIVE = (r) => r && r.deleted !== true;

export function dayActive(days, idx) {
  return !Array.isArray(days) || days.length === 0 || days.includes(idx);
}

/** Minutes-of-day for every slot of `item` on `date` (deduped, sorted). */
export function slotsForItem(item, date = new Date()) {
  const c = item.cadence;
  if (!c) return [];
  if (!dayActive(c.days, dayIndex(date))) return [];
  const out = new Set();
  for (const t of c.times || []) {
    const m = parseHHMM(t);
    if (m != null) out.add(m);
  }
  const start = parseHHMM(c.windowStart);
  const end = parseHHMM(c.windowEnd);
  const step = Number(c.intervalMin) || 0;
  if (step > 0 && start != null && end != null && end > start) {
    for (let m = start; m <= end; m += step) out.add(m);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export const slotKey = (itemId, dateK, minutes) => `${itemId}|${dateK}|${fmtTime(minutes)}`;

function countLogsOn(state, itemId, dateK) {
  return state.logs.filter((l) => LIVE(l) && l.itemId === itemId && l.date === dateK).length;
}

/** Which items carry a reminder schedule at all. */
const scheduledItems = (state) =>
  state.items.filter((i) => LIVE(i) && (i.kind === "habit" || i.kind === "task") && i.cadence);

const taskDone = (item) => item.kind === "task" && item.done === true;

/** Slots due right now (within GRACE), not yet fired, not handled. */
export function dueSlots(state, now = new Date()) {
  const today = dateStr(now);
  const nowMin = minutesOfDay(now);
  const fired = state.settings.lastFired || {};
  const due = [];
  for (const item of scheduledItems(state)) {
    if (taskDone(item)) continue;
    for (const m of slotsForItem(item, now)) {
      if (nowMin < m) continue;
      if ((nowMin - m) * 60_000 >= GRACE_MS) continue;
      const key = slotKey(item.id, today, m);
      if (fired[key]) continue;
      due.push({ item, minutes: m, time: fmtTime(m), key });
    }
  }
  return due;
}

/** Reminders earlier today that never fired and were never completed. */
export function missedSlots(state, now = new Date()) {
  const today = dateStr(now);
  const nowMin = minutesOfDay(now);
  const fired = state.settings.lastFired || {};
  const out = [];
  for (const item of scheduledItems(state)) {
    if (item.kind === "task" && item.done) continue;
    if (item.kind === "habit" && countLogsOn(state, item.id, today) > 0) continue;
    for (const m of slotsForItem(item, now)) {
      if (m >= nowMin) continue; // only the past counts as "missed"
      if (fired[slotKey(item.id, today, m)]) continue;
      out.push({ item, minutes: m, time: fmtTime(m), key: slotKey(item.id, today, m) });
    }
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

/* --------------------------- notifications --------------------------- */

export const notifySupported = () => typeof Notification !== "undefined";
export const permission = () => (notifySupported() ? Notification.permission : "unsupported");

export async function requestPermission() {
  if (!notifySupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function fire({ item, time, key }, moduleName) {
  if (!notifySupported() || Notification.permission !== "granted") return false;
  const title = `${time} · ${item.title}`;
  const body = moduleName ? `${moduleName}｜提醒` : "提醒";
  try {
    const n = new Notification(title, {
      body,
      tag: key,
      renotify: false,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: { itemId: item.id },
    });
    n.onclick = () => { try { window.focus(); } catch {} n.close(); };
    return true;
  } catch (err) {
    console.warn("[cadence] notification failed:", err);
    return false;
  }
}

/**
 * Run one scheduling pass. Notifies due slots and records their keys so they
 * never repeat. Only slots that actually notified are marked — a blocked
 * permission leaves them unmarked so they resurface in the missed list.
 * Returns { due, notified }.
 */
export function runOnce(getState, markFiredMany, now = new Date()) {
  const state = getState();
  const mods = new Map(state.modules.map((m) => [m.id, m]));
  const due = dueSlots(state, now);
  const notified = [];
  for (const slot of due) {
    const mod = mods.get(slot.item.moduleId);
    if (fire(slot, mod?.name)) notified.push(slot.key);
  }
  if (notified.length) markFiredMany(notified);
  return { due, notified };
}

/** Start the poll loop. Returns a stop() function. */
export function startScheduler(getState, markFiredMany, { intervalMs = POLL_MS, onChange } = {}) {
  const tick = () => {
    try {
      const result = runOnce(getState, markFiredMany);
      if (onChange) onChange(result);
    } catch (err) {
      console.warn("[cadence] scheduler error:", err);
    }
  };
  tick();
  const id = setInterval(tick, intervalMs);
  // Browsers throttle background timers; re-check the instant we're visible.
  const onVis = () => { if (!document.hidden) tick(); };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVis);
  };
}
