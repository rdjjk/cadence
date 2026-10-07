// src/util.js — tiny shared helpers. No dependencies.

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export const nowISO = () => new Date().toISOString();

export const pad2 = (n) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (never UTC — the user's day matters). */
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export const todayStr = () => dateStr(new Date());

/** "09:00" → 540 minutes past midnight. Returns null when invalid. */
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function fmtTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Minutes since local midnight for a Date. */
export const minutesOfDay = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/** JS getDay() index: 0=Sun … 6=Sat. Stored `days` arrays use this. */
export const dayIndex = (d = new Date()) => d.getDay();

export const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Local date-time for iCalendar as floating local time (YYYYMMDDTHHMMSS). */
export function icsLocal(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** Date-only for iCalendar (YYYYMMDD). */
export function icsDate(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
