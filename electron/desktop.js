/**
 * desktop.js — Electron renderer controller.
 * ---------------------------------------------------------------------------
 * Mirrors web/app.js almost exactly. The only additions are the things that
 * only make sense for a floating always-on-top window: pinning, minimizing,
 * and opacity — all done through the `window.desktop` bridge exposed by
 * electron/preload.js. Every timer/sound/persistence import below comes
 * from web/shared, so the clock behaves identically in both builds.
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
} from "../web/shared/clock.js";
import { SoundEngine } from "../web/shared/sound-engine.js";
import { loadRawState, saveRawState } from "../web/shared/storage.js";

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
  pinBtn: document.getElementById("pinBtn"),
  minimizeBtn: document.getElementById("minimizeBtn"),
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
  opacityRange: document.getElementById("opacityRange"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  requestNotifyBtn: document.getElementById("requestNotifyBtn"),
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
  elements.opacityRange.value = String(Math.round(state.settings.opacity * 100));
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
    new Notification(title, { body });
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

function applyOpacity() {
  window.desktop?.setOpacity(state.settings.opacity);
  document.documentElement.style.opacity = String(state.settings.opacity);
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
    opacity: Number(elements.opacityRange.value) / 100,
  });

  persist();
  renderAll();
  applyOpacity();
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
    showToast("Notifications aren't supported here");
    return;
  }
  const result = await Notification.requestPermission();
  state = updateSettings(state, { notificationsEnabled: result === "granted" });
  persist();
  renderSettings();
  showToast(result === "granted" ? "Notifications enabled" : "Notifications were not enabled");
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

async function togglePin() {
  const nextState = await window.desktop?.toggleAlwaysOnTop();
  elements.pinBtn.classList.toggle("is-on", Boolean(nextState));
  showToast(nextState ? "Pinned on top" : "Unpinned");
}

// -------------------------------- wiring ---------------------------------------

function bindEvents() {
  elements.studyPanel.addEventListener("click", () => handleSideClick(SIDES.STUDY));
  elements.restPanel.addEventListener("click", () => handleSideClick(SIDES.REST));
  elements.pauseResumeBtn.addEventListener("click", handlePauseResume);
  elements.resetBtn.addEventListener("click", handleReset);
  elements.saveSettingsBtn.addEventListener("click", handleSaveSettings);
  elements.requestNotifyBtn.addEventListener("click", requestNotificationPermission);
  elements.pinBtn.addEventListener("click", togglePin);
  elements.minimizeBtn.addEventListener("click", () => window.desktop?.minimize());

  elements.settingsToggleBtn.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
  });
  elements.closeSettingsBtn.addEventListener("click", () => {
    elements.settingsPanel.hidden = true;
  });

  // Live opacity preview while dragging the slider, before "Save" is clicked.
  elements.opacityRange.addEventListener("input", () => {
    document.documentElement.style.opacity = String(Number(elements.opacityRange.value) / 100);
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
  applyOpacity();
  startLiveRefresh();

  const pinned = await window.desktop?.getAlwaysOnTop();
  elements.pinBtn.classList.toggle("is-on", Boolean(pinned));

  if (state.settings.keepAwakeEnabled) {
    await requestWakeLock();
  }
}

init().catch((error) => {
  console.error(error);
  elements.statusText.textContent = "Unable to load clock";
});
