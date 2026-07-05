/**
 * clock.js
 * ---------------------------------------------------------------------------
 * Pure, framework-agnostic chess-clock state machine.
 *
 * This module has NO dependency on the DOM, Electron, or any browser API.
 * It only deals with plain data (a "state" object) and pure functions that
 * transform that data. Because of this, it can be imported unmodified by:
 *   - the web app (web/app.js)
 *   - the Electron desktop app (electron/desktop.js)
 *
 * State shape:
 * {
 *   durationsMs: { studyMs: number, restMs: number },   // configured lengths
 *   remainingMs: { studyMs: number, restMs: number },   // time left on each side
 *   activeSide: null | "study" | "rest",                // which side is "up"
 *   isRunning: boolean,                                  // is the active side counting down
 *   lastUpdatedAt: number | null,                        // Date.now() of last tick start
 *   settings: {
 *     soundEnabled: boolean,       // switch-click + expiration chime
 *     tickEnabled: boolean,        // soft ticking while running
 *     notificationsEnabled: boolean,
 *     keepAwakeEnabled: boolean,
 *     volume: number,              // 0..1
 *     opacity: number,             // 0.6..1 (desktop overlay only, harmless on web)
 *   }
 * }
 */

export const SIDES = Object.freeze({
  STUDY: "study",
  REST: "rest",
});

export const DEFAULT_STUDY_MS = 25 * 60 * 1000;
export const DEFAULT_REST_MS = 5 * 60 * 1000;

const MIN_SIDE_DURATION_MS = 5 * 1000; // never allow a side to be configured below 5s
const MAX_SIDE_DURATION_MS = 999 * 60 * 1000; // guard against absurd input (999m)

