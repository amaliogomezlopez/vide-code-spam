const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  dragStart: () => ipcRenderer.send('dictation-overlay-drag-start'),
  dragMove: () => ipcRenderer.send('dictation-overlay-drag-move'),
  dragEnd: () => ipcRenderer.send('dictation-overlay-drag-end'),
  toggle: () => ipcRenderer.invoke('request-global-dictation-toggle'),
  onState: (callback) => {
    const wrapper = (_event, state) => callback(state)
    ipcRenderer.on('dictation-overlay-state', wrapper)
    return () => ipcRenderer.removeListener('dictation-overlay-state', wrapper)
  },
})
