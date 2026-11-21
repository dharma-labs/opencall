'use strict';

/**
 * Minimal, read-only bridge. The renderer keeps full context isolation: it gets
 * platform facts for display and nothing else.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('opencallDesktop', {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
