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
ipcMain.handle('image:getMetadata', async (_evt, inputPath) => {
  try {
    const meta = await sharp(inputPath).metadata()
    const { width, height } = meta
    const oriented = getOrientedSize(meta)
    return { width: width || 0, height: height || 0, orientation: meta.orientation || 1, orientedWidth: oriented.width, orientedHeight: oriented.height }
  } catch (e) {
    return { width: 0, height: 0, orientation: 1, orientedWidth: 0, orientedHeight: 0 }
  }
})
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
  // 记录本次批量导出将要写入的文件路径，避免不同输入文件由于同名而覆盖同一输出，
  // 尤其是在并发写入时会表现为“多张图片融合到一张”的症状。
  const plannedOutputs = new Set()
  function uniqueOutputPath(inputPath) {
    const desired = buildOutputPath(inputPath, outputDir, naming, format)
    const dir = path.dirname(desired)
    const ext = path.extname(desired)
    const baseNoExt = path.basename(desired, ext)
    let candidate = desired
    let idx = 2
    // 若已在本批计划内或磁盘已存在，则追加 -2, -3 ... 直到唯一
    while (plannedOutputs.has(candidate) || existsSync(candidate)) {
      candidate = path.join(dir, `${baseNoExt}-${idx}${ext}`)
      idx++
    }
    plannedOutputs.add(candidate)
    return candidate
  }

  const results = []
  await Promise.all(tasks.map(task => queue.add(async () => {
    const { inputPath, config } = task
    const { type, text, image, layout } = config

  // 读取原始元数据，计算“应用 EXIF 后”的目标宽高，用于定位与叠加
  const srcMeta = await sharp(inputPath).metadata()
  const { width: W, height: H } = getOrientedSize(srcMeta)
  // 应用 EXIF 方向，保证像素坐标与视觉方向一致
  const img = sharp(inputPath).rotate()

    // Build overlay
    let overlayInput
    if (type === 'text') {
      // 文本水印：先将 SVG 栅格化为 PNG，再进行复合，提升兼容性
      const svg = buildTextSVG(text, layout, W, H)
      // 直接以 SVG 覆盖，避免某些环境下 SVG->PNG 栅格化导致透明输出
      overlayInput = Buffer.from(svg)
      // 额外准备一个 PNG 栅格化后备，极端环境下双重叠加可提升可见性
      try {
        var overlayFallbackPng = await sharp(Buffer.from(svg), { density: 300 }).png().toBuffer()
      } catch {}
    } else if (type === 'image' && image?.path) {
      // 图片水印：缩放并放置在全画布透明图层上，再与原图复合
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

  // Output（生成唯一文件名，避免批量覆盖/并发写入冲突）
  let outputPath = uniqueOutputPath(inputPath)
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

ipcMain.handle('template:delete', async (_evt, name) => {
  try {
    const dir = getTemplatesDir()
    const p = path.join(dir, `${sanitize(name)}.json`)
    await fsp.unlink(p)
    return true
  } catch {
    return false
  }
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
  // 当 prefix 为 undefined/null 时使用默认 'wm_'；若为 '' 空字符串则不加前缀
  const prefix = (naming && (naming.prefix !== undefined && naming.prefix !== null)) ? naming.prefix : 'wm_'
  if (prefix) name = `${prefix}${name}`
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
  // 预览画布固定为 480x300（见 PreviewBox），使用 contain 缩放：scale = min(480/W, 300/H)
  // 预览 1 像素 ≈ 原图 1/scale 像素，因此导出字号 = 预览字号 / scale
  const PREVIEW_W = 480, PREVIEW_H = 300
  const scalePreviewToImage = Math.min(PREVIEW_W / (W || PREVIEW_W), PREVIEW_H / (H || PREVIEW_H))
  const fontSizeRaw = text?.fontSize || 32
  const fontSize = Math.max(8, (fontSizeRaw / (scalePreviewToImage || 1)))
  const color = text?.color || '#FFFFFF'
  const opacity = Math.max(0, Math.min(1, text?.opacity ?? 0.6))
  // 根据九宫格预设决定 SVG 文本的锚点与基线，和预览端保持一致
  function getSvgAnchors(preset) {
    switch (preset) {
      case 'tl': return { anchor: 'start', baseline: 'text-before-edge', vAlign: 'top' }
      case 'tc': return { anchor: 'middle', baseline: 'text-before-edge', vAlign: 'top' }
      case 'tr': return { anchor: 'end',   baseline: 'text-before-edge', vAlign: 'top' }
      case 'cl': return { anchor: 'start', baseline: 'middle', vAlign: 'middle' }
      case 'center': return { anchor: 'middle', baseline: 'middle', vAlign: 'middle' }
      case 'cr': return { anchor: 'end',   baseline: 'middle', vAlign: 'middle' }
      case 'bl': return { anchor: 'start', baseline: 'text-after-edge', vAlign: 'bottom' }
      case 'bc': return { anchor: 'middle', baseline: 'text-after-edge', vAlign: 'bottom' }
      case 'br': return { anchor: 'end',   baseline: 'text-after-edge', vAlign: 'bottom' }
      default: return { anchor: 'middle', baseline: 'middle', vAlign: 'middle' }
    }
  }
  const { anchor, baseline, vAlign } = getSvgAnchors(layout?.preset)
  // 使用真实的偏移量，确保与预览拖拽保持一致
  const { left, top } = calcPosition({ preset: layout?.preset, offsetX: layout?.offsetX || 0, offsetY: layout?.offsetY || 0 }, W, H)
  const x = left
  let y = top
    // 为不同垂直对齐做补偿：许多 SVG 渲染器（如 librsvg）会忽略 dominant-baseline，
    // 这里使用 dy 近似补偿到与预览一致的视觉效果。
    // 经验值：ascent≈0.8em，descent≈0.2em，中线≈+0.40em（向下为正）。
    let dyPx = 0
    if (vAlign === 'top') {
      dyPx = Math.round(fontSize * 0.8) // 顶部锚点补偿
    } else if (vAlign === 'middle') {
      dyPx = fontSize * 0.40 // 中心对齐更贴近浏览器渲染的视觉中心
    } else if (vAlign === 'bottom') {
      dyPx = -Math.round(fontSize * 0.2) // 底部锚点补偿
    }
    // 叠加来自 UI 的“基线微调”（预览像素），需要换算到原图像素
    const baselineAdjustPreviewPx = Number(text?.baselineAdjust || 0)
    if (baselineAdjustPreviewPx) {
      const baselineAdjustImagePx = baselineAdjustPreviewPx / (scalePreviewToImage || 1)
      dyPx += baselineAdjustImagePx
    }
    // 为提升兼容性，避免使用 dy 属性（部分渲染器处理不一致），改为直接叠加到 y 坐标
    y = y + dyPx
  // Basic SVG text; advanced shadow/stroke可后续扩展
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${color}" fill-opacity="${opacity}" font-family="${fontFamily}" font-size="${fontSize}" paint-order="stroke" stroke="rgba(0,0,0,0.25)" stroke-width="${Math.max(1, Math.round(fontSize/48))}">${content}</text>
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

// 依据 EXIF orientation 计算“旋转后”的宽高，确保定位使用的是与预览一致的方向空间
function getOrientedSize(meta) {
  const w = meta?.width || 1024
  const h = meta?.height || 768
  const ori = meta?.orientation
  // 1,2,3,4 不交换宽高；5,6,7,8 交换宽高
  if ([5,6,7,8].includes(ori)) return { width: h, height: w }
  return { width: w, height: h }
}
