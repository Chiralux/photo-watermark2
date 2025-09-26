import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectOutputDir'),
  exportApplyWatermark: (payload) => ipcRenderer.invoke('export:applyWatermark', payload),
  templates: {
    list: () => ipcRenderer.invoke('template:list'),
    load: (name) => ipcRenderer.invoke('template:load', name),
    save: (name, data) => ipcRenderer.invoke('template:save', { name, data }),
    loadLast: () => ipcRenderer.invoke('template:loadLast'),
    saveLast: (data) => ipcRenderer.invoke('template:saveLast', data)
  }
})
