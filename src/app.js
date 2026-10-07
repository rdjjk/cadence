// src/app.js — bootstrap. Wires the store, UI, scheduler and service worker.

import * as store from "./store.js";
import { initUI, applyTheme, refreshUI, toast } from "./ui.js";
import { startScheduler, notifySupported, permission } from "./reminders.js";

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("[cadence] SW registration failed:", err);
    });
  });
}

function boot() {
  applyTheme();
  initUI();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((store.getState().settings.theme || "auto") === "auto") applyTheme();
  });

  startScheduler(store.getState, store.markFiredMany, {
    onChange: ({ due, notified }) => {
      if (due.length && notified.length === 0) {
        const names = [...new Set(due.map((d) => d.item.title))].join("、");
        toast(`提醒：${names}`);
      }
    },
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshUI();
  });

  if (notifySupported() && permission() === "default") {
    console.info("[cadence] 提示：点击右上角铃铛按钮启用浏览器通知提醒。");
  }

  registerSW();
}

boot();
