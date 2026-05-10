import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('subbi', {
  pickVideo: () => ipcRenderer.invoke('subbi:pickVideo'),
  getPathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  transcribe: (opts: any) => ipcRenderer.invoke('subbi:transcribe', opts),
  burn: (opts: any) => ipcRenderer.invoke('subbi:burn', opts),
  onProgress: (cb: (evt: any) => void) => {
    const listener = (_e: any, evt: any) => cb(evt);
    ipcRenderer.on('subbi:progress', listener);
    return () => ipcRenderer.removeListener('subbi:progress', listener);
  },
});
