const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  act: (action, args) => ipcRenderer.invoke('desktop:action', action, args),
  onChange(callback) {
    const listener = () => callback()
    ipcRenderer.on('desktop:changed', listener)
    return () => ipcRenderer.removeListener('desktop:changed', listener)
  }
})
