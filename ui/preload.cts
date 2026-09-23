import { contextBridge, ipcRenderer } from 'electron';
import type { Dashboard, Bridge, ConfirmRequest } from './types.js';
const bridge: Bridge = {
  syncClock:()=>ipcRenderer.invoke('thirsty:syncClock'),
  focusBrowser:request=>ipcRenderer.invoke('thirsty:focusBrowser',request),
  resetPrepare:strategy=>ipcRenderer.invoke('thirsty:resetPrepare',strategy),
  testBooking:input=>ipcRenderer.invoke('thirsty:testBooking',input),
  apiPreview:date=>ipcRenderer.invoke('thirsty:apiPreview',date),
  checkReleaseBlocks:date=>ipcRenderer.invoke('thirsty:checkReleaseBlocks',date),
  setWorkflow:workflow=>ipcRenderer.invoke('thirsty:setWorkflow',workflow),
  invalidatePreparation:()=>ipcRenderer.invoke('thirsty:invalidatePreparation'),
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
  cancelScheduledRelease:()=>ipcRenderer.invoke('thirsty:cancelScheduledRelease'),
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
  onConfirmRequest: callback => {
    const listener = (_event: Electron.IpcRendererEvent, request: ConfirmRequest) => callback(request);
    ipcRenderer.on('thirsty:confirmRequest', listener);
    return () => ipcRenderer.removeListener('thirsty:confirmRequest', listener);
  },
  confirmResponse: (id, confirmed) => ipcRenderer.invoke('thirsty:confirmResponse', { id, confirmed }),
};
contextBridge.exposeInMainWorld('thirsty', bridge);
