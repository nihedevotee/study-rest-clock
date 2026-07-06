/**
 * app.js — Web build controller.
 * ---------------------------------------------------------------------------
 * This file only knows about the DOM and browser APIs (Notifications,
 * Fullscreen, Wake Lock, Service Worker). All timer/state logic lives in
 * ./shared/clock.js, all audio in ./shared/sound-engine.js, and persistence
 * in ./shared/storage.js — none of which know this is a web page.
 *
 * The Electron build (electron/desktop.js) follows the exact same pattern,
 * so if you're comparing the two: the DUPLICATED part is intentionally thin
 * (DOM wiring + platform APIs), and the SHARED part is everything that
 * actually defines how the clock behaves.
 */

import {
  SIDES,
  createDefaultState,
  normalizeState,
  deriveCurrentState,
  startSide,
  pauseActive,
  resumeActive,
  resetClock,
  updateDurations,
  updateSettings,
  formatClock,
  splitMilliseconds,
  millisecondsFromMinutesAndSeconds,
} from "./shared/clock.js";
import { SoundEngine } from "./shared/sound-engine.js";
import { loadRawState, saveRawState } from "./shared/storage.js";

const elements = {
  brand: document.getElementById("brand"),
  statusText: document.getElementById("statusText"),
  studyPanel: document.getElementById("studyPanel"),
  restPanel: document.getElementById("restPanel"),
  studyTime: document.getElementById("studyTime"),
  restTime: document.getElementById("restTime"),
  studyPill: document.getElementById("studyPill"),
  restPill: document.getElementById("restPill"),
  pauseResumeBtn: document.getElementById("pauseResumeBtn"),
  resetBtn: document.getElementById("resetBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  settingsToggleBtn: document.getElementById("settingsToggleBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  studyMinutes: document.getElementById("studyMinutes"),
  studySeconds: document.getElementById("studySeconds"),
  restMinutes: document.getElementById("restMinutes"),
  restSeconds: document.getElementById("restSeconds"),
  soundEnabled: document.getElementById("soundEnabled"),
  tickEnabled: document.getElementById("tickEnabled"),
  notificationsEnabled: document.getElementById("notificationsEnabled"),
  keepAwakeEnabled: document.getElementById("keepAwakeEnabled"),
  volumeRange: document.getElementById("volumeRange"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  requestNotifyBtn: document.getElementById("requestNotifyBtn"),
  popoutBtn: document.getElementById("popoutBtn"),
  toast: document.getElementById("toast"),
};

let state = normalizeState(loadRawState() ?? createDefaultState());
let wakeLockSentinel = null;
let refreshTimer = null;

const soundEngine = new SoundEngine({ getSettings: () => state.settings });

// ------------------------------- helpers ------------------------------------

function persist() {
  saveRawState(state);
}

function showToast(message, ms = 2400) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, ms);
}

function setPanelState(panel, isActive, isRunning) {
  panel.classList.toggle("is-active", isActive);
  panel.classList.toggle("is-running", isActive && isRunning);
}

// -------------------------------- render -------------------------------------

function renderClock() {
  elements.studyTime.textContent = formatClock(state.remainingMs.studyMs);
  elements.restTime.textContent = formatClock(state.remainingMs.restMs);

  elements.studyPill.textContent =
    state.activeSide === SIDES.STUDY ? (state.isRunning ? "Running" : "Paused") : "Ready";
  elements.restPill.textContent =
    state.activeSide === SIDES.REST ? (state.isRunning ? "Running" : "Paused") : "Ready";

  setPanelState(elements.studyPanel, state.activeSide === SIDES.STUDY, state.isRunning);
  setPanelState(elements.restPanel, state.activeSide === SIDES.REST, state.isRunning);

  elements.pauseResumeBtn.textContent = state.isRunning ? "Pause" : "Resume";
  elements.pauseResumeBtn.disabled = !state.activeSide;

  elements.brand.classList.toggle("active-study", state.activeSide === SIDES.STUDY && state.isRunning);
  elements.brand.classList.toggle("active-rest", state.activeSide === SIDES.REST && state.isRunning);

  const label = !state.activeSide
    ? "Study Rest Clock"
    : `${state.isRunning ? "Running" : "Paused"} · ${state.activeSide === SIDES.STUDY ? "Study" : "Rest"}`;
  elements.statusText.textContent = label;
  document.title = `${formatClock(state.remainingMs.studyMs)} / ${formatClock(state.remainingMs.restMs)} — Study Rest Clock`;
}

function renderSettings() {
  const studyParts = splitMilliseconds(state.durationsMs.studyMs);
  const restParts = splitMilliseconds(state.durationsMs.restMs);
  elements.studyMinutes.value = String(studyParts.minutes);
  elements.studySeconds.value = String(studyParts.seconds).padStart(2, "0");
  elements.restMinutes.value = String(restParts.minutes);
  elements.restSeconds.value = String(restParts.seconds).padStart(2, "0");
  elements.soundEnabled.checked = state.settings.soundEnabled;
  elements.tickEnabled.checked = state.settings.tickEnabled;
  elements.notificationsEnabled.checked = state.settings.notificationsEnabled;
  elements.keepAwakeEnabled.checked = state.settings.keepAwakeEnabled;
  elements.volumeRange.value = String(Math.round(state.settings.volume * 100));
}

function renderAll() {
  renderClock();
  renderSettings();
  syncTicking();
}

function syncTicking() {
  if (state.isRunning) {
    soundEngine.startTicking();
  } else {
    soundEngine.stopTicking();
  }
}

