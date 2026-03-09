const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractPrompts } = require('./png-parser');
const log = require('./logger');

const THUMB_SIZE = 200;
const thumbCache = new Map();

let mainWindow = null;
let settingsPath = null;

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(data) {
  try {
    const current = loadSettings();
    fs.writeFileSync(settingsPath, JSON.stringify({ ...current, ...data }, null, 2), 'utf8');
  } catch { /* ignore */ }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-select-folder'),
        },
        { type: 'separator' },
        {
          label: 'Export as TXT',
          click: () => mainWindow?.webContents.send('menu-export', 'txt'),
        },
        {
          label: 'Export as CSV',
          click: () => mainWindow?.webContents.send('menu-export', 'csv'),
        },
        {
          label: 'Export as JSON',
          click: () => mainWindow?.webContents.send('menu-export', 'json'),
        },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Prompt Sort Order',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu-toggle-sort'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Log File',
          click: () => {
            const logPath = log.getLogPath();
            if (logPath) shell.openPath(logPath);
          },
        },
        {
          label: 'Open Log Folder',
          click: () => {
            const logPath = log.getLogPath();
            if (logPath) shell.showItemInFolder(logPath);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  buildMenu();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  log.info('app', 'Window created');
}

// Register thumb:// protocol — serves resized JPEG thumbnails
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  settingsPath = path.join(userData, 'settings.json');
  log.init(userData);
  log.info('app', 'App ready', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });

  protocol.handle('thumb', async (request) => {
    let filePath = decodeURIComponent(request.url.slice('thumb:///'.length));
    // Restore Windows drive letter format (C:/... → C:\...)
    filePath = filePath.replace(/\//g, path.sep);

    if (thumbCache.has(filePath)) {
      return new Response(thumbCache.get(filePath), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }

    try {
      const img = nativeImage.createFromPath(filePath);
      const size = img.getSize();
      if (size.width === 0 || size.height === 0) {
        return new Response('', { status: 404 });
      }
      // Resize to fit THUMB_SIZE, preserving aspect ratio
      const scale = Math.min(THUMB_SIZE / size.width, THUMB_SIZE / size.height, 1);
      const resized = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good',
      });
      const jpegBuf = resized.toJPEG(70);
      thumbCache.set(filePath, jpegBuf);

      return new Response(jpegBuf, {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    } catch (err) {
      log.warn('thumb', 'Failed to generate thumbnail', err.message);
      return new Response('', { status: 404 });
    }
  });

  createWindow();
});

/**
 * Recursively find all .png files under a directory.
 */
function findPngs(dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findPngs(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('show-in-folder', (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

ipcMain.handle('open-log-folder', () => {
  const logPath = log.getLogPath();
  if (logPath) shell.showItemInFolder(logPath);
});

ipcMain.handle('clear-thumb-cache', () => {
  const count = thumbCache.size;
  thumbCache.clear();
  log.info('ipc', `Thumb cache cleared (${count} entries)`);
});

ipcMain.handle('get-last-folder', () => {
  return loadSettings().lastFolder || null;
});

ipcMain.handle('select-folder', async () => {
  log.info('ipc', 'Folder selection dialog opened');
  const settings = loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: settings.lastFolder || undefined,
  });
  if (result.canceled || result.filePaths.length === 0) {
    log.info('ipc', 'Folder selection cancelled');
    return null;
  }
  saveSettings({ lastFolder: result.filePaths[0] });
  log.info('ipc', 'Folder selected');
  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (_event, folderPath) => {
  const startTime = Date.now();
  log.info('scan', 'Scan started');

  const pngFiles = findPngs(folderPath);
  const total = pngFiles.length;
  log.info('scan', `Found ${total} PNG files`);

  // Map: text -> { type, text, sources: Set<string> }
  const promptMap = new Map();
  let parseErrors = 0;

  for (let i = 0; i < pngFiles.length; i++) {
    const filePath = pngFiles[i];
    try {
      const prompts = extractPrompts(filePath);
      for (const p of prompts) {
        const key = p.text;
        if (promptMap.has(key)) {
          const existing = promptMap.get(key);
          existing.sources.add(filePath);
        } else {
          promptMap.set(key, {
            type: p.type,
            text: p.text,
            sources: new Set([filePath]),
          });
        }
      }
    } catch {
      parseErrors++;
    }

    const scanned = i + 1;
    if (scanned % 10 === 0 || scanned === total) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', { scanned, total });
      }
    }
  }

  // Convert Sets to arrays for serialisation
  const prompts = Array.from(promptMap.values()).map((entry) => ({
    type: entry.type,
    text: entry.text,
    sources: Array.from(entry.sources),
  }));

  const elapsed = Date.now() - startTime;
  log.info('scan', 'Scan complete', {
    images: total,
    uniquePrompts: prompts.length,
    parseErrors,
    elapsedMs: elapsed,
  });

  return { prompts, imagePaths: pngFiles };
});

ipcMain.handle('export-prompts', async (_event, { prompts, format }) => {
  log.info('ipc', `Export requested: format=${format}, entries=${prompts.length}`);
  const filters = {
    txt: [{ name: 'Text Files', extensions: ['txt'] }],
    csv: [{ name: 'CSV Files', extensions: ['csv'] }],
    json: [{ name: 'JSON Files', extensions: ['json'] }],
  };

  const result = await dialog.showSaveDialog(mainWindow, {
    filters: filters[format] || filters.txt,
  });

  if (result.canceled || !result.filePath) {
    log.info('ipc', 'Export cancelled');
    return null;
  }

  let content;
  if (format === 'txt') {
    content = prompts
      .map((p) => `[${p.type.toUpperCase()}] ${p.text}`)
      .join('\n\n');
  } else if (format === 'csv') {
    const escape = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = prompts.map(
      (p) =>
        `${escape(p.type)},${escape(p.text)},${escape(p.sources.join('; '))}`
    );
    content = 'Type,Prompt,Sources\n' + rows.join('\n');
  } else {
    content = JSON.stringify(prompts, null, 2);
  }

  fs.writeFileSync(result.filePath, content, 'utf8');
  log.info('ipc', `Export saved: format=${format}, size=${content.length} bytes`);
  return result.filePath;
});

// ── App lifecycle ───────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  log.info('app', 'All windows closed, quitting');
  app.quit();
});

process.on('uncaughtException', (err) => {
  log.error('crash', 'Uncaught exception', err.stack || err.message);
});

process.on('unhandledRejection', (reason) => {
  log.error('crash', 'Unhandled rejection', String(reason));
});
