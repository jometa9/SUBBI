import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('subbi', {
  pickVideo: () => ipcRenderer.invoke('subbi:pickVideo'),
  pathExists: (p: string) => ipcRenderer.invoke('subbi:pathExists', p),
  getPathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  transcribe: (opts: any) => ipcRenderer.invoke('subbi:transcribe', opts),
  checkModel: (model: 'tiny' | 'medium') => ipcRenderer.invoke('subbi:checkModel', model),
  downloadModel: (model: 'tiny' | 'medium') => ipcRenderer.invoke('subbi:downloadModel', model),
  burn: (opts: any) => ipcRenderer.invoke('subbi:burn', opts),
  detectSilences: (opts: any) => ipcRenderer.invoke('subbi:detectSilences', opts),
  cutSilences: (opts: any) => ipcRenderer.invoke('subbi:cutSilences', opts),
  exportVideo: (opts: any) => ipcRenderer.invoke('subbi:exportVideo', opts),
  cancelExport: () => ipcRenderer.invoke('subbi:cancelExport'),
  extractPeaks: (opts: any) => ipcRenderer.invoke('subbi:extractPeaks', opts),
  writeSrt: (opts: any) => ipcRenderer.invoke('subbi:writeSrt', opts),
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke('subbi:setTitleBarOverlay', opts),
  getAppVersion: () => ipcRenderer.invoke('subbi:getAppVersion'),
  checkForUpdates: () => ipcRenderer.invoke('subbi:checkForUpdates'),
  openExternal: (url: string) => ipcRenderer.invoke('subbi:openExternal', url),
  onProgress: (cb: (evt: any) => void) => {
    const listener = (_e: any, evt: any) => cb(evt);
    ipcRenderer.on('subbi:progress', listener);
    return () => ipcRenderer.removeListener('subbi:progress', listener);
  },
});
