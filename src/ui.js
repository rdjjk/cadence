// src/ui.js — DOM rendering + event wiring. Framework-free.
// Full re-render on every store change via data-action click delegation;
// modal sheets hold their own transient form state.

import * as store from "./store.js";
import { generateICS } from "./ics.js";
import { missedSlots, notifySupported, permission, requestPermission, slotsForItem } from "./reminders.js";
import { escapeHTML, todayStr, DAY_LABELS } from "./util.js";

const COLORS = [
  { name: "靛蓝", hex: "#5E6AD2" }, { name: "天蓝", hex: "#0075DE" },
  { name: "青", hex: "#2A9D99" }, { name: "绿", hex: "#1AAE39" },
  { name: "橙", hex: "#DD5B00" }, { name: "玫红", hex: "#E0457B" },
  { name: "紫", hex: "#7C5CE0" }, { name: "石墨", hex: "#615D59" },
];

const EMOJIS = [
  "📌", "✅", "🏃", "💪", "📚", "💧", "🧘", "💼", "🍎", "💊",
  "💤", "✍️", "🎯", "💰", "🎸", "🧹", "🐶", "✈️", "🎂", "❤️",
  "🌱", "☕", "🧠", "🛒", "📷", "🏊", "🚴", "🕌", "🧴", "🩺",
];

const KIND_LABEL = { task: "待办", habit: "习惯", goal: "目标" };
const KIND_ICON = { task: "i-check", habit: "i-repeat", goal: "i-target" };

const el = (id) => document.getElementById(id);
const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;

let selectedModuleId = null;
let deferredInstall = null;
let toastTimer = null;

/* ------------------------------ bootstrap ------------------------------ */

export function initUI() {
  el("btn-notify").addEventListener("click", onNotifyButton);
  el("btn-theme").addEventListener("click", cycleTheme);
  el("btn-export").addEventListener("click", exportData);
  el("btn-import").addEventListener("click", () => el("file-import").click());
  el("btn-ics").addEventListener("click", exportICS);
  el("file-import").addEventListener("change", importData);

  el("app").addEventListener("click", onAppClick);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    renderInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    renderInstallButton();
    toast("已安装到设备");
  });

  store.subscribe(render);
  render();
}

/* ------------------------------- render ------------------------------- */

function render() {
  renderModules();
  renderContent();
  renderMissed();
  renderNotifyButton();
  renderInstallButton();
}

export function refreshUI() { render(); }

function state() { return store.getState(); }

function renderModules() {
  const mods = store.liveModules();
  if (selectedModuleId && !mods.some((m) => m.id === selectedModuleId)) selectedModuleId = null;
  const all = store.liveItems().length;
  const chips = [
    chipHTML("all", "全部", null, selectedModuleId === null, all),
    ...mods.map((m) => chipHTML(m.id, m.name, m, selectedModuleId === m.id, store.liveItems(m.id).length)),
    `<button class="btn btn--ghost chip modules__add" data-action="add-module">${icon("i-plus")}新模块</button>`,
  ];
  el("modules").innerHTML = chips.join("");
}

function chipHTML(id, name, mod, active, count) {
  const emblem = mod ? `<span class="emblem" style="--emblem:${mod.color}">${escapeHTML(mod.emoji)}</span>` : "";
  const dataId = mod ? ` data-id="${mod.id}"` : "";
  return `<button class="chip" type="button" aria-pressed="${active}" data-action="select-module" data-module="${id}"${dataId}>
    ${emblem}<span>${escapeHTML(name)}</span><span class="chip__badge">${count}</span>
  </button>`;
}

function renderContent() {
  const mods = selectedModuleId ? store.liveModules().filter((m) => m.id === selectedModuleId) : store.liveModules();
  if (mods.length === 0) {
    el("content").innerHTML = emptyStateHTML();
    return;
  }
  el("content").innerHTML = mods.map(moduleSectionHTML).join("");
}

