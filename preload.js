const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendData: (data) => ipcRenderer.send('channel-name', data),
  onResponse: (callback) => ipcRenderer.on('reply-channel', (event, ...args) => callback(...args))
});