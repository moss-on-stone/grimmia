'use strict';

/**
 * preload.js
 *
 * The single trusted bridge between the sandboxed renderer and the main
 * process. Exposes a minimal, explicit `window.ia` API over IPC — the renderer
 * has no direct access to Node, the network, or credentials.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Subscribe to a main->renderer event channel; returns an unsubscribe fn. */
function on(channel, handler) {
  const listener = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ia', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  search: {
    query: (query, opts = {}) => ipcRenderer.invoke('search:query', { query, ...opts }),
    advanced: (fields, opts = {}) => ipcRenderer.invoke('search:advanced', { fields, ...opts }),
    buildQuery: (fields) => ipcRenderer.invoke('search:buildQuery', { fields }),
    parseInput: (input) => ipcRenderer.invoke('search:parseInput', { input }),
  },
  item: {
    metadata: (identifier) => ipcRenderer.invoke('item:metadata', { identifier }),
    tasks: (identifier) => ipcRenderer.invoke('item:tasks', { identifier }),
  },
  prefs: {
    formatPresets: () => ipcRenderer.invoke('prefs:formatPresets'),
  },
  download: {
    start: (args) => ipcRenderer.invoke('download:start', args),
    collection: (args) => ipcRenderer.invoke('collection:download', args),
    cancel: (jobId) => ipcRenderer.invoke('download:cancel', { jobId }),
    onProgress: (handler) => on('download:progress', handler),
  },
  upload: {
    chooseFiles: () => ipcRenderer.invoke('dialog:chooseFiles'),
    start: (args) => ipcRenderer.invoke('upload:start', args),
    cancel: (jobId) => ipcRenderer.invoke('upload:cancel', { jobId }),
    onProgress: (handler) => on('upload:progress', handler),
  },
  bulk: {
    choose: () => ipcRenderer.invoke('bulk:choose'),
    upload: (args) => ipcRenderer.invoke('bulk:upload', args),
  },
  transfer: {
    // Queue state: { downloads, uploads, active, waiting } — drives the badge
    // and the ordered Transfers lists.
    onQueue: (handler) => on('transfer:queue', handler),
    // Reorder a waiting transfer (drag-to-reorder).
    reorder: (jobId, toIndex) => ipcRenderer.invoke('transfer:reorder', { jobId, toIndex }),
  },
  metadata: {
    modify: (identifier, patches) => ipcRenderer.invoke('metadata:modify', { identifier, patches }),
    edit: (identifier, original, edited) => ipcRenderer.invoke('metadata:edit', { identifier, original, edited }),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  dialog: {
    chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  logs: {
    open: () => ipcRenderer.invoke('logs:open'),
  },
  view: {
    // Adjust the window zoom (same effect as the View menu's Zoom In/Out).
    zoom: (delta) => ipcRenderer.invoke('view:zoom', delta),
  },
});
