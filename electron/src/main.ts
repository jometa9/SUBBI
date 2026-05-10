import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'path';
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
}

app.whenReady().then(() => {
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