/** A brand-new state, as if the app was opened for the very first time. */
export function createDefaultState() {
  return {
    durationsMs: { studyMs: DEFAULT_STUDY_MS, restMs: DEFAULT_REST_MS },
    remainingMs: { studyMs: DEFAULT_STUDY_MS, restMs: DEFAULT_REST_MS },
    activeSide: null,
    isRunning: false,
    lastUpdatedAt: null,
    settings: {
      soundEnabled: true,
      tickEnabled: true,
      notificationsEnabled: false,
      keepAwakeEnabled: false,
      volume: 0.6,
      opacity: 1,
    },
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampDuration(ms) {
  if (!Number.isFinite(ms)) return MIN_SIDE_DURATION_MS;
  return clamp(Math.round(ms), MIN_SIDE_DURATION_MS, MAX_SIDE_DURATION_MS);
}

/**
 * Take any (possibly partial, possibly corrupt) object loaded from storage
 * and return a fully-shaped, safe state object. This is the single place
 * that guards against malformed persisted data.
 */
export function normalizeState(raw) {
  const fallback = createDefaultState();
  const input = raw && typeof raw === "object" ? raw : {};

  const durationsMs = {
    studyMs: clampDuration(input.durationsMs?.studyMs ?? fallback.durationsMs.studyMs),
    restMs: clampDuration(input.durationsMs?.restMs ?? fallback.durationsMs.restMs),
  };

  const remainingMsInput = input.remainingMs && typeof input.remainingMs === "object" ? input.remainingMs : {};
  const remainingMs = {
    studyMs: clamp(
      Number.isFinite(remainingMsInput.studyMs) ? remainingMsInput.studyMs : durationsMs.studyMs,
      0,
      durationsMs.studyMs
    ),
    restMs: clamp(
      Number.isFinite(remainingMsInput.restMs) ? remainingMsInput.restMs : durationsMs.restMs,
      0,
      durationsMs.restMs
    ),
  };

  const activeSide = input.activeSide === SIDES.STUDY || input.activeSide === SIDES.REST ? input.activeSide : null;
  const isRunning = Boolean(input.isRunning) && activeSide !== null;
  const lastUpdatedAt = isRunning && Number.isFinite(input.lastUpdatedAt) ? input.lastUpdatedAt : null;

  const settingsInput = input.settings && typeof input.settings === "object" ? input.settings : {};
  const settings = {
    soundEnabled: settingsInput.soundEnabled !== false,
    tickEnabled: settingsInput.tickEnabled !== false,
    notificationsEnabled: Boolean(settingsInput.notificationsEnabled),
    keepAwakeEnabled: Boolean(settingsInput.keepAwakeEnabled),
    volume: Number.isFinite(settingsInput.volume) ? clamp(settingsInput.volume, 0, 1) : fallback.settings.volume,
    opacity: Number.isFinite(settingsInput.opacity) ? clamp(settingsInput.opacity, 0.4, 1) : fallback.settings.opacity,
  };

  return {
    durationsMs,
    remainingMs,
    activeSide,
    isRunning: isRunning && !(lastUpdatedAt === null && isRunning), // isRunning requires a timestamp
    lastUpdatedAt,
    settings,
  };
}

/**
 * Given a normalized state and the current timestamp, compute the "live"
 * view of the clock: how much time is actually left on each side right now,
 * and whether a side has just hit zero.
 *
 * This function does NOT mutate anything and does NOT persist. Callers are
 * responsible for saving the returned `state` if they want the expiration
 * (side stopped, activeSide cleared) to stick.
 *
 * @returns {{ state: object, expiredSide: null|"study"|"rest" }}
 */
export function deriveCurrentState(normalized, now = Date.now()) {
  const state = normalizeState(normalized);

  if (!state.isRunning || !state.activeSide) {
    return { state, expiredSide: null };
  }

  const key = state.activeSide === SIDES.STUDY ? "studyMs" : "restMs";
  const elapsed = Math.max(0, now - (state.lastUpdatedAt ?? now));
  const nextRemaining = state.remainingMs[key] - elapsed;

  if (nextRemaining <= 0) {
    const expiredSide = state.activeSide;
    return {
      state: {
        ...state,
        remainingMs: { ...state.remainingMs, [key]: 0 },
        activeSide: null,
        isRunning: false,
        lastUpdatedAt: null,
      },
      expiredSide,
    };
  }

  return {
    state: {
      ...state,
      remainingMs: { ...state.remainingMs, [key]: nextRemaining },
      lastUpdatedAt: now,
    },
    expiredSide: null,
  };
}

/** Start (or resume) the given side. Automatically "pauses" the other side, chess-clock style. */
export function startSide(normalized, side, now = Date.now()) {
  const { state } = deriveCurrentState(normalized, now);
  const key = side === SIDES.STUDY ? "studyMs" : "restMs";
  if (state.remainingMs[key] <= 0) {
    return state; // can't start a side that's already at zero
  }
  return {
    ...state,
    activeSide: side,
    isRunning: true,
    lastUpdatedAt: now,
  };
}

/** Pause whichever side is currently running. No-op if nothing is running. */
export function pauseActive(normalized, now = Date.now()) {
  const { state } = deriveCurrentState(normalized, now);
  if (!state.isRunning) return state;
  return { ...state, isRunning: false, lastUpdatedAt: null };
}

/** Resume the previously-active side, if any time remains on it. */
export function resumeActive(normalized, now = Date.now()) {
  const { state } = deriveCurrentState(normalized, now);
  if (state.isRunning || !state.activeSide) return state;
  const key = state.activeSide === SIDES.STUDY ? "studyMs" : "restMs";
  if (state.remainingMs[key] <= 0) return state;
  return { ...state, isRunning: true, lastUpdatedAt: now };
}

/** Reset both sides back to their configured durations and stop the clock. */
export function resetClock(normalized) {
  const state = normalizeState(normalized);
  return {
    ...state,
    remainingMs: { studyMs: state.durationsMs.studyMs, restMs: state.durationsMs.restMs },
    activeSide: null,
    isRunning: false,
    lastUpdatedAt: null,
  };
}

/**
 * Update configured durations (from the settings form). If the clock is not
 * currently running, remaining time is snapped to match the new durations so
 * the change takes effect immediately. If it IS running, only the inactive
 * side's remaining time is updated, so we never yank time out from under an
 * in-progress side.
 */
export function updateDurations(normalized, durationsMs, now = Date.now()) {
  const { state } = deriveCurrentState(normalized, now);
  const nextDurations = {
    studyMs: clampDuration(durationsMs.studyMs),
    restMs: clampDuration(durationsMs.restMs),
  };

  const nextRemaining = { ...state.remainingMs };
  if (!state.isRunning) {
    nextRemaining.studyMs = nextDurations.studyMs;
    nextRemaining.restMs = nextDurations.restMs;
  } else if (state.activeSide === SIDES.STUDY) {
    nextRemaining.restMs = nextDurations.restMs;
  } else if (state.activeSide === SIDES.REST) {
    nextRemaining.studyMs = nextDurations.studyMs;
  }

  return { ...state, durationsMs: nextDurations, remainingMs: nextRemaining };
}

/** Merge partial settings into state.settings. */
export function updateSettings(normalized, partialSettings) {
  const state = normalizeState(normalized);
  return { ...state, settings: { ...state.settings, ...partialSettings } };
}

// ----------------------------- formatting ----------------------------------

/** Format milliseconds as `mm:ss`, or `h:mm:ss` once an hour is exceeded. */
export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Split milliseconds into { minutes, seconds } for populating settings inputs. */
export function splitMilliseconds(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

/** Inverse of splitMilliseconds: turn form input strings/numbers into clamped ms. */
export function millisecondsFromMinutesAndSeconds(minutes, seconds) {
  const m = Number.parseInt(minutes, 10);
  const s = Number.parseInt(seconds, 10);
  const safeMinutes = Number.isFinite(m) && m >= 0 ? m : 0;
  const safeSeconds = Number.isFinite(s) && s >= 0 ? s : 0;
  return clampDuration(safeMinutes * 60 * 1000 + safeSeconds * 1000);
}
