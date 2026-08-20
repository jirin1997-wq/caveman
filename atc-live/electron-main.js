// Desktop shell.
//
// The window loads the page from our own Express server, which serves both
// web/index.html and the API. That is the whole app in one process: no Next.js
// server to start, no second port to coordinate, and — because page and API
// share an origin — no CORS anywhere.
//
// An earlier version pointed the window at port 3000 expecting a Next server
// there. Nothing started one in a packaged build, so the window opened on a
// connection error. Hence the single-port design and the readiness check
// below, which fails loudly instead of showing a blank window.

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const PORT = Number(process.env.PORT) || 3001;
const isDev = !app.isPackaged;

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0f141b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Resolves once the server answers, rejects after the deadline. Any HTTP reply
// counts — we only need to know something is listening.
function waitForServer(port, attempts = 40, delayMs = 250) {
  return new Promise((resolve, reject) => {
    let left = attempts;

    const check = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/airports' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (--left <= 0) return reject(new Error(`nothing listening on :${port}`));
        setTimeout(check, delayMs);
      });
      req.setTimeout(2000, () => req.destroy());
    };

    check();
  });
}

function startServer() {
  // In a packaged app there is no `node` on PATH to rely on; Electron's own
  // binary runs the script when ELECTRON_RUN_AS_NODE is set.
  serverProcess = spawn(process.execPath, [path.join(__dirname, 'server', 'index.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`.trimEnd()));
  serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`.trimEnd()));
  serverProcess.on('error', (err) => console.error('[server] failed to spawn:', err));
}

app.on('ready', async () => {
  startServer();
  try {
    await waitForServer(PORT);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      'ATC Live se nepodařilo spustit',
      `Vnitřní server nenaběhl na portu ${PORT}.\n\n${err.message}\n\n` +
        `Nejčastější příčina je, že port už používá jiný program. ` +
        `Zavři ho a zkus to znovu.`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
