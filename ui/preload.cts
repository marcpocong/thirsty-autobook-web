import { contextBridge, ipcRenderer } from 'electron';
import type { Dashboard, Bridge, ConfirmRequest } from './types.js';
const bridge: Bridge = {
  onLabPhase:callback=>{const listener=(_event:unknown,phase:string)=>callback(phase);ipcRenderer.on('thirsty:labPhase',listener);return()=>ipcRenderer.removeListener('thirsty:labPhase',listener);},
  shotgunLab:request=>ipcRenderer.invoke('thirsty:shotgunLab',request),
  objective:request=>ipcRenderer.invoke('thirsty:objective',request),
  journalArchive:request=>ipcRenderer.invoke('thirsty:journalArchive',request),
  syncClock:()=>ipcRenderer.invoke('thirsty:syncClock'),
  focusBrowser:request=>ipcRenderer.invoke('thirsty:focusBrowser',request),
  closeBotBrowsers:()=>ipcRenderer.invoke('thirsty:closeBotBrowsers'),checkSecurity:()=>ipcRenderer.invoke('thirsty:checkSecurity'),calibrateTiming:()=>ipcRenderer.invoke('thirsty:calibrateTiming'),
  watchNextRelease:()=>ipcRenderer.invoke('thirsty:watchNextRelease'),
  stopSlotWatch:()=>ipcRenderer.invoke('thirsty:stopSlotWatch'),
  rebuildIntelligence:()=>ipcRenderer.invoke('thirsty:rebuildIntelligence'),
  clearIntelligence:()=>ipcRenderer.invoke('thirsty:clearIntelligence'),
  runNetworkCheck:()=>ipcRenderer.invoke('thirsty:runNetworkCheck'),
  replayPlan:input=>ipcRenderer.invoke('thirsty:replayPlan',input),
  adviseFromHistory:input=>ipcRenderer.invoke('thirsty:adviseFromHistory',input),
  strategyEvidence:input=>ipcRenderer.invoke('thirsty:strategyEvidence',input),
  resetPrepare:strategy=>ipcRenderer.invoke('thirsty:resetPrepare',strategy),
  testBooking:input=>ipcRenderer.invoke('thirsty:testBooking',input),
  browseCourts:date=>ipcRenderer.invoke('thirsty:browseCourts',date),
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
