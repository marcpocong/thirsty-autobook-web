import { contextBridge, ipcRenderer } from 'electron';
import type { Dashboard, Bridge } from './types.js';
const bridge: Bridge = {
  resetPrepare:strategy=>ipcRenderer.invoke('thirsty:resetPrepare',strategy),
  testBooking:input=>ipcRenderer.invoke('thirsty:testBooking',input),
  setWorkflow:workflow=>ipcRenderer.invoke('thirsty:setWorkflow',workflow),
  prepareDual:()=>ipcRenderer.invoke('thirsty:prepareDual'),
  runDualPractice:input=>ipcRenderer.invoke('thirsty:runDualPractice',input),
  reviewLock:()=>ipcRenderer.invoke('thirsty:reviewLock'),
  clearLock:()=>ipcRenderer.invoke('thirsty:clearLock'),
  resetPractice:()=>ipcRenderer.invoke('thirsty:resetPractice'),
  runFullPractice:input=>ipcRenderer.invoke('thirsty:runFullPractice',input),
  startChrome: () => ipcRenderer.invoke('thirsty:startChrome'),
  inspectOnda: () => ipcRenderer.invoke('thirsty:inspectOnda'),
  prepare: () => ipcRenderer.invoke('thirsty:prepare'),
  armObservation: () => ipcRenderer.invoke('thirsty:armObservation'),
  armSelection: () => ipcRenderer.invoke('thirsty:armSelection'),
  armFullBooking:()=>ipcRenderer.invoke('thirsty:armFullBooking'),
  setMode:mode=>ipcRenderer.invoke('thirsty:setMode',mode),
  authorizeTerms:value=>ipcRenderer.invoke('thirsty:authorizeTerms',value),
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
