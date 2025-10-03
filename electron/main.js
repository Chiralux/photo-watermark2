import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import url from 'node:url'
import { fileURLToPath } from 'node:url'

// 模块化的 IPC 注册
import { registerSystemFontsIpc } from './ipc/systemFonts.js'
import { registerImageMetaIpc } from './ipc/imageMeta.js'
import { registerDialogIpc, registerIngestIpc } from './ipc/dialogs.js'
import { registerPreviewIpc } from './ipc/preview.js'
import { registerExportIpc } from './ipc/exporter.js'
import { registerTemplatesIpc } from './ipc/templates.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow
const isDev = process.env.NODE_ENV === 'development' || process.argv.some(arg => arg === '--dev')

// 开发环境下关闭硬件加速以避免个别设备 GPU 驱动问题
if (isDev) {
  try { app.disableHardwareAcceleration() } catch {}
  try { app.commandLine.appendSwitch('disable-gpu') } catch {}
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err?.stack || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !isDev,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer] did-fail-load:', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.on('unresponsive', () => console.error('[window] unresponsive'))

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devUrl)
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'renderer', 'index.html')
    const indexPath = url.pathToFileURL(indexHtml).toString()
    console.log('[main] loading index:', indexPath)
    mainWindow.loadURL(indexPath).catch(err => {
      console.error('[main] loadURL error:', err)
    })
  }
}

function registerIpc() {
  registerSystemFontsIpc(ipcMain)
  registerImageMetaIpc(ipcMain)
  registerDialogIpc(ipcMain, () => mainWindow)
  registerIngestIpc(ipcMain)
  registerPreviewIpc(ipcMain, isDev)
  registerExportIpc(ipcMain, isDev)
  registerTemplatesIpc(ipcMain)
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

