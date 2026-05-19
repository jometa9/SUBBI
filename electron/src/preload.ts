import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('subbi', {
  pickVideo: () => ipcRenderer.invoke('subbi:pickVideo'),
  pickAudio: () => ipcRenderer.invoke('subbi:pickAudio'),
  pathExists: (p: string) => ipcRenderer.invoke('subbi:pathExists', p),
  getPathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  transcribe: (opts: any, jobId?: string) => ipcRenderer.invoke('subbi:transcribe', opts, jobId),
  checkModel: (model: 'tiny' | 'medium') => ipcRenderer.invoke('subbi:checkModel', model),
  downloadModel: (model: 'tiny' | 'medium', jobId?: string) => ipcRenderer.invoke('subbi:downloadModel', model, jobId),
  burn: (opts: any, jobId?: string) => ipcRenderer.invoke('subbi:burn', opts, jobId),
  detectSilences: (opts: any) => ipcRenderer.invoke('subbi:detectSilences', opts),
  cutSilences: (opts: any, jobId?: string) => ipcRenderer.invoke('subbi:cutSilences', opts, jobId),
  exportVideo: (opts: any, jobId: string) => ipcRenderer.invoke('subbi:exportVideo', opts, jobId),
  cancelExport: (jobId: string) => ipcRenderer.invoke('subbi:cancelExport', jobId),
  renderVoiceCleanupPreview: (opts: any, jobId: string) => ipcRenderer.invoke('subbi:renderVoiceCleanupPreview', opts, jobId),
  cancelVoiceCleanupPreview: (jobId: string) => ipcRenderer.invoke('subbi:cancelVoiceCleanupPreview', jobId),
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
