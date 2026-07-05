/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Persistence layer. Deliberately uses plain `localStorage` rather than any
 * Electron-specific API (electron-store, fs, IPC, etc). This is what lets
 * clock.js's state be persisted identically whether the code is running in
 * a normal browser tab or inside an Electron renderer process — Electron's
 * renderer is just Chromium, so localStorage works there too, no IPC round
 * trip required.
 *
 * If a native/Electron build ever needs OS-level storage instead, swap the
 * implementation of these two functions only; nothing else in the app needs
 * to change.
 */

const STORAGE_KEY = "studyRestClock.state.v1";

export function loadRawState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRawState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
