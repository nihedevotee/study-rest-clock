/**
 * main.js — Electron main process.
 * ---------------------------------------------------------------------------
 * Owns exactly the things that are inherently OS-level: creating the window,
 * always-on-top behavior, opacity, global shortcuts, and minimize/restore.
 * Everything about HOW the clock works lives in web/shared/*.js and is never
 * duplicated here.
 */

const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const path = require("path");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 360,
    minWidth: 220,
    minHeight: 160,
    frame: false, // custom drag region is provided by the .topbar in the UI
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false, // keep it in the taskbar so it can be minimized/restored normally
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // "screen-saver" level keeps the window above fullscreen apps/games on
  // macOS and Windows, which a plain alwaysOnTop:true does not guarantee.
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Ctrl/Cmd+Shift+P — toggle always-on-top without opening settings.
  globalShortcut.register("CommandOrControl+Shift+P", () => {
    if (!mainWindow) return;
    mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop(), "screen-saver");
  });

  // Ctrl/Cmd+Shift+O — quickly hide/show the overlay.
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// ---- IPC exposed to the renderer via preload.js --------------------------

ipcMain.handle("desktop:toggle-always-on-top", () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, "screen-saver");
  return next;
});

ipcMain.handle("desktop:get-always-on-top", () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false;
});

ipcMain.handle("desktop:set-opacity", (_event, value) => {
  if (!mainWindow) return;
  const clamped = Math.min(1, Math.max(0.4, Number(value) || 1));
  mainWindow.setOpacity(clamped);
});

ipcMain.handle("desktop:minimize", () => {
  mainWindow?.minimize();
});
