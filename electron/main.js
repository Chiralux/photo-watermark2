import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import url from 'node:url'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readdirSync, statSync, promises as fsp } from 'node:fs'
import os from 'node:os'
import sharp from 'sharp'
import PQueue from 'p-queue'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow

const isDev = process.env.NODE_ENV === 'development' || process.argv.some(arg => arg === '--dev')

function createWindow () {
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

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devUrl)
  } else {
    const indexPath = url.pathToFileURL(path.join(__dirname, '..', 'dist', 'renderer', 'index.html')).toString()
    mainWindow.loadURL(indexPath)
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// Minimal IPC handlers
ipcMain.handle('dialog:openFiles', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片或文件夹',
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (canceled) return []
  const images = listImages(filePaths)
  return images
})

// 解析拖放路径：展开文件夹并筛选图片
ipcMain.handle('ingest:paths', async (_evt, paths) => {
  try { return listImages(Array.isArray(paths) ? paths : []) } catch { return [] }
})

ipcMain.handle('dialog:selectOutputDir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled) return ''
  return filePaths[0]
})

ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择含有图片的文件夹',
    properties: ['openDirectory', 'multiSelections', 'dontAddToRecent']
  })
  if (canceled) return []
  return listImages(filePaths)
})

ipcMain.handle('export:applyWatermark', async (_evt, payload) => {
  const { tasks, outputDir, format, naming, jpegQuality } = payload
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const concurrency = Math.max(1, Math.min(os.cpus()?.length || 4, 4))
  const queue = new PQueue({ concurrency })

  const results = []
  await Promise.all(tasks.map(task => queue.add(async () => {
    const { inputPath, config } = task
    const { type, text, image, layout } = config

    const img = sharp(inputPath)
    const meta = await img.metadata()

    // Build overlay
    let overlayBuffer
    if (type === 'text') {
      // SVG based text rendering to preserve quality and effects baseline
      const svg = buildTextSVG(text, layout, meta.width || 1024, meta.height || 768)
      overlayBuffer = Buffer.from(svg)
    } else if (type === 'image' && image?.path) {
      // Scale image watermark if needed; here we simply load and set opacity later via composite
      overlayBuffer = await sharp(image.path).toBuffer()
    }

  // Composite: overlayBuffer 是整幅画布尺寸的 SVG，贴在 (0,0)
  let pipeline = img.composite([{ input: overlayBuffer, top: 0, left: 0 }])

    // Output
    let outputPath = buildOutputPath(inputPath, outputDir, naming, format)
    if (format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: Math.max(1, Math.min(100, jpegQuality || 90)) })
    } else {
      pipeline = pipeline.png()
    }
    await pipeline.toFile(outputPath)
    results.push({ inputPath, outputPath, ok: true })
  })))

  return results
})

// Template management
ipcMain.handle('template:list', async () => {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const names = readdirSync(dir).filter(n => n.endsWith('.json') && n !== '_last.json').map(n => n.replace(/\.json$/, ''))
  return names
})

ipcMain.handle('template:load', async (_evt, name) => {
  const dir = getTemplatesDir()
  const p = path.join(dir, `${sanitize(name)}.json`)
  const txt = await fsp.readFile(p, 'utf-8')
  return JSON.parse(txt)
})

ipcMain.handle('template:save', async (_evt, { name, data }) => {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `${sanitize(name)}.json`)
  await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
  return true
})

ipcMain.handle('template:loadLast', async () => {
  try {
    const p = path.join(getTemplatesDir(), `_last.json`)
    const txt = await fsp.readFile(p, 'utf-8')
    return JSON.parse(txt)
  } catch { return null }
})

ipcMain.handle('template:saveLast', async (_evt, data) => {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `_last.json`)
  await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
  return true
})

function buildOutputPath(inputPath, outputDir, naming, format) {
  const base = path.basename(inputPath)
  const ext = format === 'jpeg' ? '.jpg' : '.png'
  const nameNoExt = base.replace(/\.[^.]+$/, '')
  let name = nameNoExt
  if (naming?.prefix) name = `${naming.prefix}${name}`
  if (naming?.suffix) name = `${name}${naming.suffix}`
  return path.join(outputDir, `${name}${ext}`)
}

function calcPosition(layout, W, H) {
  const margin = 16
  const preset = layout?.preset || 'center'
  let x = Math.floor(W / 2), y = Math.floor(H / 2)
  switch (preset) {
    case 'tl': x = margin; y = margin; break
    case 'tc': x = Math.floor(W / 2); y = margin; break
    case 'tr': x = W - margin; y = margin; break
    case 'cl': x = margin; y = Math.floor(H / 2); break
    case 'center': x = Math.floor(W / 2); y = Math.floor(H / 2); break
    case 'cr': x = W - margin; y = Math.floor(H / 2); break
    case 'bl': x = margin; y = H - margin; break
    case 'bc': x = Math.floor(W / 2); y = H - margin; break
    case 'br': x = W - margin; y = H - margin; break
  }
  const left = Math.max(0, Math.min(W, Math.round(x + (layout?.offsetX || 0))))
  const top = Math.max(0, Math.min(H, Math.round(y + (layout?.offsetY || 0))))
  return { left, top }
}

function buildTextSVG(text, layout, W, H) {
  const content = escapeHtml(text?.content || 'Watermark')
  const fontFamily = text?.fontFamily || 'Arial'
  const fontSize = text?.fontSize || 32
  const color = text?.color || '#FFFFFF'
  const opacity = Math.max(0, Math.min(1, text?.opacity ?? 0.6))
  const anchor = 'middle'
  const { left, top } = calcPosition({ preset: layout?.preset, offsetX: 0, offsetY: 0 }, W, H)
  const x = left
  const y = top
  // Basic SVG text; advanced shadow/stroke可后续扩展
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" fill-opacity="${opacity}" font-family="${fontFamily}" font-size="${fontSize}">${content}</text>
  </svg>`
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))
}

function listImages(paths) {
  const out = new Set()
  const exts = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'])
  for (const p of paths) {
    try {
      const st = statSync(p)
      if (st.isDirectory()) {
        walkDir(p, out, exts)
      } else if (st.isFile()) {
        const ext = path.extname(p).toLowerCase()
        if (exts.has(ext)) out.add(p)
      }
    } catch {}
  }
  return Array.from(out)
}

function walkDir(dir, out, exts) {
  try {
    const entries = readdirSync(dir)
    for (const name of entries) {
      const full = path.join(dir, name)
      try {
        const st = statSync(full)
        if (st.isDirectory()) walkDir(full, out, exts)
        else if (st.isFile()) {
          const ext = path.extname(full).toLowerCase()
          if (exts.has(ext)) out.add(full)
        }
      } catch {}
    }
  } catch {}
}

function getTemplatesDir() {
  return path.join(app.getPath('userData'), 'templates')
}

function sanitize(name='template') {
  return String(name).replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 64) || 'template'
}
