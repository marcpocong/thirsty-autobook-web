import { contextBridge, ipcRenderer } from 'electron';
import type { Dashboard, Bridge } from './types.js';
const bridge: Bridge = {
  startChrome: () => ipcRenderer.invoke('thirsty:startChrome'),
  inspectOnda: () => ipcRenderer.invoke('thirsty:inspectOnda'),
  prepare: () => ipcRenderer.invoke('thirsty:prepare'),
  armObservation: () => ipcRenderer.invoke('thirsty:armObservation'),
  armSelection: () => ipcRenderer.invoke('thirsty:armSelection'),
  dryRace: () => ipcRenderer.invoke('thirsty:dryRace'),
  saveBooking: input => ipcRenderer.invoke('thirsty:saveBooking', input),
  runPractice: input => ipcRenderer.invoke('thirsty:runPractice', input),
  abortAutomation: () => ipcRenderer.invoke('thirsty:abortAutomation'),
  getStatus: () => ipcRenderer.invoke('thirsty:getStatus'),
  onStatus: callback => {
    const listener = (_event: Electron.IpcRendererEvent, status: Dashboard) => callback(status);
    ipcRenderer.on('thirsty:status', listener);
    return () => ipcRenderer.removeListener('thirsty:status', listener);
  },
};
contextBridge.exposeInMainWorld('thirsty', bridge);
