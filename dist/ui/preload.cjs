"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const bridge = {
    focusBrowser: request => electron_1.ipcRenderer.invoke('thirsty:focusBrowser', request),
    resetPrepare: strategy => electron_1.ipcRenderer.invoke('thirsty:resetPrepare', strategy),
    testBooking: input => electron_1.ipcRenderer.invoke('thirsty:testBooking', input),
    apiPreview: date => electron_1.ipcRenderer.invoke('thirsty:apiPreview', date),
    setWorkflow: workflow => electron_1.ipcRenderer.invoke('thirsty:setWorkflow', workflow),
    invalidatePreparation: () => electron_1.ipcRenderer.invoke('thirsty:invalidatePreparation'),
    prepareDual: () => electron_1.ipcRenderer.invoke('thirsty:prepareDual'),
    runDualPractice: input => electron_1.ipcRenderer.invoke('thirsty:runDualPractice', input),
    reviewLock: () => electron_1.ipcRenderer.invoke('thirsty:reviewLock'),
    clearLock: () => electron_1.ipcRenderer.invoke('thirsty:clearLock'),
    resetPractice: () => electron_1.ipcRenderer.invoke('thirsty:resetPractice'),
    runFullPractice: input => electron_1.ipcRenderer.invoke('thirsty:runFullPractice', input),
    startChrome: () => electron_1.ipcRenderer.invoke('thirsty:startChrome'),
    inspectOnda: () => electron_1.ipcRenderer.invoke('thirsty:inspectOnda'),
    prepare: () => electron_1.ipcRenderer.invoke('thirsty:prepare'),
    armObservation: () => electron_1.ipcRenderer.invoke('thirsty:armObservation'),
    armSelection: () => electron_1.ipcRenderer.invoke('thirsty:armSelection'),
    armFullBooking: () => electron_1.ipcRenderer.invoke('thirsty:armFullBooking'),
    cancelScheduledRelease: () => electron_1.ipcRenderer.invoke('thirsty:cancelScheduledRelease'),
    setMode: mode => electron_1.ipcRenderer.invoke('thirsty:setMode', mode),
    authorizeTerms: value => electron_1.ipcRenderer.invoke('thirsty:authorizeTerms', value),
    dryRace: () => electron_1.ipcRenderer.invoke('thirsty:dryRace'),
    saveBooking: input => electron_1.ipcRenderer.invoke('thirsty:saveBooking', input),
    runPractice: input => electron_1.ipcRenderer.invoke('thirsty:runPractice', input),
    abortAutomation: () => electron_1.ipcRenderer.invoke('thirsty:abortAutomation'),
    getStatus: () => electron_1.ipcRenderer.invoke('thirsty:getStatus'),
    onStatus: callback => {
        const listener = (_event, status) => callback(status);
        electron_1.ipcRenderer.on('thirsty:status', listener);
        return () => electron_1.ipcRenderer.removeListener('thirsty:status', listener);
    },
};
electron_1.contextBridge.exposeInMainWorld('thirsty', bridge);
//# sourceMappingURL=preload.cjs.map