function emptyStateHTML() {
  return `<div class="empty">
    ${icon("i-inbox")}
    <p class="empty__title">还没有模块</p>
    <p class="empty__hint">先创建一个模块（例如「健身」「工作」「阅读」），再往里面添加待办、习惯或目标。</p>
    <button class="btn btn--primary" type="button" data-action="add-module">${icon("i-plus")}创建第一个模块</button>
  </div>`;
}

function moduleSectionHTML(mod) {
  const items = store.liveItems(mod.id);
  const body = items.length ? items.map((it) => itemHTML(it)).join("")
    : `<div class="empty" style="padding:var(--space-6) 0"><p class="empty__hint">这个模块还是空的，添加一条吧。</p></div>`;
  return `<div class="section" data-module-section="${mod.id}">
    <div class="section-head">
      <div class="section-head__title">
        <span class="emblem emblem--lg" style="--emblem:${mod.color}">${escapeHTML(mod.emoji)}</span>
        <span>${escapeHTML(mod.name)}</span>
      </div>
      <div class="section-head__actions">
        <button class="btn btn--icon" type="button" aria-label="上移模块" data-action="move-module" data-id="${mod.id}" data-delta="-1">${icon("i-chevron-left")}</button>
        <button class="btn btn--icon" type="button" aria-label="下移模块" data-action="move-module" data-id="${mod.id}" data-delta="1">${icon("i-chevron-right")}</button>
        <button class="btn btn--icon" type="button" aria-label="编辑模块" data-action="edit-module" data-id="${mod.id}">${icon("i-pencil")}</button>
        <button class="btn btn--icon" type="button" aria-label="删除模块" data-action="delete-module" data-id="${mod.id}">${icon("i-trash")}</button>
      </div>
    </div>
    <div class="content">${body}</div>
    <div class="field__row" style="margin-top:var(--space-2)">
      <button class="btn btn--ghost" type="button" data-action="add-item" data-id="${mod.id}" data-kind="task">${icon("i-plus")}待办</button>
      <button class="btn btn--ghost" type="button" data-action="add-item" data-id="${mod.id}" data-kind="habit">${icon("i-repeat")}习惯</button>
      <button class="btn btn--ghost" type="button" data-action="add-item" data-id="${mod.id}" data-kind="goal">${icon("i-target")}目标</button>
    </div>
  </div>`;
}

function itemHTML(it) {
  if (it.kind === "task") return taskHTML(it);
  if (it.kind === "habit") return habitHTML(it);
  return goalHTML(it);
}

function itemHead(it) {
  const tags = [];
  if (it.cadence && (it.cadence.times?.length || it.cadence.intervalMin)) {
    tags.push(`<span class="tag">${icon("i-clock")}${escapeHTML(cadenceSummary(it.cadence))}</span>`);
  }
  const due = it.kind === "goal" ? it.goal?.dueDate : it.dueDate;
  if (due) tags.push(`<span class="tag">${icon("i-calendar")}${escapeHTML(due)}</span>`);
  return tags.join("");
}

function actionsHTML(it) {
  return `<div class="item__actions">
    <button class="btn btn--icon" type="button" aria-label="编辑" data-action="edit-item" data-id="${it.id}">${icon("i-pencil")}</button>
    <button class="btn btn--icon" type="button" aria-label="删除" data-action="delete-item" data-id="${it.id}">${icon("i-trash")}</button>
  </div>`;
}

function taskHTML(it) {
  const meta = itemHead(it);
  return `<article class="item ${it.done ? "is-done" : ""}">
    <button class="check" type="button" role="checkbox" aria-checked="${!!it.done}" aria-label="完成 ${escapeHTML(it.title)}" data-action="toggle-task" data-id="${it.id}">${icon("i-check")}</button>
    <div class="item__body">
      <span class="item__title">${escapeHTML(it.title)}</span>
      ${it.notes ? `<span class="item__notes">${escapeHTML(it.notes)}</span>` : ""}
      ${meta ? `<span class="item__meta">${meta}</span>` : ""}
    </div>
    ${actionsHTML(it)}
  </article>`;
}

