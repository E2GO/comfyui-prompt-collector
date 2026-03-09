const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  clearThumbCache: () => ipcRenderer.invoke('clear-thumb-cache'),
  getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (path) => ipcRenderer.invoke('scan-folder', path),
  exportPrompts: (data) => ipcRenderer.invoke('export-prompts', data),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  onScanProgress: (callback) =>
    ipcRenderer.on('scan-progress', (_, data) => callback(data)),
  onMenuSelectFolder: (callback) =>
    ipcRenderer.on('menu-select-folder', () => callback()),
  onMenuExport: (callback) =>
    ipcRenderer.on('menu-export', (_, format) => callback(format)),
  onMenuToggleSort: (callback) =>
    ipcRenderer.on('menu-toggle-sort', () => callback()),
});
