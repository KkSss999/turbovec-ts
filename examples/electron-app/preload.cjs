const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smoke', {
  search: () => ipcRenderer.invoke('smoke:search'),
});
