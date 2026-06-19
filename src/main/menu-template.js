'use strict';

/**
 * menu-template.js
 *
 * Pure builder for the Electron application menu template. No Electron import,
 * so it is unit-testable with `node --test`.
 *
 * Why this exists: when an app uses Electron's DEFAULT menu, macOS auto-injects
 * "Start Dictation", "Emoji & Symbols", a Speech submenu, and a system find
 * bar — any of which can appear as a stray overlay over the window. We build an
 * explicit menu containing only standard, expected items so nothing is injected.
 */

/**
 * @param {{isMac:boolean, isDev:boolean, appName?:string}} opts
 * @returns {Array} an Electron Menu template (array of MenuItemConstructorOptions)
 */
function buildMenuTemplate({ isMac = false, isDev = false, appName = 'Grimmia' } = {}) {
  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }])],
    },
  ];
}

module.exports = { buildMenuTemplate };
