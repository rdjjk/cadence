// src/ics.js — iCalendar (.ics) export.
// Emits recurring VEVENTs + VALARM for every item with a reminder schedule so
// the user can import into a phone calendar for reliable background alarms.
// Times are floating local time (no TZID); the phone calendar supplies the zone.

import { DAY_CODES, icsLocal, icsDate } from "./util.js";

const LIVE = (r) => r && r.deleted !== true;
const CRLF = "\r\n";

function icsUTC(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC5545: keep content lines ≤75 octets, fold continuations with CRLF+space.
function fold(line) {
  const bytes = (s) => new TextEncoder().encode(s).length;
  if (bytes(line) <= 73) return line;
  let out = "";
  let cur = "";
  for (const ch of line) {
    if (bytes(cur + ch) > 73) {
      out += (out ? CRLF + " " : "") + cur;
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out += (out ? CRLF + " " : "") + cur;
  return out;
}

function rrule(days) {
  const byday = (days || []).map((i) => DAY_CODES[i]).filter(Boolean).join(",");
  return byday ? `FREQ=WEEKLY;BYDAY=${byday}` : "FREQ=DAILY";
}

function addMinutes(d, min) {
  return new Date(d.getTime() + min * 60_000);
}

function atTime(base, hhmm, addMin = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return addMinutes(d, addMin);
}

function lines(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}:${v}`);
}

function vevent(uid, summary, description, dtstart, dtend, rr, alarm) {
  const body = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUTC()}`,
    ...lines({
      DTSTART: dtstart,
      DTEND: dtend,
      SUMMARY: escapeText(summary),
      DESCRIPTION: escapeText(description),
      RRULE: rr,
    }),
  ];
  if (alarm) {
    body.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(summary)}`,
      `TRIGGER:${alarm.trigger}`,
      alarm.repeat ? `REPEAT:${alarm.repeat}` : "",
      alarm.duration ? `DURATION:${alarm.duration}` : "",
      "END:VALARM",
    );
  }
  body.push("END:VEVENT");
  return body.filter((l) => l !== "");
}

export function generateICS(state, now = new Date()) {
  const mods = new Map(state.modules.map((m) => [m.id, m]));
  const events = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (const item of state.items.filter(LIVE)) {
    if (item.kind === "habit" || (item.kind === "task" && item.cadence)) {
      const c = item.cadence;
      if (!c) continue;
      const mod = mods.get(item.moduleId);
      const desc = `${mod?.name || ""}${item.notes ? "｜" + item.notes : ""}`;
      const rr = rrule(c.days);
      for (const t of c.times || []) {
        const start = atTime(base, t);
        events.push(...vevent(
          `${item.id}-t-${t.replace(":", "")}@cadence.local`,
          `${item.title} · ${t}`, desc,
          icsLocal(start), icsLocal(addMinutes(start, 15)), rr,
          { trigger: "PT0M" },
        ));
      }
      const step = Number(c.intervalMin) || 0;
      const ws = c.windowStart, we = c.windowEnd;
      if (step > 0 && ws && we && we > ws) {
        const start = atTime(base, ws);
        const end = atTime(base, we);
        const count = Math.max(1, Math.floor((end - start) / (step * 60_000)));
        events.push(...vevent(
          `${item.id}-i@cadence.local`,
          `${item.title} · 每${step}分钟`, desc,
          icsLocal(start), icsLocal(end), rr,
          { trigger: "PT0M", repeat: Math.max(0, count - 1), duration: `PT${step}M` },
        ));
      }
    }
    const due = item.kind === "goal" ? item.goal?.dueDate : item.dueDate;
    if (due && !item.cadence) {
      const start = new Date(due + "T00:00:00");
      const end = new Date(start.getTime() + 86_400_000);
      const mod = mods.get(item.moduleId);
      events.push(...vevent(
        `${item.id}-due@cadence.local`,
        `截止 · ${item.title}`,
        `${mod?.name || ""}${item.notes ? "｜" + item.notes : ""}`,
        `VALUE=DATE:${icsDate(start)}`, `VALUE=DATE:${icsDate(end)}`, "", null,
      ));
    }
  }

  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cadence//节律//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Cadence 节律",
  ];
  const tail = ["END:VCALENDAR"];
  return [...head, ...events, ...tail].map(fold).join(CRLF) + CRLF;
}
