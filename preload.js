const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  setAlwaysOnTop: (on) => ipcRenderer.invoke('set-always-on-top', on),
  setIgnoreMouse: (on) => ipcRenderer.invoke('set-ignore-mouse', on)
});