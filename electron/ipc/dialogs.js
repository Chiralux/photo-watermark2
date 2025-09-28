import { dialog } from 'electron'
import path from 'node:path'
import { listImages } from '../utils/files.js'

export function registerDialogIpc(ipcMain, getMainWindow) {
  ipcMain.handle('dialog:openFiles', async () => {
    const win = getMainWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择图片或文件夹',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (canceled) return []
    return listImages(filePaths)
  })

  ipcMain.handle('dialog:selectOutputDir', async () => {
    const win = getMainWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled) return ''
    return filePaths[0]
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const win = getMainWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择含有图片的文件夹',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent']
    })
    if (canceled) return []
    return listImages(filePaths)
  })
}

export function registerIngestIpc(ipcMain) {
  ipcMain.handle('ingest:paths', async (_evt, paths) => {
    try { return listImages(Array.isArray(paths) ? paths : []) } catch { return [] }
  })
}
