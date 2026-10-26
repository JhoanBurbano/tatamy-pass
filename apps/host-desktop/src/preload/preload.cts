/**
 * Preload: expone `window.tp` (ver `shared/ipc.ts`) a la ventana con
 * contextIsolation. Cada método es un `ipcRenderer.invoke('tp:<nombre>')`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopState, TpApi } from '../shared/ipc.js';

const invoke = (name: string) => (...args: unknown[]) => ipcRenderer.invoke(`tp:${name}`, ...args);

const api: TpApi = {
  getState: invoke('getState'),
  getLogs: invoke('getLogs'),
  openPanel: invoke('openPanel'),
  openPath: invoke('openPath'),
  createEnrollment: invoke('createEnrollment'),
  backupNow: invoke('backupNow'),
  backupToUsb: invoke('backupToUsb'),
  cloudPullNow: invoke('cloudPullNow'),
  promote: invoke('promote'),
  changeEventFile: invoke('changeEventFile'),
  exportRootCert: invoke('exportRootCert'),
  getSettings: invoke('getSettings'),
  saveSettings: invoke('saveSettings'),
  setPassphrase: invoke('setPassphrase'),
  chooseFolder: invoke('chooseFolder'),
  chooseFile: invoke('chooseFile'),
  runSetup: invoke('runSetup'),
  restartHost: invoke('restartHost'),
  quit: invoke('quit'),
  onState: (cb: (s: DesktopState) => void) => {
    const h = (_e: unknown, s: DesktopState) => cb(s);
    ipcRenderer.on('tp:state', h);
    return () => ipcRenderer.removeListener('tp:state', h);
  },
  onLog: (cb: (line: string) => void) => {
    const h = (_e: unknown, line: string) => cb(line);
    ipcRenderer.on('tp:log', h);
    return () => ipcRenderer.removeListener('tp:log', h);
  }
};

contextBridge.exposeInMainWorld('tp', api);
