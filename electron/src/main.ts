import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { transcribe, type TranscribeOptions } from './transcriber';
import { burn, type BurnOptions } from './burner';
import { detectSilences, cutSilences, extractPeaks, type DetectSilencesOptions, type CutSilencesOptions } from './silence';
import { exportVideo, type ExportOptions } from './export';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.icns'),
    backgroundColor: '#111111',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111111',
      symbolColor: '#ffffff',
      height: 32,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Block refresh, devtools shortcuts, and similar reload attempts.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    const ctrlOrMeta = input.control || input.meta;

    // Refresh: F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5
    if (key === 'f5' || (ctrlOrMeta && key === 'r')) {
      event.preventDefault();
      return;
    }
    // DevTools: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U (view-source)
    if (key === 'f12') { event.preventDefault(); return; }
    if (ctrlOrMeta && input.shift && (key === 'i' || key === 'j' || key === 'c')) {
      event.preventDefault();
      return;
    }
    if (ctrlOrMeta && key === 'u') { event.preventDefault(); return; }
  });

  // Block any programmatic devtools open in production.
  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }
}

app.whenReady().then(() => {
  if (isDev && process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.icns'));
    } catch {}
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('subbi:pickVideo', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0];
});

ipcMain.handle('subbi:transcribe', async (_e, opts: TranscribeOptions) => {
  return await transcribe(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'transcribe', pct, line });
  });
});

ipcMain.handle('subbi:burn', async (_e, opts: BurnOptions) => {
  return await burn(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'burn', pct, line });
  });
});

ipcMain.handle('subbi:detectSilences', async (_e, opts: DetectSilencesOptions) => {
  return await detectSilences(opts);
});

ipcMain.handle('subbi:extractPeaks', async (_e, opts: { videoPath: string; targetBins?: number }) => {
  return await extractPeaks(opts.videoPath, opts.targetBins ?? 2000);
});

ipcMain.handle('subbi:cutSilences', async (_e, opts: CutSilencesOptions) => {
  return await cutSilences(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'cut', pct, line });
  });
});

ipcMain.handle('subbi:exportVideo', async (_e, opts: ExportOptions) => {
  return await exportVideo(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'export', pct, line });
  });
});

ipcMain.handle('subbi:writeSrt', async (_e, opts: { srtPath: string; content: string }) => {
  fs.writeFileSync(opts.srtPath, opts.content, 'utf8');
  return opts.srtPath;
});
