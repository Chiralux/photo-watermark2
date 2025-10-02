const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectOutputDir'),
  exportApplyWatermark: (payload) => ipcRenderer.invoke('export:applyWatermark', payload),
  templates: {
    list: () => ipcRenderer.invoke('template:list'),
    load: (name) => ipcRenderer.invoke('template:load', name),
    save: (name, data) => ipcRenderer.invoke('template:save', { name, data }),
    delete: (name) => ipcRenderer.invoke('template:delete', name),
    loadLast: () => ipcRenderer.invoke('template:loadLast'),
    saveLast: (data) => ipcRenderer.invoke('template:saveLast', data),
    getAutoLoadConfig: () => ipcRenderer.invoke('template:getAutoLoadConfig'),
    setAutoLoadConfig: (cfg) => ipcRenderer.invoke('template:setAutoLoadConfig', cfg)
  },
  preview: {
    render: (payload) => ipcRenderer.invoke('preview:render', payload),
    cancel: (jobId) => ipcRenderer.invoke('preview:cancel', jobId)
  },
  systemFonts: {
    list: () => ipcRenderer.invoke('systemFonts:list'),
    styles: () => ipcRenderer.invoke('systemFonts:styles')
  },
  meta: {
    getFallbackConfig: () => ipcRenderer.invoke('meta:getFallbackConfig'),
    setFallbackConfig: (cfg) => ipcRenderer.invoke('meta:setFallbackConfig', cfg)
  },
  previewRender: (payload) => ipcRenderer.invoke('preview:render', payload)
})

// 额外暴露拖拽路径解析 API
contextBridge.exposeInMainWorld('dragIngest', {
  ingest: (paths) => ipcRenderer.invoke('ingest:paths', paths)
})

// 提供读取图片元信息（含 EXIF 方向影响后的宽高）的方法
contextBridge.exposeInMainWorld('imageMeta', {
  get: (path) => ipcRenderer.invoke('image:getMetadata', path)
})

// 导出进度事件订阅
contextBridge.exposeInMainWorld('exportProgress', {
  on: (handler) => {
    const cb = (_evt, payload) => { try { handler && handler(payload) } catch {} }
    ipcRenderer.on('export:progress', cb)
    return () => ipcRenderer.removeListener('export:progress', cb)
  }
})
