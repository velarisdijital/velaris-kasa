const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('velarisDesktop', {
  print: () => ipcRenderer.invoke('velaris:print'),
});
