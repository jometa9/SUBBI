import { app, BrowserWindow, ipcMain, dialog, protocol, shell, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { transcribe, type TranscribeOptions } from './transcriber';
import { hasModel, downloadModel, type WhisperModel } from './models';
import { burn, type BurnOptions } from './burner';
import { detectSilences, cutSilences, extractPeaks, type DetectSilencesOptions, type CutSilencesOptions } from './silence';
import { exportVideo, cancelExport, renderVoiceCleanupPreview, cancelVoiceCleanupPreview, type ExportOptions, type VoiceCleanupIntensity } from './export';

const isDev = !app.isPackaged;

const SHOW_DEV_TOOLS = false;

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
    if (SHOW_DEV_TOOLS) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    const ctrlOrMeta = input.control || input.meta;

    if (key === 'f5' || (ctrlOrMeta && key === 'r')) {
      event.preventDefault();
      return;
    }
    if (key === 'f12') { event.preventDefault(); return; }
    if (ctrlOrMeta && input.shift && (key === 'i' || key === 'j' || key === 'c')) {
      event.preventDefault();
      return;
    }
    if (ctrlOrMeta && key === 'u') { event.preventDefault(); return; }
  });

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

ipcMain.handle('subbi:pathExists', async (_e, p: string) => {
  try { return !!p && fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
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

ipcMain.handle('subbi:pickAudio', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir audio',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0];
});

ipcMain.handle('subbi:checkModel', async (_e, model: WhisperModel) => {
  return hasModel(model);
});

ipcMain.handle('subbi:downloadModel', async (_e, model: WhisperModel, jobId?: string) => {
  await downloadModel(model, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'modelDownload', jobId, model, pct, line });
  });
  return true;
});

ipcMain.handle('subbi:transcribe', async (_e, opts: TranscribeOptions, jobId?: string) => {
  return await transcribe(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'transcribe', jobId, pct, line });
  });
});

ipcMain.handle('subbi:burn', async (_e, opts: BurnOptions, jobId?: string) => {
  return await burn(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'burn', jobId, pct, line });
  });
});

ipcMain.handle('subbi:detectSilences', async (_e, opts: DetectSilencesOptions) => {
  return await detectSilences(opts);
});

ipcMain.handle('subbi:extractPeaks', async (_e, opts: { videoPath: string; targetBins?: number; binsPerSecond?: number }) => {
  return await extractPeaks(opts.videoPath, opts.targetBins ?? 2000, opts.binsPerSecond);
});

ipcMain.handle('subbi:cutSilences', async (_e, opts: CutSilencesOptions, jobId?: string) => {
  return await cutSilences(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'cut', jobId, pct, line });
  });
});

ipcMain.handle('subbi:exportVideo', async (_e, opts: ExportOptions, jobId: string) => {
  return await exportVideo(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'export', jobId, pct, line });
  }, jobId);
});

ipcMain.handle('subbi:cancelExport', async (_e, jobId: string) => {
  return cancelExport(jobId);
});

ipcMain.handle('subbi:renderVoiceCleanupPreview', async (_e, opts: { videoPath: string; intensity: VoiceCleanupIntensity }, jobId: string) => {
  return await renderVoiceCleanupPreview(opts, (pct, line) => {
    mainWindow?.webContents.send('subbi:progress', { kind: 'vcPreview', jobId, pct, line });
  }, jobId);
});

ipcMain.handle('subbi:cancelVoiceCleanupPreview', async (_e, jobId: string) => {
  return cancelVoiceCleanupPreview(jobId);
});

ipcMain.handle('subbi:writeSrt', async (_e, opts: { srtPath: string; content: string }) => {
  fs.writeFileSync(opts.srtPath, opts.content, 'utf8');
  return opts.srtPath;
});

const UPDATE_REPO = 'jometa9/SUBBI';

function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

ipcMain.handle('subbi:getAppVersion', async () => app.getVersion());

ipcMain.handle('subbi:checkForUpdates', async () => {
  const current = app.getVersion();
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const req = net.request({
        method: 'GET',
        url: `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
        redirect: 'follow',
      });
      req.setHeader('Accept', 'application/vnd.github+json');
      req.setHeader('User-Agent', 'Subbi-UpdateCheck');
      const chunks: Buffer[] = [];
      req.on('response', (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    const data = JSON.parse(body) as { tag_name?: string; html_url?: string };
    const latest = (data.tag_name || '').replace(/^v/, '');
    const releaseUrl = data.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`;
    return {
      current,
      latest,
      hasUpdate: latest ? isNewer(latest, current) : false,
      releaseUrl,
    };
  } catch (err: any) {
    return { current, latest: '', hasUpdate: false, releaseUrl: `https://github.com/${UPDATE_REPO}/releases/latest`, error: String(err?.message || err) };
  }
});

ipcMain.handle('subbi:openExternal', async (_e, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('subbi:setTitleBarOverlay', async (_e, opts: { color: string; symbolColor: string }) => {
  if (!mainWindow || process.platform !== 'win32') return false;
  try {
    mainWindow.setTitleBarOverlay({ color: opts.color, symbolColor: opts.symbolColor, height: 32 });
    mainWindow.setBackgroundColor(opts.color);
    return true;
  } catch { return false; }
});
