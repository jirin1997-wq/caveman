const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

const PORT = 3001;
const FRONTEND_PORT = 3000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForServer(port, maxAttempts = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      const req = http.get(`http://localhost:${port}`, (res) => {
        if (res.statusCode) {
          resolve();
        } else {
          if (attempts < maxAttempts) {
            setTimeout(check, delay);
          } else {
            reject(new Error('Server did not start in time'));
          }
        }
      });

      req.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(check, delay);
        } else {
          reject(new Error('Server did not start in time'));
        }
      });
    };

    check();
  });
}

function startServer() {
  serverProcess = spawn('node', [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server] ${data}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server Error] ${data}`);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });

  return serverProcess;
}

app.on('ready', async () => {
  startServer();

  try {
    // Wait for backend server to be ready
    await waitForServer(PORT);
    console.log(`[Main] Backend ready on port ${PORT}`);

    // Wait a bit for frontend in dev mode
    if (isDev) {
      console.log(`[Main] Waiting for frontend on port ${FRONTEND_PORT}...`);
      await waitForServer(FRONTEND_PORT, 60, 1000);
    }

    createWindow();
  } catch (err) {
    console.error('Failed to start app:', err);
    if (mainWindow) mainWindow.close();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
