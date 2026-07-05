# Study Rest Clock

A minimal Study ↔ Rest chess clock that stays visible above every other
window. Runs two ways from one codebase:

- **Desktop overlay (Electron)** — always-on-top, resizable, draggable,
  adjustable opacity, minimizes to the taskbar.
- **Web app** — installable PWA, deployable to Vercel as a static site.

## Why Electron over Tauri

Both can do an always-on-top, resizable, transparent overlay. Electron won
here for practical reasons specific to this project:

- The app is 100% JS/HTML/CSS already — Tauri's advantage (small binary, no
  Chromium bundle) is paid for with a Rust toolchain and a native shell
  layer you'd have to write from scratch. Nothing here needs Rust.
- `setOpacity`, `setAlwaysOnTop(true, "screen-saver")`, frameless drag
  regions, and `minimize()`/taskbar restore are one-line Electron APIs used
  directly in `electron/main.js`. Tauri can do all of this too, but through
  its Rust command layer — more moving parts for the same result.
- The old project was already Electron-based, so this keeps the mental
  model and dev workflow (`npm start`) familiar.

If binary size or memory footprint becomes a real problem later, the
`electron/` folder is the *only* thing that would need to be rewritten —
`web/` (all UI and logic) is framework-agnostic and would carry over as-is.

## Architecture

```
study-rest-clock/
├── web/                        ← Deploy this folder to Vercel
│   ├── index.html              Web app shell
│   ├── app.js                  Web-only controller (DOM + browser APIs)
│   ├── styles.css              Shared stylesheet (used by desktop too)
│   ├── manifest.webmanifest    PWA manifest
│   ├── sw.js                   Offline service worker
│   ├── assets/                 Icons
│   └── shared/                 ★ Framework-agnostic core, used by BOTH builds
│       ├── clock.js            Chess-clock state machine (pure functions)
│       ├── sound-engine.js     Web Audio tick/click/chime synthesis
│       └── storage.js          localStorage persistence
│
├── electron/                   ← Desktop-only
│   ├── main.js                 Main process: window, always-on-top, opacity, shortcuts
│   ├── preload.js              Safe bridge exposing window.desktop.*
│   ├── index.html              Desktop shell (reuses web/styles.css + web/shared)
│   ├── desktop.js              Desktop controller (same shape as web/app.js)
│   └── desktop.css             Small overrides (drag region, transparency)
│
├── package.json                Electron dev/build scripts
├── vercel.json                 Tells Vercel to serve web/ as-is (no build step)
└── README.md
```

**The rule this follows:** anything that defines *how the clock behaves*
(timer math, sounds, persistence) lives in `web/shared/` and is imported
unmodified by both builds. Anything that's inherently platform-specific
(DOM wiring, window chrome, OS APIs) is written once per platform
(`web/app.js` vs `electron/desktop.js`). Nothing Electron-specific ever
gets imported into `web/`, so the web build has zero Electron dependency
and deploys as pure static files.

## Running it

**Desktop app:**
```bash
npm install
npm start
```

**Web app, locally:**
```bash
npm run web
# serves web/ at http://localhost:5173
```

**Deploy to Vercel:**
Push this repo and import it in Vercel — `vercel.json` already points the
output directory at `web/`, so no build step or extra configuration is
needed. Alternatively, set the project's Root Directory to `web` in the
Vercel dashboard and delete `vercel.json`; either approach works.

**Build a desktop installer:**
```bash
npm run dist
```
Produces a Windows/macOS/Linux installer via `electron-builder` (config is
already in `package.json`).

## Controls

| Action | How |
|---|---|
| Start/switch side | Click the Study or Rest panel |
| Pause / Resume | Click the button, or press `Space` |
| Reset | Click Reset, or press `Escape` |
| Keyboard shortcuts | `S` → Study, `R` → Rest |
| Pin on top (desktop) | Topbar 📌 button, or `Ctrl/Cmd+Shift+P` |
| Hide/show overlay (desktop) | `Ctrl/Cmd+Shift+O` |
| Minimize (desktop) | Topbar — button, or the OS taskbar |
| Opacity (desktop) | Settings → Window opacity slider |

Settings and timer progress are saved to `localStorage` after every
change, so closing and reopening either build resumes where you left off.

## Project cleanup — what changed from the old project

The old project had three parallel builds: a website, a Chrome extension,
and an Electron app, each with its own duplicated timer/sound logic. A
Chrome extension popup can't stay visible above other apps or sit on the
desktop (it closes the moment focus leaves it), so it's been dropped
entirely in favor of the Electron overlay, which can.

**Safe to delete from the old upload** (superseded by this project):
- `manifest.json` — Chrome extension manifest (extension architecture removed)
- `popup.html` — Chrome extension popup UI (removed)
- Any old `src/background.js`, `src/popup.js`, `src/popup.css` the
  extension referenced (never included in this rebuild)
- Old `renderer.js`, `desktop-index.html` — replaced by
  `electron/desktop.js` and `electron/index.html`
- Old `app.js`, `index.html`, `sw.js`, `styles.css`, `manifest.webmanifest`
  at the project root — replaced by the versions now under `web/`
- Old `main.js`, `preload.js` at the project root — replaced by the
  versions now under `electron/`
- `package-lock.json` — regenerate with `npm install` against the new
  `package.json` rather than reusing the old lockfile

**Electron-only** (not needed for Vercel, not shipped to the browser):
- `electron/main.js`, `electron/preload.js`, `electron/index.html`,
  `electron/desktop.js`, `electron/desktop.css`
- `package.json`'s `devDependencies` (`electron`, `electron-builder`)

**Required for Vercel deployment:**
- Everything under `web/` (that's the whole deployment — it's a static
  site, no server code, no build step)
- `vercel.json` (or equivalent Root Directory setting)

**Shared by both, lives once:**
- `web/shared/clock.js`, `web/shared/sound-engine.js`, `web/shared/storage.js`
- `web/styles.css` (imported directly by `electron/index.html` via a
  relative `../web/styles.css` link)

## Notes on sound & sensors

- All audio (tick, switch click, completion chime) is synthesized with the
  Web Audio API — no audio files to ship, license, or go stale.
- Wake Lock (`keepAwakeEnabled`) uses the standard `navigator.wakeLock`
  API, which works in both a browser tab and an Electron renderer without
  any extra native code.
- Desktop notifications require the user to grant permission once (the
  🔔 / "Enable notifications" button) — this is identical between builds.