function habitHTML(it) {
  const count = store.countToday(it.id);
  const expected = Math.max(1, slotsForItem(it, new Date()).length || 1);
  const streakN = store.streak(it.id);
  const frac = Math.min(1, count / expected);
  const C = 2 * Math.PI * 18;
  const ring = `<span class="ring ${frac >= 1 ? "is-complete" : ""}">
    <svg class="ring__svg" viewBox="0 0 44 44" aria-hidden="true">
      <circle class="ring__track" cx="22" cy="22" r="18"></circle>
      <circle class="ring__value" cx="22" cy="22" r="18" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"></circle>
    </svg>
    <span class="ring__num">${count}<span style="color:var(--text-tertiary)">/${expected}</span></span>
  </span>`;
  return `<article class="item">
    ${ring}
    <div class="item__body">
      <span class="item__title">${escapeHTML(it.title)}</span>
      ${it.notes ? `<span class="item__notes">${escapeHTML(it.notes)}</span>` : ""}
      <span class="item__meta">
        ${streakN > 0 ? `<span class="tag tag--success">${icon("i-flame")}连续 ${streakN} 天</span>` : `<span class="tag">今日未打卡</span>`}
        ${itemHead(it)}
      </span>
    </div>
    <div class="item__actions">
      <button class="btn btn--icon" type="button" aria-label="打卡" title="打卡 +1" data-action="check-habit" data-id="${it.id}" ${frac >= 1 ? "disabled" : ""}>${icon("i-plus")}</button>
      <button class="btn btn--icon" type="button" aria-label="撤销打卡" title="撤销" data-action="undo-habit" data-id="${it.id}" ${count === 0 ? "disabled" : ""}>${icon("i-x")}</button>
      <button class="btn btn--icon" type="button" aria-label="编辑" data-action="edit-item" data-id="${it.id}">${icon("i-pencil")}</button>
      <button class="btn btn--icon" type="button" aria-label="删除" data-action="delete-item" data-id="${it.id}">${icon("i-trash")}</button>
    </div>
  </article>`;
}

function goalProgress(goal) {
  const target = Number(goal.target) || 0;
  const current = Number(goal.current) || 0;
  let pct, remaining, remLabel;
  if (goal.direction === "decrease") {
    pct = current <= target ? 100 : (current > 0 ? (target / current) * 100 : 0);
    remaining = Math.max(0, current - target);
    remLabel = remaining > 0 ? `还需减少 ${remaining}${goal.unit || ""}` : "已达成";
  } else {
    pct = target > 0 ? (current / target) * 100 : (current > 0 ? 100 : 0);
    remaining = Math.max(0, target - current);
    remLabel = remaining > 0 ? `还差 ${remaining}${goal.unit || ""}` : "已达成";
  }
  pct = Math.max(0, Math.min(100, pct));
  return { pct, remLabel, current, target };
}

