const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getBackendConnection: () => ipcRenderer.invoke('get-backend-connection'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectExecutable: () => ipcRenderer.invoke('select-executable'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getPlatformCapabilities: () => ipcRenderer.invoke('get-platform-capabilities'),
  requestMacOSAccessibility: () => ipcRenderer.invoke('request-macos-accessibility'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  beginShortcutCapture: () => ipcRenderer.invoke('begin-shortcut-capture'),
  endShortcutCapture: () => ipcRenderer.invoke('end-shortcut-capture'),
  onSettingsChanged: (callback) => {
    const wrapper = (_event, settings) => callback(settings)
    ipcRenderer.on('settings-changed', wrapper)
    return () => ipcRenderer.removeListener('settings-changed', wrapper)
  },
  onGlobalPushToTalk: (callback) => {
    const wrapper = (_event, state) => callback(state)
    ipcRenderer.on('global-push-to-talk', wrapper)
    return () => ipcRenderer.removeListener('global-push-to-talk', wrapper)
  },
  onGlobalDictation: (callback) => {
    const wrapper = (_event, state) => callback(state)
    ipcRenderer.on('global-dictation', wrapper)
    return () => ipcRenderer.removeListener('global-dictation', wrapper)
  },
  onGlobalShowWindow: (callback) => {
    const wrapper = () => callback()
    ipcRenderer.on('global-show-window', wrapper)
    return () => ipcRenderer.removeListener('global-show-window', wrapper)
  },
  onDictationDebug: (callback) => {
    const wrapper = (_event, event) => callback(event)
    ipcRenderer.on('dictation-debug', wrapper)
    return () => ipcRenderer.removeListener('dictation-debug', wrapper)
  },
  updateDictationOverlay: (state) => ipcRenderer.invoke('update-dictation-overlay', state),
  insertGlobalDictationText: (text) => ipcRenderer.invoke('insert-global-dictation-text', text),
  requestGlobalDictationToggle: () => ipcRenderer.invoke('request-global-dictation-toggle'),
})
