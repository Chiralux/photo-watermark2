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

  // 应用 EXIF 方向，保证像素坐标与视觉方向一致
  const img = sharp(inputPath).rotate()
  const meta = await img.metadata()

    // Build overlay
    let overlayInput
  if (type === 'text') {
      // 文本水印：先将 SVG 栅格化为 PNG，再进行复合，提升兼容性
      const W = meta.width || 1024
      const H = meta.height || 768
      const svg = buildTextSVG(text, layout, W, H)
      // 直接以 SVG 覆盖，避免某些环境下 SVG->PNG 栅格化导致透明输出
      overlayInput = Buffer.from(svg)
      // 额外准备一个 PNG 栅格化后备，极端环境下双重叠加可提升可见性
      try {
        var overlayFallbackPng = await sharp(Buffer.from(svg), { density: 300 }).png().toBuffer()
      } catch {}
    } else if (type === 'image' && image?.path) {
      // 图片水印：缩放并放置在全画布透明图层上，再与原图复合
      const W = meta.width || 1024
      const H = meta.height || 768
      const wmm = await sharp(image.path).metadata()
      const scale = Math.max(0.01, image.scale || 1)
      const ww = Math.max(1, Math.round((wmm.width || 1) * scale))
      const hh = Math.max(1, Math.round((wmm.height || 1) * scale))
      const wmBuf = await sharp(image.path).resize({ width: ww, height: hh, fit: 'inside' }).png().toBuffer()
      const pos = calcPosition(layout, W, H)
      // 将中心定位转换为左上角，并限制在画布内
      let left = Math.round(pos.left - ww / 2)
      let top = Math.round(pos.top - hh / 2)
      left = Math.max(0, Math.min(W - ww, left))
      top = Math.max(0, Math.min(H - hh, top))
      overlayInput = await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      })
        .png()
        .composite([{ input: wmBuf, left, top, blend: 'over', opacity: Math.max(0, Math.min(1, image.opacity ?? 0.6)) }])
        .png()
        .toBuffer()
    }

  // Composite: overlayBuffer 是整幅画布尺寸的 SVG，贴在 (0,0)
  if (!overlayInput) {
    console.warn('[export] No overlay generated for', inputPath, 'type:', type)
  }
  let composites = []
  if (overlayInput) composites.push({ input: overlayInput, top: 0, left: 0 })
  if (typeof overlayFallbackPng !== 'undefined') composites.push({ input: overlayFallbackPng, top: 0, left: 0 })
  let pipeline = composites.length ? img.composite(composites) : img

    // Output
    let outputPath = buildOutputPath(inputPath, outputDir, naming, format)
    if (format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: Math.max(1, Math.min(100, jpegQuality || 90)) })
    } else {
      pipeline = pipeline.png()
    }
  // 清除方向标记，避免查看器再次旋转
  await pipeline.withMetadata({ orientation: 1 }).toFile(outputPath)
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
    case 'tr': x = Math.max(0, W - margin); y = margin; break
    case 'cl': x = margin; y = Math.floor(H / 2); break
    case 'center': x = Math.floor(W / 2); y = Math.floor(H / 2); break
    case 'cr': x = Math.max(0, W - margin); y = Math.floor(H / 2); break
    case 'bl': x = margin; y = Math.max(0, H - margin); break
    case 'bc': x = Math.floor(W / 2); y = Math.max(0, H - margin); break
    case 'br': x = Math.max(0, W - margin); y = Math.max(0, H - margin); break
  }
  const left = Math.max(0, Math.min(W - 1, Math.round(x + (layout?.offsetX || 0))))
  const top = Math.max(0, Math.min(H - 1, Math.round(y + (layout?.offsetY || 0))))
  return { left, top }
}

function buildTextSVG(text, layout, W, H) {
  const content = escapeHtml(text?.content || 'Watermark')
  const fontFamily = text?.fontFamily || 'Arial, Helvetica, sans-serif'
  // 将预览中的字号（以预览画布像素计）按比例换算到原图像素：
  // 预览画布固定为 480x300（见 PreviewBox），cover 缩放比例 scale = max(480/W, 300/H)
  // 预览 1 像素 ≈ 原图 1/scale 像素，因此导出字号 = 预览字号 / scale
  const PREVIEW_W = 480, PREVIEW_H = 300
  const scalePreviewToImage = Math.max(PREVIEW_W / (W || PREVIEW_W), PREVIEW_H / (H || PREVIEW_H))
  const fontSizeRaw = text?.fontSize || 32
  const fontSize = Math.max(8, Math.round(fontSizeRaw / (scalePreviewToImage || 1)))
  const color = text?.color || '#FFFFFF'
  const opacity = Math.max(0, Math.min(1, text?.opacity ?? 0.6))
  const anchor = 'middle'
  // 使用真实的偏移量，确保与预览拖拽保持一致
  const { left, top } = calcPosition({ preset: layout?.preset, offsetX: layout?.offsetX || 0, offsetY: layout?.offsetY || 0 }, W, H)
  const x = left
  const y = top
  // Basic SVG text; advanced shadow/stroke可后续扩展
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${color}" fill-opacity="${opacity}" font-family="${fontFamily}" font-size="${fontSize}" paint-order="stroke" stroke="rgba(0,0,0,0.25)" stroke-width="${Math.max(1, Math.round(fontSize/48))}">${content}</text>
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