function goalHTML(it) {
  const g = it.goal || {};
  const { pct, remLabel, current, target } = goalProgress(g);
  const dirIcon = g.direction === "decrease" ? "i-arrow-down" : "i-arrow-up";
  return `<article class="item">
    <span class="emblem" style="--emblem:var(--accent)">${icon(KIND_ICON.goal)}</span>
    <div class="item__body">
      <span class="item__title">${escapeHTML(it.title)}</span>
      <span class="progress">
        <span class="progress__bar"><span class="progress__fill ${pct >= 100 ? "is-complete" : ""}" style="width:${pct.toFixed(1)}%"></span></span>
        <span class="progress__row">
          <span class="use-num">${current} / ${target}${escapeHTML(g.unit || "")}</span>
          <span class="tag ${pct >= 100 ? "tag--success" : "tag--accent"}">${icon(dirIcon)}${pct.toFixed(0)}%</span>
        </span>
        <span class="item__meta">${escapeHTML(remLabel)}${itemHead(it)}</span>
      </span>
    </div>
    ${actionsHTML(it)}
  </article>`;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function cadenceSummary(c) {
  const parts = [];
  if (c.times?.length) parts.push(c.times.join(" · "));
  if (Number(c.intervalMin) > 0 && c.windowStart && c.windowEnd) {
    parts.push(`每 ${c.intervalMin} 分钟 ${c.windowStart}–${c.windowEnd}`);
  }
  const days = c.days || [];
  if (days.length && days.length < 7) {
    parts.push([...days].sort((a, b) => a - b).map((d) => "周" + DAY_LABELS[d]).join(""));
  }
  return parts.join("，") || "未设置";
}

/* --------------------------- missed banner --------------------------- */

function renderMissed() {
  const banner = el("missed");
  const dismissed = state().settings.dismissedMissed === todayStr();
  const missed = dismissed ? [] : missedSlots(state());
  if (!missed.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const mods = new Map(state().modules.map((m) => [m.id, m]));
  const chips = missed.map((s) => `<button class="banner__chip" type="button" data-action="missed-item" data-id="${s.item.id}">
    <b>${s.time}</b><span>${escapeHTML(s.item.title)}</span>
    <span style="color:var(--text-tertiary)">${escapeHTML(mods.get(s.item.moduleId)?.name || "")}</span>
  </button>`).join("");
  banner.hidden = false;
  banner.innerHTML = `<div class="banner__head">
      <span class="banner__title">${icon("i-bell-off")}错过的提醒（${missed.length}）</span>
      <button class="btn btn--ghost" type="button" data-action="dismiss-missed">今日忽略</button>
    </div>
    <div class="banner__list">${chips}</div>`;
}

/* --------------------------- header buttons --------------------------- */

function renderNotifyButton() {
  const btn = el("btn-notify");
  if (!notifySupported()) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const p = permission();
  btn.classList.toggle("is-on", p === "granted");
  btn.setAttribute("aria-pressed", p === "granted");
  const label = p === "granted" ? "通知已开启" : p === "denied" ? "通知被拒绝（点击查看）" : "启用提醒通知";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = icon(p === "granted" ? "i-bell" : "i-bell-off");
}

function renderInstallButton() {
  let btn = el("btn-install");
  if (!deferredInstall) {
    if (btn) btn.remove();
    return;
  }
  if (btn) return;
  btn = document.createElement("button");
  btn.id = "btn-install";
  btn.className = "btn btn--ghost";
  btn.type = "button";
  btn.textContent = "安装";
  btn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    renderInstallButton();
  });
  el("modules").prepend(btn);
}

/* --------------------------- interactions --------------------------- */
async function onNotifyButton() {
  const p = permission();
  if (p === "granted") {
    toast("通知已开启");
    return;
  }
  if (p === "denied") {
    toast("通知被浏览器拒绝，请在地址栏权限设置中允许");
    return;
  }
  const res = await requestPermission();
  render();
  toast(res === "granted" ? "通知已开启，提醒将在本页打开时推送" : "未开启通知，仍可查看「错过的提醒」");
}

function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const cur = state().settings.theme || "auto";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  store.setSettings({ theme: next });
  applyTheme();
  toast(`主题：${{ auto: "跟随系统", light: "浅色", dark: "深色" }[next]}`);
}

export function applyTheme() {
  const t = state().settings.theme || "auto";
  const dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  el("btn-theme").innerHTML = icon(dark ? "i-moon" : "i-sun");
  el("btn-theme").setAttribute("aria-label", dark ? "当前深色，切换主题" : "当前浅色，切换主题");
}

function onAppClick(ev) {
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  const act = btn.dataset.action;
  const id = btn.dataset.id;
  switch (act) {
    case "select-module":
      selectedModuleId = btn.dataset.module === "all" ? null : btn.dataset.module;
      render();
      break;
    case "add-module":
      openModuleSheet(null);
      break;
    case "edit-module":
      openModuleSheet(store.getModule(id));
      break;
    case "delete-module":
      if (confirm("删除该模块？其中的待办/习惯/目标会一起删除。")) { store.deleteModule(id); toast("已删除模块"); }
      break;
    case "move-module":
      store.moveModule(id, Number(btn.dataset.delta));
      break;
    case "add-item":
      openItemSheet(btn.dataset.id, btn.dataset.kind, null);
      break;
    case "edit-item":
      openItemSheet(null, null, store.getItem(id));
      break;
    case "delete-item":
      if (confirm("删除这一条？")) { store.deleteItem(id); toast("已删除"); }
      break;
    case "toggle-task":
      store.toggleTask(id);
      break;
    case "check-habit":
      store.checkIn(id);
      break;
    case "undo-habit":
      store.undoCheckIn(id);
      break;
    case "missed-item":
      openItemSheet(null, null, store.getItem(id));
      break;
    case "dismiss-missed":
      store.setSettings({ dismissedMissed: todayStr() });
      break;
    default:
      break;
  }
}

