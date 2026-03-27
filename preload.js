const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTraceroute: (opts) => ipcRenderer.invoke('start-traceroute', opts),
  stopTraceroute:  ()     => ipcRenderer.invoke('stop-traceroute'),
  onHopData:            (cb) => ipcRenderer.on('hop-data',            (_e,d) => cb(d)),
  onTracerouteComplete: (cb) => ipcRenderer.on('traceroute-complete', (_e,d) => cb(d)),
  onTracerouteError:    (cb) => ipcRenderer.on('traceroute-error',    (_e,d) => cb(d)),
  removeAll: (ch) => ipcRenderer.removeAllListeners(ch),
  minimize:  () => ipcRenderer.invoke('window-minimize'),
  maximize:  () => ipcRenderer.invoke('window-maximize'),
  close:     () => ipcRenderer.invoke('window-close'),
});
