/**
 * preload.js
 * ---------------------------------------------------------------------------
 * Runs in an isolated context with access to Node/Electron APIs, and hands
 * the renderer a small, explicit `window.desktop` surface via
 * contextBridge. The renderer (electron/desktop.js) never touches
 * ipcRenderer or Node directly — this is the only bridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  toggleAlwaysOnTop: () => ipcRenderer.invoke("desktop:toggle-always-on-top"),
  getAlwaysOnTop: () => ipcRenderer.invoke("desktop:get-always-on-top"),
  setOpacity: (value) => ipcRenderer.invoke("desktop:set-opacity", value),
  minimize: () => ipcRenderer.invoke("desktop:minimize"),
});