/* ------------------------------- sheets ------------------------------- */

let activeSheet = null;

function closeSheet() {
  if (activeSheet) {
    activeSheet.remove();
    activeSheet = null;
    document.removeEventListener("keydown", onSheetKey);
  }
}

function onSheetKey(e) {
  if (e.key === "Escape") closeSheet();
}

function openSheet(title, bodyHTML, footHTML) {
  closeSheet();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
    <div class="sheet__head"><h2 class="sheet__title">${escapeHTML(title)}</h2>
      <button class="btn btn--icon" type="button" aria-label="关闭" data-close>${icon("i-x")}</button></div>
    <div class="sheet__body">${bodyHTML}</div>
    <div class="sheet__foot">${footHTML}</div>
  </section>`;
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSheet(); });
  scrim.querySelector("[data-close]").addEventListener("click", closeSheet);
  document.getElementById("sheet-root").appendChild(scrim);
  activeSheet = scrim;
  document.addEventListener("keydown", onSheetKey);
  return scrim;
}

function openModuleSheet(mod) {
  const editing = !!mod;
  const color = mod?.color || COLORS[0].hex;
  const emoji = mod?.emoji || EMOJIS[0];
  const colorsHTML = COLORS.map((c) =>
    `<button class="swatch" type="button" style="background:${c.hex}" aria-pressed="${c.hex === color}" aria-label="${c.name}" data-color="${c.hex}"></button>`).join("");
  const emojisHTML = EMOJIS.map((e) =>
    `<button class="emoji-opt" type="button" aria-pressed="${e === emoji}" data-emoji="${e}">${e}</button>`).join("");
  const body = `
    <label class="field"><span class="field__label">模块名称</span>
      <input class="input" id="m-name" type="text" maxlength="24" placeholder="例如：健身" value="${editing ? escapeHTML(mod.name) : ""}">
    </label>
    <div class="field"><span class="field__label">颜色</span><div class="colors">${colorsHTML}</div></div>
    <div class="field"><span class="field__label">图标</span><div class="emojis">${emojisHTML}</div>
      <span class="field__hint">图标会显示在模块标签与标题上。</span></div>`;
  const foot = `${editing ? `<button class="btn btn--danger sheet__danger" type="button" data-del>删除</button>` : ""}
    <button class="btn btn--ghost" type="button" data-cancel>取消</button>
    <button class="btn btn--primary" type="button" data-save>保存</button>`;
  const scrim = openSheet(editing ? "编辑模块" : "新建模块", body, foot);
  const sheet = scrim.querySelector(".sheet");
  let pickedColor = color, pickedEmoji = emoji;

  sheet.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
    pickedColor = b.dataset.color;
    sheet.querySelectorAll("[data-color]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  sheet.querySelectorAll("[data-emoji]").forEach((b) => b.addEventListener("click", () => {
    pickedEmoji = b.dataset.emoji;
    sheet.querySelectorAll("[data-emoji]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  sheet.querySelector("[data-cancel]").addEventListener("click", closeSheet);
  const delBtn = sheet.querySelector("[data-del]");
  if (delBtn) delBtn.addEventListener("click", () => {
    if (confirm("删除该模块？")) { store.deleteModule(mod.id); toast("已删除模块"); closeSheet(); }
  });
  sheet.querySelector("[data-save]").addEventListener("click", () => {
    const name = sheet.querySelector("#m-name").value.trim();
    if (!name) { toast("请填写模块名称"); return; }
    if (editing) { store.updateModule(mod.id, { name, color: pickedColor, emoji: pickedEmoji }); toast("已保存"); }
    else { const m = store.addModule({ name, color: pickedColor, emoji: pickedEmoji }); selectedModuleId = m.id; toast("已创建模块"); }
    closeSheet();
  });
  sheet.querySelector("#m-name").focus();
}

function cadenceFieldsHTML(c = {}) {
  const days = c.days || [];
  const dayBtns = ALL_DAYS.map((d) =>
    `<button class="day" type="button" aria-pressed="${days.includes(d)}" data-day="${d}">${DAY_LABELS[d]}</button>`).join("");
  return `<div class="field"><span class="field__label">固定时间</span>
      <input class="input" id="c-times" type="text" placeholder="09:00, 12:00, 18:00" value="${escapeHTML((c.times || []).join(", "))}">
      <span class="field__hint">用逗号分隔，24 小时制。</span></div>
    <div class="field"><span class="field__label">间隔提醒</span>
      <div class="field__row">
        <input class="input" id="c-every" type="number" min="0" step="5" placeholder="每 N 分钟" value="${c.intervalMin || ""}">
        <input class="input" id="c-ws" type="time" value="${escapeHTML(c.windowStart || "")}">
        <input class="input" id="c-we" type="time" value="${escapeHTML(c.windowEnd || "")}">
      </div>
      <span class="field__hint">例如：每 30 分钟，08:00–22:00（喝水提醒）。</span></div>
    <div class="field"><span class="field__label">重复</span><div class="toggle-row">${dayBtns}</div>
      <span class="field__hint">不选 = 每天。</span></div>`;
}

function readCadence(sheet) {
  const times = (sheet.querySelector("#c-times").value || "")
    .split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const every = Number(sheet.querySelector("#c-every").value) || 0;
  const days = [...sheet.querySelectorAll("[data-day]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.day));
  return {
    times,
    intervalMin: every,
    windowStart: sheet.querySelector("#c-ws").value || "",
    windowEnd: sheet.querySelector("#c-we").value || "",
    days,
  };
}

function openItemSheet(moduleId, kind, item) {
  const editing = !!item;
  const theKind = item?.kind || kind || "task";
  const mods = store.liveModules();
  if (!mods.length) { toast("请先创建模块"); return; }
  const theModuleId = item?.moduleId || moduleId || mods[0].id;

  const moduleOptions = mods.map((m) => `<option value="${m.id}" ${m.id === theModuleId ? "selected" : ""}>${escapeHTML(m.emoji + " " + m.name)}</option>`).join("");
  const kindTabs = ["task", "habit", "goal"].map((k) =>
    `<button class="chip" type="button" aria-pressed="${k === theKind}" data-kind="${k}" ${editing ? "disabled" : ""}>${icon(KIND_ICON[k])}${KIND_LABEL[k]}</button>`).join("");

  let extra = "";
  if (theKind === "task") {
    extra = `<label class="field"><span class="field__label">截止日期（可选）</span>
        <input class="input" id="i-due" type="date" value="${escapeHTML(item?.dueDate || "")}"></label>
      <label class="field"><span class="field__label"><input type="checkbox" id="i-has-cadence" ${item?.cadence ? "checked" : ""}> 添加提醒排程</span></label>
      <div class="cadence" id="i-cadence" ${item?.cadence ? "" : "hidden"}>${cadenceFieldsHTML(item?.cadence || {})}</div>`;
  } else if (theKind === "habit") {
    extra = `<div class="cadence" id="i-cadence">${cadenceFieldsHTML(item?.cadence || {})}</div>`;
  } else {
    const g = item?.goal || {};
    extra = `<div class="field__row">
        <label class="field"><span class="field__label">当前值</span><input class="input" id="g-current" type="number" step="any" value="${g.current ?? 0}"></label>
        <label class="field"><span class="field__label">目标值</span><input class="input" id="g-target" type="number" step="any" value="${g.target ?? 100}"></label>
        <label class="field"><span class="field__label">单位</span><input class="input" id="g-unit" type="text" placeholder="次 / 本 / 元" value="${escapeHTML(g.unit || "")}"></label>
      </div>
      <div class="field__row">
        <label class="field"><span class="field__label">方向</span>
          <select class="select" id="g-dir"><option value="increase" ${g.direction !== "decrease" ? "selected" : ""}>增加</option><option value="decrease" ${g.direction === "decrease" ? "selected" : ""}>减少</option></select></label>
        <label class="field"><span class="field__label">截止日期（可选）</span><input class="input" id="g-due" type="date" value="${escapeHTML(g.dueDate || "")}"></label>
      </div>`;
  }

  const body = `
    <div class="field"><span class="field__label">类型</span><div class="kind-tabs">${kindTabs}</div></div>
    <label class="field"><span class="field__label">所属模块</span>
      <select class="select" id="i-module">${moduleOptions}</select></label>
    <label class="field"><span class="field__label">标题</span>
      <input class="input" id="i-title" type="text" maxlength="60" placeholder="例如：跑步 5 公里" value="${editing ? escapeHTML(item.title) : ""}"></label>
    <label class="field"><span class="field__label">备注（可选）</span>
      <textarea class="textarea" id="i-notes" maxlength="500">${editing ? escapeHTML(item.notes || "") : ""}</textarea></label>
    ${extra}`;

  const foot = `${editing ? `<button class="btn btn--danger sheet__danger" type="button" data-del>删除</button>` : ""}
    <button class="btn btn--ghost" type="button" data-cancel>取消</button>
    <button class="btn btn--primary" type="button" data-save>保存</button>`;

  const scrim = openSheet(editing ? "编辑" : `新建${KIND_LABEL[theKind]}`, body, foot);
  const sheet = scrim.querySelector(".sheet");
  let currentKind = theKind;

  sheet.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    if (editing) return;
    currentKind = b.dataset.kind;
    closeSheet();
    openItemSheet(theModuleId, currentKind, null);
  }));
  sheet.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
  }));
  const hasCad = sheet.querySelector("#i-has-cadence");
  if (hasCad) hasCad.addEventListener("change", () => {
    sheet.querySelector("#i-cadence").hidden = !hasCad.checked;
  });
  sheet.querySelector("[data-cancel]").addEventListener("click", closeSheet);
  const delBtn = sheet.querySelector("[data-del]");
  if (delBtn) delBtn.addEventListener("click", () => {
    if (confirm("删除这一条？")) { store.deleteItem(item.id); toast("已删除"); closeSheet(); }
  });

  sheet.querySelector("[data-save]").addEventListener("click", () => {
    const title = sheet.querySelector("#i-title").value.trim();
    if (!title) { toast("请填写标题"); return; }
    const patch = { title, notes: sheet.querySelector("#i-notes").value.trim(), moduleId: sheet.querySelector("#i-module").value };
    if (currentKind === "task") {
      patch.dueDate = sheet.querySelector("#i-due").value || "";
      const on = sheet.querySelector("#i-has-cadence").checked;
      patch.cadence = on ? readCadence(sheet) : null;
    } else if (currentKind === "habit") {
      patch.cadence = readCadence(sheet);
    } else {
      patch.goal = {
        current: Number(sheet.querySelector("#g-current").value) || 0,
        target: Number(sheet.querySelector("#g-target").value) || 0,
        unit: sheet.querySelector("#g-unit").value.trim(),
        direction: sheet.querySelector("#g-dir").value,
        dueDate: sheet.querySelector("#g-due").value || "",
      };
    }
    if (editing) { store.updateItem(item.id, patch); toast("已保存"); }
    else { store.addItem(patch.moduleId, currentKind, patch); toast("已添加"); }
    closeSheet();
  });
  sheet.querySelector("#i-title").focus();
}

/* --------------------------- files / toast --------------------------- */

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportData() {
  download(`cadence-${stamp()}.json`, store.exportJSON(), "application/json");
  toast("已导出 JSON");
}

function exportICS() {
  download(`cadence-${stamp()}.ics`, generateICS(state()), "text/calendar");
  toast("已导出日历 (.ics)，可导入手机日历");
}

async function importData(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const stats = store.importJSON(text);
    toast(`导入完成：新增 ${stats.added}，更新 ${stats.updated}，未变 ${stats.unchanged}`);
  } catch (err) {
    toast("导入失败：" + err.message);
  }
}

export function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