// ------------------------------- side effects --------------------------------

async function notifyExpiration(side) {
  const title = side === SIDES.STUDY ? "Study timer finished" : "Rest timer finished";
  const body =
    side === SIDES.STUDY
      ? "Your study session has ended. Switch to rest or reset the clock."
      : "Your rest session has ended. Switch back to study or reset the clock.";

  if (state.settings.notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "assets/icon128.png" });
  } else {
    showToast(body, 5000);
  }

  if (state.settings.soundEnabled) {
    soundEngine.playChime();
  }
}

// -------------------------------- ticking loop --------------------------------

function tick() {
  const { state: nextState, expiredSide } = deriveCurrentState(state, Date.now());
  const wasRunning = state.isRunning;
  state = nextState;
  renderClock();

  if (wasRunning !== state.isRunning) {
    syncTicking();
  }

  if (expiredSide) {
    persist();
    notifyExpiration(expiredSide);
  } else if (state.isRunning) {
    persist();
  }
}

function startLiveRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(tick, 250);
}

// -------------------------------- actions -------------------------------------

function handleSideClick(side) {
  const wasSameRunningSide = state.activeSide === side && state.isRunning;
  state = startSide(state, side);
  if (!wasSameRunningSide && state.settings.soundEnabled) {
    soundEngine.playSwitchClick();
  }
  persist();
  renderAll();
}

function handlePauseResume() {
  state = state.isRunning ? pauseActive(state) : resumeActive(state);
  persist();
  renderAll();
}

function handleReset() {
  state = resetClock(state);
  persist();
  renderAll();
  showToast("Clock reset");
}

function handleSaveSettings() {
  const durationsMs = {
    studyMs: millisecondsFromMinutesAndSeconds(elements.studyMinutes.value, elements.studySeconds.value),
    restMs: millisecondsFromMinutesAndSeconds(elements.restMinutes.value, elements.restSeconds.value),
  };

  state = updateDurations(state, durationsMs);
  state = updateSettings(state, {
    soundEnabled: elements.soundEnabled.checked,
    tickEnabled: elements.tickEnabled.checked,
    notificationsEnabled: elements.notificationsEnabled.checked,
    keepAwakeEnabled: elements.keepAwakeEnabled.checked,
    volume: Number(elements.volumeRange.value) / 100,
  });

  persist();
  renderAll();
  showToast("Settings saved");
  elements.settingsPanel.hidden = true;

  if (state.settings.keepAwakeEnabled) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("Notifications aren't supported in this browser");
    return;
  }
  const result = await Notification.requestPermission();
  state = updateSettings(state, { notificationsEnabled: result === "granted" });
  persist();
  renderSettings();
  showToast(result === "granted" ? "Notifications enabled" : "Notifications were not enabled");
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    showToast("Fullscreen was blocked by the browser");
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return false;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

// -------------------------------- pop-out (Picture-in-Picture) -----------------

async function popOut() {
  if (!("documentPictureInPicture" in window)) {
    showToast("Pop-out mode needs Chrome or Edge");
    return;
  }

  const clockEl = document.getElementById("clockContainer");

  // Remember exactly where clockEl came from so we can put it back later,
  // even if other DOM siblings shift around while it's floating.
  const anchor = document.createComment("clock-anchor");
  clockEl.after(anchor);

  const pipWindow = await documentPictureInPicture.requestWindow({
    width: 320,
    height: 220,
  });

  pipWindow.document.body.classList.add("is-web");

  // Copy stylesheets into the floating window (it doesn't inherit the parent's CSS).
  [...document.styleSheets].forEach((sheet) => {
    try {
      const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      const style = document.createElement("style");
      style.textContent = css;
      pipWindow.document.head.appendChild(style);
    } catch (e) {
      // cross-origin stylesheets throw on .cssRules access — safe to skip
    }
  });

  pipWindow.document.body.appendChild(clockEl);

  pipWindow.addEventListener(
    "pagehide",
    () => {
      anchor.after(clockEl);
      anchor.remove();
    },
    { once: true }
  );
}

// -------------------------------- wiring ---------------------------------------

function bindEvents() {
  elements.studyPanel.addEventListener("click", () => handleSideClick(SIDES.STUDY));
  elements.restPanel.addEventListener("click", () => handleSideClick(SIDES.REST));
  elements.pauseResumeBtn.addEventListener("click", handlePauseResume);
  elements.resetBtn.addEventListener("click", handleReset);
  elements.saveSettingsBtn.addEventListener("click", handleSaveSettings);
  elements.requestNotifyBtn.addEventListener("click", requestNotificationPermission);
  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);
  elements.popoutBtn.addEventListener("click", popOut);

  elements.settingsToggleBtn.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
  });
  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsPanel.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.settings.keepAwakeEnabled && !wakeLockSentinel) {
      requestWakeLock();
    }
    tick();
  });

  window.addEventListener("beforeunload", persist);

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      handlePauseResume();
    } else if (event.key.toLowerCase() === "s") {
      handleSideClick(SIDES.STUDY);
    } else if (event.key.toLowerCase() === "r") {
      handleSideClick(SIDES.REST);
    } else if (event.key === "Escape") {
      if (!elements.settingsPanel.hidden) {
        elements.settingsPanel.hidden = true;
      } else {
        handleReset();
      }
    }
  });
}

async function init() {
  bindEvents();
  renderAll();
  startLiveRefresh();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (state.settings.keepAwakeEnabled) {
    await requestWakeLock();
  }
}

init().catch((error) => {
  console.error(error);
  elements.statusText.textContent = "Unable to load clock";
});