'use strict';

/**
 * OpenCall desktop shell (Electron).
 *
 * The renderer is the same static build that ships to the browser, so no code
 * is duplicated and no network service is added. Files are served over a
 * privileged `opencall://` scheme rather than `file://` because a privileged
 * secure scheme is what makes `navigator.mediaDevices` (and therefore WebRTC
 * capture) available inside the renderer.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol, session, desktopCapturer, shell } = require('electron');

const SCHEME = 'opencall';
const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.OPENCALL_DEV_URL || (process.argv.includes('--dev') ? 'http://localhost:5173' : '');

// Everything the app legitimately loads: its own files, plus the data/blob URLs
// the QR encoder and camera preview produce. The only remote traffic allowed is
// the signalling relay — an MQTT-over-WebSocket handshake that carries room
// codes, names and SDP. Messages, calls and files never touch it.
const SIGNALING_ORIGINS = ['wss://broker.emqx.io:8084', 'wss://test.mosquitto.org:8081'];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' data: blob: ${SIGNALING_ORIGINS.join(' ')}`,
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

// Capabilities the renderer is allowed to ask the operating system for.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.normalize(path.join(DIST, relative));

    // Never let a crafted path escape the build directory.
    if (!target.startsWith(DIST)) {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body = await fs.promises.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { status: 200, headers: { 'content-type': type } });
    } catch {
      // Any unknown path falls back to the app shell.
      const shellHtml = await fs.promises.readFile(path.join(DIST, 'index.html'));
      return new Response(shellHtml, { status: 200, headers: { 'content-type': MIME['.html'] } });
    }
  });
}

function wirePermissions() {
  const ses = session.defaultSession;

  if (!DEV_URL) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
      });
    });
  }

  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

  // Screen sharing: Electron requires an explicit source. The primary screen is
  // used, which keeps sharing one click away from the app's own button.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (sources.length === 0) {
      callback({});
      return;
    }
    callback({ video: sources[0] });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 360,
    minHeight: 520,
    backgroundColor: '#08080c',
    show: false,
    autoHideMenuBar: true,
    title: 'OpenCall',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links the app cannot own are handed to the real browser; the app window
  // itself never navigates away from the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadURL(`${SCHEME}://app/index.html`);
  }

  return win;
}

app.whenReady().then(() => {
  wirePermissions();
  if (!DEV_URL) serveDist();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// WebRTC is the only transport OpenCall uses; the shell adds no network stack.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
