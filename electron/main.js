import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import url from 'node:url'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readdirSync, statSync, promises as fsp } from 'node:fs'
import os from 'node:os'
import sharp from 'sharp'
import PQueue from 'p-queue'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let exifReader
try { exifReader = require('exif-reader') } catch { exifReader = null }
let exifParser
try { exifParser = require('exif-parser') } catch { exifParser = null }
let exifr
try { exifr = require('exifr') } catch { exifr = null }
// 可选依赖：系统字体枚举
let fontList
try { fontList = require('font-list') } catch { fontList = null }
let fontScanner
try { fontScanner = require('font-scanner') } catch { fontScanner = null }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow

const isDev = process.env.NODE_ENV === 'development' || process.argv.some(arg => arg === '--dev')

// 在开发模式下禁用硬件加速，避免部分环境下 GPU 驱动导致 Electron 进程退出
if (isDev) {
  try { app.disableHardwareAcceleration() } catch {}
  try { app.commandLine.appendSwitch('disable-gpu') } catch {}
}

// 全局错误日志，便于在 dev 终端看到具体原因
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err?.stack || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

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

  // 记录渲染进程异常与加载失败
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone:', details)
  })
  mainWindow.webContents.on('child-process-gone', (_e, details) => {
    console.error('[renderer] child gone:', details)
  })
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer] did-fail-load:', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.on('unresponsive', () => console.error('[window] unresponsive'))

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

// 系统字体列表（用于渲染进程选择字体家族）
ipcMain.handle('systemFonts:list', async () => {
  try {
    if (fontList && typeof fontList.getFonts === 'function') {
      const fonts = await fontList.getFonts()
      const families = Array.isArray(fonts) ? Array.from(new Set(fonts)).filter(Boolean).sort((a,b)=>a.localeCompare(b)) : []
      if (families.length) return families
    }
    if (fontScanner && typeof fontScanner.getAvailableFontsSync === 'function') {
      const fonts = fontScanner.getAvailableFontsSync()
      // 仅返回家族名，去重并排序
      const families = Array.from(new Set(fonts.map(f => f.family))).filter(Boolean).sort((a,b)=>a.localeCompare(b))
      return families
    }
  } catch {}
  // 兜底：简单扫描常见字体目录
  try {
    const dirs = []
    const pushIf = (p)=>{ try { if (existsSync(p)) dirs.push(p) } catch {} }
    if (process.platform === 'win32') {
      pushIf(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'))
    } else if (process.platform === 'darwin') {
      pushIf('/System/Library/Fonts'); pushIf('/Library/Fonts'); pushIf(path.join(os.homedir(), 'Library/Fonts'))
    } else {
      pushIf('/usr/share/fonts'); pushIf('/usr/local/share/fonts'); pushIf(path.join(os.homedir(), '.fonts'))
    }
    const families = new Set()
    const tryAdd = (name)=>{ if (!name) return; const fam = String(name).replace(/\.(ttf|otf|ttc)$/i,''); families.add(fam) }
    for (const d of dirs) {
      let list = []
      try { list = readdirSync(d) } catch { continue }
      for (const n of list) {
        if (/\.(ttf|otf|ttc)$/i.test(n)) tryAdd(n)
      }
    }
    return Array.from(families).sort((a,b)=>a.localeCompare(b))
  } catch { return [] }
})

// 返回各字体家族是否包含 italic/oblique 样式
ipcMain.handle('systemFonts:styles', async () => {
  try {
    if (fontScanner && typeof fontScanner.getAvailableFontsSync === 'function') {
      const fonts = fontScanner.getAvailableFontsSync()
      const map = new Map()
      for (const f of fonts) {
        const fam = f?.family
        if (!fam) continue
        const style = String(f?.style || '').toLowerCase()
        const italicish = /italic|oblique/.test(style)
        if (!map.has(fam)) map.set(fam, { hasItalic: false, styles: new Set() })
        const ent = map.get(fam)
        if (italicish) ent.hasItalic = true
        ent.styles.add(f?.style || '')
      }
      // 转换为纯对象，styles 转数组
      const out = {}
      for (const [k, v] of map.entries()) {
        out[k] = { hasItalic: !!v.hasItalic, styles: Array.from(v.styles) }
      }
      return out
    }
  } catch {}
  return {}
})

// Minimal IPC handlers
ipcMain.handle('image:getMetadata', async (_evt, inputPath) => {
  try {
    const meta = await sharp(inputPath).metadata()
    const { width, height } = meta
    const oriented = getOrientedSize(meta)
    // 解析拍摄时间：优先图片元数据（EXIF/XMP），可选启用文件名/文件时间回退（通过配置）
    let dateTaken = null
    let dateSource = null
    try {
      // EXIF (APP1)
      if (meta.exif && exifReader) {
        const ex = exifReader(meta.exif) || {}
        const exif = ex.exif || ex.Exif || ex
        const imageIfd = ex.image || ex.Image || {}
        const dt = (
          exif?.DateTimeOriginal ||
          exif?.DateTimeDigitized ||
          exif?.CreateDate ||
          imageIfd?.DateTime ||
          exif?.ModifyDate ||
          imageIfd?.ModifyDate
        )
        const f = formatExifDate(dt)
        if (f) { dateTaken = f; dateSource = 'exif' }
        // 补充：若以上均无，则尝试 GPS 日期时间（部分图片仅写在 GPS IFD）
        if (!dateTaken) {
          const gps = ex.gps || ex.GPS || {}
          const gpsDate = gps?.GPSDateStamp || gps?.DateStamp
          const gpsTime = gps?.GPSTimeStamp || gps?.TimeStamp
          const gf = formatGpsDateTime(gpsDate, gpsTime)
          if (gf) { dateTaken = gf; dateSource = 'gps' }
        }
      }
      // 后备：使用 exif-parser 解析（很多设备可识别）
      if (!dateTaken && exifParser) {
        try {
          const buf = meta.exif ? meta.exif : await fsp.readFile(inputPath)
          const parser = exifParser.create(buf)
          const res = parser.parse()
          const tags = res?.tags || {}
          const dt2 = (
            tags.DateTimeOriginal ??
            tags.CreateDate ??
            tags.ModifyDate ??
            tags.DateTimeDigitized ??
            null
          )
          const f2 = formatExifDate(dt2)
          if (f2) { dateTaken = f2; dateSource = 'exif' }
          if (!dateTaken) {
            const gf = formatGpsDateTime(tags.GPSDateStamp, tags.GPSTimeStamp)
            if (gf) { dateTaken = gf; dateSource = 'gps' }
          }
        } catch {}
      }
      // Fallback: 若 exif-reader 未解析出时间，尝试直接从 EXIF 二进制中正则提取
      if (!dateTaken && meta.exif) {
        try {
          const ascii = Buffer.from(meta.exif).toString('latin1')
          const tags = [
            /DateTimeOriginal[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
            /DateTimeDigitized[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
            /CreateDate[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
            /ModifyDate[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
            /DateTime[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
          ]
          for (const re of tags) {
            const m = ascii.match(re)
            if (m) { dateTaken = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`; dateSource = 'exif'; break }
          }
        } catch {}
      }
      // XMP (APP1) — 作为补充：解析常见标签
      if (!dateTaken && meta.xmp) {
        const f = parseXmpForDate(meta.xmp)
        if (f) { dateTaken = f; dateSource = 'xmp' }
      }
      // exifr 作为进一步后备，尽量贴近 Java 的 metadata-extractor 行为
      if (!dateTaken && exifr) {
        try {
          const out = await exifr.parse(inputPath, { tiff: true, ifd0: true, exif: true, gps: true, xmp: true })
          const dt = out?.DateTimeOriginal || out?.CreateDate || out?.ModifyDate || out?.DateTimeDigitized || out?.DateTime
          const f4 = formatExifDate(dt)
          if (f4) { dateTaken = f4; dateSource = 'exif' }
          if (!dateTaken) {
            const gf = formatGpsDateTime(out?.GPSDateStamp, out?.GPSTimeStamp)
            if (gf) { dateTaken = gf; dateSource = 'gps' }
          }
        } catch {}
      }
      // 读取配置，决定是否启用回退：文件名/文件时间
      if (!dateTaken) {
        try {
          const cfg = await readTemplateConfig()
          const useName = cfg?.metaFallback?.allowFilename !== false
          const useFile = cfg?.metaFallback?.allowFileTime === true
          if (useName && !dateTaken) {
            const f = parseDateFromFilename(inputPath)
            if (f) { dateTaken = f; dateSource = 'filename' }
          }
          if (useFile && !dateTaken) {
            try {
              const st = statSync(inputPath)
              if (st?.mtime) {
                const f2 = formatExifDate(st.mtime)
                if (f2) { dateTaken = f2; dateSource = 'filetime' }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
    return { width: width || 0, height: height || 0, orientation: meta.orientation || 1, orientedWidth: oriented.width, orientedHeight: oriented.height, dateTaken, dateSource }
  } catch (e) {
    return { width: 0, height: 0, orientation: 1, orientedWidth: 0, orientedHeight: 0, dateTaken: null, dateSource: null }
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
  const { tasks, outputDir, format, naming, jpegQuality, resize } = payload
  if (isDev) {
    try { console.log('[export] format=%s jpegQuality=%s resize=%o', format, jpegQuality, resize) } catch {}
  }
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

  // 先将旋正后的图像读入内存，获取“实际用于复合”的精确宽高
  const baseBuf = await sharp(inputPath).rotate().toBuffer()
  const baseMeta = await sharp(baseBuf).metadata()
  const W = baseMeta.width || 0
  const H = baseMeta.height || 0
  if (!W || !H) throw new Error('invalid base dimensions for export')

    // 计算目标输出尺寸（先缩放，再复合，避免 overlay/base 不一致）
    let targetW = W
    let targetH = H
    try {
      const mode = resize?.mode || 'original'
      if (mode === 'custom') {
        const wIn = Number(resize?.width)
        const hIn = Number(resize?.height)
        const hasW = Number.isFinite(wIn) && wIn > 0
        const hasH = Number.isFinite(hIn) && hIn > 0
        if (hasW && hasH) {
          targetW = Math.max(1, Math.round(wIn))
          targetH = Math.max(1, Math.round(hIn))
        } else if (hasW && !hasH) {
          const w = Math.max(1, Math.round(wIn))
          const s = w / W
          targetW = w
          targetH = Math.max(1, Math.round(H * s))
        } else if (!hasW && hasH) {
          const h = Math.max(1, Math.round(hIn))
          const s = h / H
          targetH = h
          targetW = Math.max(1, Math.round(W * s))
        }
      } else if (mode === 'percent' && Number.isFinite(resize?.percent)) {
        const p = Math.max(1, Math.round(Number(resize.percent)))
        const s = p / 100
        targetW = Math.max(1, Math.round(W * s))
        targetH = Math.max(1, Math.round(H * s))
      }
    } catch {}

    // 先按目标尺寸缩放底图
    const baseForComposite = (targetW === W && targetH === H)
      ? baseBuf
      : await sharp(baseBuf).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()

    // 构建与目标尺寸一致的覆盖层（文本或图片）
    let overlayInput
    if (type === 'text') {
      // 文本水印：将 SVG 栅格化成与目标尺寸同大小的透明 PNG
      const svg = buildTextSVG(text, layout, targetW, targetH)
      overlayInput = await sharp(Buffer.from(svg)).png().resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
    } else if (type === 'image' && image?.path) {
      // 图片水印：缩放 -> （可选）旋转 -> 放置到与目标尺寸同大的全画布
      const wmm = await sharp(image.path).metadata()
      const mode = image.scaleMode || 'proportional'
      let ww = 1, hh = 1, wmBuf
      if (mode === 'free') {
        const sx = Math.max(0.01, Number(image.scaleX) || 1)
        const sy = Math.max(0.01, Number(image.scaleY) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * sx))
        hh = Math.max(1, Math.round((wmm.height || 1) * sy))
        wmBuf = await sharp(image.path).resize({ width: ww, height: hh, fit: 'fill' }).png().toBuffer()
      } else {
        const scale = Math.max(0.01, Number(image.scale) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * scale))
        hh = Math.max(1, Math.round((wmm.height || 1) * scale))
        wmBuf = await sharp(image.path).resize({ width: ww, height: hh, fit: 'inside' }).png().toBuffer()
      }
      // 使用实际输出尺寸（考虑 inside/fill 与取整后的真实像素）
      try {
        const mdReal = await sharp(wmBuf).metadata()
        if (mdReal?.width) ww = mdReal.width
        if (mdReal?.height) hh = mdReal.height
      } catch {}

      // （可选）旋转：围绕九宫格锚点旋转（与预览 transform-origin 一致）
      const rot = Number.isFinite(image.rotation) ? Number(image.rotation) : 0
      let rotBuf = wmBuf
      let rw = ww, rh = hh
      if (rot % 360 !== 0) {
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
        // 以锚点为旋转中心：将锚点放置在大画布中心
        const anchorX = Math.round(ax * ww)
        const anchorY = Math.round(ay * hh)
        const canvasW = ww + 2 * Math.max(anchorX, ww - anchorX)
        const canvasH = hh + 2 * Math.max(anchorY, hh - anchorY)
        const offsetX = Math.round(canvasW / 2 - anchorX)
        const offsetY = Math.round(canvasH / 2 - anchorY)
        const centered = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .png()
          .composite([{ input: wmBuf, left: offsetX, top: offsetY }])
          .png()
          .toBuffer()
        const rotated = sharp(centered).rotate(rot, { background: { r:0,g:0,b:0,alpha:0 } })
        rotBuf = await rotated.png().toBuffer()
        try { const md = await sharp(rotBuf).metadata(); if (md?.width) rw = md.width; if (md?.height) rh = md.height } catch {}
      }

      const pos = calcPosition(config.layout, targetW, targetH, !(config.layout?.allowOverflow !== false))
  // 旋转后：rotBuf 中心即为九宫格锚点位置
  const cx = Math.floor(rw / 2)
  const cy = Math.floor(rh / 2)
  const rawLeft = Math.round(pos.left - cx)
  const rawTop  = Math.round(pos.top  - cy)
      const allowOverflow = (config.layout?.allowOverflow !== false)
      if (allowOverflow) {
        const destLeft = Math.max(0, rawLeft)
        const destTop  = Math.max(0, rawTop)
        const srcX = Math.max(0, -rawLeft)
        const srcY = Math.max(0, -rawTop)
        const visW = Math.max(0, Math.min(rw - srcX, targetW - destLeft))
        const visH = Math.max(0, Math.min(rh - srcY, targetH - destTop))
        if (visW > 0 && visH > 0) {
          const piece = (srcX || srcY || visW !== rw || visH !== rh)
            ? await sharp(rotBuf).extract({ left: srcX, top: srcY, width: visW, height: visH }).toBuffer()
            : rotBuf
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
            .png()
            .composite([{ input: piece, left: destLeft, top: destTop, blend: 'over', opacity: Math.max(0, Math.min(1, config.image.opacity ?? 0.6)) }])
            .png()
            .toBuffer()
        } else {
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer()
        }
      } else {
        const left = Math.max(0, Math.min(targetW - rw, rawLeft))
        const top  = Math.max(0, Math.min(targetH - rh, rawTop))
        overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .png()
          .composite([{ input: rotBuf, left, top, blend: 'over', opacity: Math.max(0, Math.min(1, config.image.opacity ?? 0.6)) }])
          .png()
          .toBuffer()
      }
    }

  // 复合：overlay 必须与底图（已缩放到目标尺寸）完全一致大小
  if (!overlayInput) {
    console.warn('[export] No overlay generated for', inputPath, 'type:', type)
  }
  let composites = []
  if (overlayInput) composites.push({ input: overlayInput, top: 0, left: 0 })
  if (isDev) {
    try { console.log('[export] base size =>', { W, H, targetW, targetH }) } catch {}
  }
  // 防御：在复合前检查所有图层尺寸
  try {
    for (const c of composites) {
      const m = await sharp(c.input).metadata()
      if (isDev) {
        try { console.log('[export] overlay before check =>', { w: m.width, h: m.height }) } catch {}
      }
      if ((m.width && m.width !== targetW) || (m.height && m.height !== targetH)) {
        if (isDev) console.warn('[export] overlay size mismatch, force-resize to base', { overlay: { w: m.width, h: m.height }, base: { W: targetW, H: targetH } })
        c.input = await sharp(c.input).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
        if (isDev) {
          try {
            const m2 = await sharp(c.input).metadata()
            console.log('[export] overlay after fix =>', { w: m2.width, h: m2.height })
          } catch {}
        }
      }
    }
  } catch (e) { if (isDev) console.warn('[export] overlay size check error', e) }
  let pipeline = composites.length ? sharp(baseForComposite).composite(composites) : sharp(baseForComposite)
  if (isDev) {
    try { console.log('[export] expected output size =>', { width: targetW, height: targetH }) } catch {}
  }

  // Output（生成唯一文件名，避免批量覆盖/并发写入冲突）
  let outputPath = uniqueOutputPath(inputPath)
    if (format === 'jpeg') {
      // 质量值：支持 0–100（其中 0 代表最低质量，内部按 1 处理），避免 0 被当成 falsy 回退到 90
      let q = 90
      if (Number.isFinite(jpegQuality)) q = Number(jpegQuality)
      q = Math.max(1, Math.min(100, Math.round(q || 0)))
      // 为尽量贴近预览文本边缘效果：禁用色度子采样（4:4:4），并启用 mozjpeg
      pipeline = pipeline.jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true })
    } else {
      pipeline = pipeline.png()
    }
  // 清除方向标记，避免查看器再次旋转
  await pipeline.withMetadata({ orientation: 1 }).toFile(outputPath)
    results.push({ inputPath, outputPath, ok: true })
  })))

  return results
})

// 生成压缩预览：按与导出一致的流程合成，并按 contain 缩放到 480x300，返回 data URL

// 生成压缩预览：按导出逻辑合成后，缩放到 480x300 的 contain 预览画布，并按指定 JPEG 质量编码
ipcMain.handle('preview:render', async (_evt, payload) => {
  try {
    const { inputPath, config, format, jpegQuality, resize } = payload || {}
    const PREVIEW_W = 480, PREVIEW_H = 300
    // 先将原图按 EXIF 方向旋正到内存，获得准确的像素尺寸
    const baseBuf = await sharp(inputPath).rotate().toBuffer()
    const baseMeta = await sharp(baseBuf).metadata()
    const W = baseMeta.width || 0
    const H = baseMeta.height || 0
    if (!W || !H) throw new Error('invalid base dimensions')
    // 计算目标尺寸（与导出保持一致的规则）
    let targetW = W
    let targetH = H
    try {
      const mode = resize?.mode || 'original'
      if (mode === 'custom') {
        const wIn = Number(resize?.width)
        const hIn = Number(resize?.height)
        const hasW = Number.isFinite(wIn) && wIn > 0
        const hasH = Number.isFinite(hIn) && hIn > 0
        if (hasW && hasH) { targetW = Math.max(1, Math.round(wIn)); targetH = Math.max(1, Math.round(hIn)) }
        else if (hasW && !hasH) { const w = Math.max(1, Math.round(wIn)); const s = w / W; targetW = w; targetH = Math.max(1, Math.round(H * s)) }
        else if (!hasW && hasH) { const h = Math.max(1, Math.round(hIn)); const s = h / H; targetH = h; targetW = Math.max(1, Math.round(W * s)) }
      } else if (mode === 'percent' && Number.isFinite(resize?.percent)) {
        const p = Math.max(1, Math.round(Number(resize.percent)))
        const s = p / 100
        targetW = Math.max(1, Math.round(W * s))
        targetH = Math.max(1, Math.round(H * s))
      }
    } catch {}
    // 与导出一致：先得到目标尺寸底图
    const baseForComposite = (targetW === W && targetH === H)
      ? baseBuf
      : await sharp(baseBuf).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
    if (isDev) {
      try { console.log('[preview] resize=%o', resize) } catch {}
    }
    // 构建与目标尺寸一致的覆盖层
    let overlayInput
    if (config?.type === 'text') {
      const svg = buildTextSVG(config.text, config.layout, targetW, targetH)
      overlayInput = await sharp(Buffer.from(svg)).png().resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
    } else if (config?.type === 'image' && config?.image?.path) {
      const wmm = await sharp(config.image.path).metadata()
      const mode = config.image.scaleMode || 'proportional'
      let ww = 1, hh = 1, wmBuf
      if (mode === 'free') {
        const sx = Math.max(0.01, Number(config.image.scaleX) || 1)
        const sy = Math.max(0.01, Number(config.image.scaleY) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * sx))
        hh = Math.max(1, Math.round((wmm.height || 1) * sy))
        wmBuf = await sharp(config.image.path).resize({ width: ww, height: hh, fit: 'fill' }).png().toBuffer()
      } else {
        const scale = Math.max(0.01, Number(config.image.scale) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * scale))
        hh = Math.max(1, Math.round((wmm.height || 1) * scale))
        wmBuf = await sharp(config.image.path).resize({ width: ww, height: hh, fit: 'inside' }).png().toBuffer()
      }
      // 旋转处理：同导出逻辑
      const rot = Number.isFinite(config.image.rotation) ? Number(config.image.rotation) : 0
      let rotBuf = wmBuf
      let rw = ww, rh = hh
      if (rot % 360 !== 0) {
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
        // 以锚点为旋转中心：将锚点放置在大画布中心（与导出一致）
        const anchorX = Math.round(ax * ww)
        const anchorY = Math.round(ay * hh)
        const canvasW = ww + 2 * Math.max(anchorX, ww - anchorX)
        const canvasH = hh + 2 * Math.max(anchorY, hh - anchorY)
        const offsetX = Math.round(canvasW / 2 - anchorX)
        const offsetY = Math.round(canvasH / 2 - anchorY)
        const centered = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .png()
          .composite([{ input: wmBuf, left: offsetX, top: offsetY }])
          .png()
          .toBuffer()
        const rotated = sharp(centered).rotate(rot, { background: { r:0,g:0,b:0,alpha:0 } })
        rotBuf = await rotated.png().toBuffer()
        try { const md = await sharp(rotBuf).metadata(); if (md?.width) rw = md.width; if (md?.height) rh = md.height } catch {}
      }
      const pos = calcPosition(config.layout, targetW, targetH, !(config.layout?.allowOverflow !== false))
      const cx = Math.floor(rw / 2)
      const cy = Math.floor(rh / 2)
      const rawLeft = Math.round(pos.left - cx)
      const rawTop  = Math.round(pos.top  - cy)
      const allowOverflow = (config.layout?.allowOverflow !== false)
      if (allowOverflow) {
        const destLeft = Math.max(0, rawLeft)
        const destTop  = Math.max(0, rawTop)
        const srcX = Math.max(0, -rawLeft)
        const srcY = Math.max(0, -rawTop)
        const visW = Math.max(0, Math.min(rw - srcX, targetW - destLeft))
        const visH = Math.max(0, Math.min(rh - srcY, targetH - destTop))
        if (visW > 0 && visH > 0) {
          const piece = (srcX || srcY || visW !== rw || visH !== rh)
            ? await sharp(rotBuf).extract({ left: srcX, top: srcY, width: visW, height: visH }).toBuffer()
            : rotBuf
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
            .png()
            .composite([{ input: piece, left: destLeft, top: destTop, blend: 'over', opacity: Math.max(0, Math.min(1, config.image.opacity ?? 0.6)) }])
            .png()
            .toBuffer()
        } else {
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer()
        }
      } else {
        let left = Math.max(0, Math.min(targetW - rw, rawLeft))
        let top  = Math.max(0, Math.min(targetH - rh, rawTop))
        overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .png()
          .composite([{ input: rotBuf, left, top, blend: 'over', opacity: Math.max(0, Math.min(1, config.image.opacity ?? 0.6)) }])
          .png()
          .toBuffer()
      }
    }
    // 复合前防御性尺寸校正（避免 overlay 尺寸漂移导致错误）
    let composites = []
    if (overlayInput) {
      try {
        const md = await sharp(overlayInput).metadata()
        if (isDev) { try { console.log('[preview] base/target =>', { W, H, targetW, targetH }); console.log('[preview] overlay before check =>', { w: md.width, h: md.height }) } catch {} }
        if ((md.width && md.width !== targetW) || (md.height && md.height !== targetH)) {
          overlayInput = await sharp(overlayInput).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
          if (isDev) { try { const md2 = await sharp(overlayInput).metadata(); console.log('[preview] overlay after fix =>', { w: md2.width, h: md2.height }) } catch {} }
        }
      } catch {}
      composites.push({ input: overlayInput, left: 0, top: 0 })
    }
    // 在目标尺寸上进行复合
    let pipeline = composites.length ? sharp(baseForComposite).composite(composites) : sharp(baseForComposite)
    // 为了贴近最终效果：先按原尺寸进行一次有损 JPEG 编码（产生与最终一致的压缩伪影），
    // 然后解码并缩放到 480x300（contain），以 PNG 无损封装返回，避免再叠加一次 JPEG 失真。
  const q = Math.max(1, Math.min(100, Math.round(Number.isFinite(jpegQuality) ? Number(jpegQuality) : 90)))
  const lossyJpeg = await pipeline.jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer()
    const scaledPng = await sharp(lossyJpeg)
      .resize({ width: PREVIEW_W, height: PREVIEW_H, fit: 'contain', background: { r:255, g:255, b:255, alpha:1 } })
      .png()
      .toBuffer()
    const sw = PREVIEW_W
    const sh = PREVIEW_H
    const dataUrl = `data:image/png;base64,${scaledPng.toString('base64')}`
    return { ok: true, url: dataUrl, width: sw, height: sh }
  } catch (e) {
    console.error('[preview:render] error', e)
    return { ok: false, error: `[preview:render] ${String(e?.message || e)}` }
  }
})

// Template management
ipcMain.handle('template:list', async () => {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const reserved = new Set(['_last.json', '_config.json'])
  const names = readdirSync(dir)
    .filter(n => n.endsWith('.json') && !reserved.has(n))
    .map(n => n.replace(/\.json$/, ''))
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
    const s = sanitize(name)
    // 保护保留名称不被删除
    if (s === '_last' || s === '_config') return false
    const p = path.join(dir, `${s}.json`)
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

// 模板自动加载配置：{ autoLoad: 'last' | 'default', defaultName?: string }
ipcMain.handle('template:getAutoLoadConfig', async () => {
  try {
    const cfg = await readTemplateConfig()
    return cfg
  } catch {
    return { autoLoad: 'last', defaultName: null }
  }
})

ipcMain.handle('template:setAutoLoadConfig', async (_evt, cfg) => {
  try {
    const normalized = normalizeTemplateConfig(cfg)
    await writeTemplateConfig(normalized)
    return true
  } catch {
    return false
  }
})

// 元数据回退配置（允许从文件名/文件时间推断）
ipcMain.handle('meta:getFallbackConfig', async () => {
  try {
    const cfg = await readTemplateConfig()
    const metaFallback = cfg?.metaFallback || { allowFilename: true, allowFileTime: false }
    return metaFallback
  } catch {
    return { allowFilename: true, allowFileTime: false }
  }
})

ipcMain.handle('meta:setFallbackConfig', async (_evt, metaFallback) => {
  try {
    const cfg = await readTemplateConfig()
    const merged = { ...cfg, metaFallback: normalizeMetaFallback(metaFallback) }
    await writeTemplateConfig(merged)
    return true
  } catch {
    return false
  }
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

function calcPosition(layout, W, H, clampInside = true) {
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
  const rawLeft = Math.round(x + (layout?.offsetX || 0))
  const rawTop = Math.round(y + (layout?.offsetY || 0))
  const left = clampInside ? Math.max(0, Math.min(W - 1, rawLeft)) : rawLeft
  const top = clampInside ? Math.max(0, Math.min(H - 1, rawTop)) : rawTop
  return { left, top }
}

// 根据九宫格预设返回图片水印的锚点系数（0=左/上，0.5=中，1=右/下）
function getImageAnchorFactors(preset) {
  switch (preset) {
    case 'tl': return { ax: 0,   ay: 0 }
    case 'tc': return { ax: 0.5, ay: 0 }
    case 'tr': return { ax: 1,   ay: 0 }
    case 'cl': return { ax: 0,   ay: 0.5 }
    case 'center': return { ax: 0.5, ay: 0.5 }
    case 'cr': return { ax: 1,   ay: 0.5 }
    case 'bl': return { ax: 0,   ay: 1 }
    case 'bc': return { ax: 0.5, ay: 1 }
    case 'br': return { ax: 1,   ay: 1 }
    default: return { ax: 0.5, ay: 0.5 }
  }
}

function buildTextSVG(text, layout, W, H) {
  const content = escapeHtml(text?.content || 'Watermark')
  const fontFamily = text?.fontFamily || 'Arial, Helvetica, sans-serif'
  const fontFamilyAttr = /[\s,]/.test(fontFamily) ? `'${fontFamily}', Arial, Helvetica, sans-serif` : `${fontFamily}, Arial, Helvetica, sans-serif`
  const fontFamilyAttrEscaped = escapeHtml(fontFamilyAttr)
  // 将预览中的字号（以预览画布像素计）按比例换算到原图像素：
  // 预览画布固定为 480x300（见 PreviewBox），使用 contain 缩放：scale = min(480/W, 300/H)
  // 预览 1 像素 ≈ 原图 1/scale 像素，因此导出字号 = 预览字号 / scale
  const PREVIEW_W = 480, PREVIEW_H = 300
  const scalePreviewToImage = Math.min(PREVIEW_W / (W || PREVIEW_W), PREVIEW_H / (H || PREVIEW_H))
  const fontSizeRaw = text?.fontSize || 32
  const fontSize = Math.max(8, (fontSizeRaw / (scalePreviewToImage || 1)))
  const color = text?.color || '#FFFFFF'
  const opacity = Math.max(0, Math.min(1, text?.opacity ?? 0.6))
  const fontWeight = (text?.fontWeight ?? 'normal')
  const fontStyle = (text?.fontStyle ?? 'normal')
  // 样式：描边与阴影（按预览->原图比例换算尺寸参数）
  function hexToRgb(hex) {
    try {
      if (!hex) return { r: 0, g: 0, b: 0 }
      let s = String(hex).trim(); if (s.startsWith('#')) s = s.slice(1)
      if (s.length === 3) s = s.split('').map(c => c + c).join('')
      const r = parseInt(s.slice(0,2),16), g = parseInt(s.slice(2,4),16), b = parseInt(s.slice(4,6),16)
      return { r: isFinite(r)?r:0, g: isFinite(g)?g:0, b: isFinite(b)?b:0 }
    } catch { return { r:0,g:0,b:0 } }
  }
  const outlineEnabled = !!text?.outline?.enabled
  const outlineWidthPxPreview = Math.max(0, Math.round(Number(text?.outline?.width) || 0))
  const outlineOpacity = Math.max(0, Math.min(1, Number(text?.outline?.opacity) ?? 1))
  const outlineColorRGB = hexToRgb(text?.outline?.color || '#000000')
  const outlineWidthImage = outlineEnabled ? Math.max(0, Math.round(outlineWidthPxPreview / (scalePreviewToImage || 1))) : 0

  const shadowEnabled = !!text?.shadow?.enabled
  const shadowOffsetXPreview = Math.round(Number(text?.shadow?.offsetX) || 0)
  const shadowOffsetYPreview = Math.round(Number(text?.shadow?.offsetY) || 0)
  const shadowBlurPreview = Math.max(0, Math.round(Number(text?.shadow?.blur) || 0))
  const shadowOpacity = Math.max(0, Math.min(1, Number(text?.shadow?.opacity) ?? 1))
  const shadowColorRGB = hexToRgb(text?.shadow?.color || '#000000')
  const shadowOffsetX = shadowEnabled ? (shadowOffsetXPreview / (scalePreviewToImage || 1)) : 0
  const shadowOffsetY = shadowEnabled ? (shadowOffsetYPreview / (scalePreviewToImage || 1)) : 0
  const shadowBlur = shadowEnabled ? Math.max(0, shadowBlurPreview / (scalePreviewToImage || 1)) : 0
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
  const { left, top } = calcPosition({ preset: layout?.preset, offsetX: layout?.offsetX || 0, offsetY: layout?.offsetY || 0 }, W, H, !(layout?.allowOverflow))
  let x = left
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
    // 叠加来自 UI 的“基线微调 Y”（预览像素），需要换算到原图像素
    const baselineAdjustPreviewPx = Number(text?.baselineAdjust || 0)
    if (baselineAdjustPreviewPx) {
      const baselineAdjustImagePx = baselineAdjustPreviewPx / (scalePreviewToImage || 1)
      dyPx += baselineAdjustImagePx
    }
    // 同理：叠加“水平微调 X”（预览像素）到 x 坐标
    const baselineAdjustXPreviewPx = Number(text?.baselineAdjustX || 0)
    if (baselineAdjustXPreviewPx) {
      const baselineAdjustXImagePx = baselineAdjustXPreviewPx / (scalePreviewToImage || 1)
      x = x + baselineAdjustXImagePx
    }
    // 为提升兼容性，避免使用 dy 属性（部分渲染器处理不一致），改为直接叠加到 y 坐标
    y = y + dyPx
  // Basic SVG text; advanced shadow/stroke可后续扩展
  const defs = []
  if (shadowEnabled) {
    // 将过滤器坐标系切换到 userSpaceOnUse，并覆盖整张画布，避免大偏移/大模糊时被裁切
    defs.push(`
      <filter id="wmShadow" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse">
        <feDropShadow dx="${shadowOffsetX}" dy="${shadowOffsetY}" stdDeviation="${shadowBlur}"
          flood-color="rgb(${shadowColorRGB.r},${shadowColorRGB.g},${shadowColorRGB.b})" flood-opacity="${shadowOpacity}" />
      </filter>`)
  }
  const strokeAttrs = outlineEnabled && outlineWidthImage>0
    ? `stroke="rgb(${outlineColorRGB.r},${outlineColorRGB.g},${outlineColorRGB.b})" stroke-opacity="${outlineOpacity}" stroke-width="${outlineWidthImage}" paint-order="stroke"`
    : `stroke="rgba(0,0,0,0.25)" stroke-width="${Math.max(1, Math.round(fontSize/48))}"`
  const filterAttr = shadowEnabled ? `filter="url(#wmShadow)"` : ''
  // 仿斜（若启用）：在 (x,y) 处先平移到原点，再 skewX，然后平移回去
  const syntheticItalic = !!text?.italicSynthetic
  const skewDeg = Number.isFinite(text?.italicSkewDeg) ? Number(text.italicSkewDeg) : 12
  const skewCmd = syntheticItalic ? `translate(${x}, ${y}) skewX(${-skewDeg}) translate(${-x}, ${-y})` : ''
  // 旋转：围绕当前 anchor 计算后的 (x,y) 进行旋转，角度单位：deg
  const rotDeg = (Number.isFinite(text?.rotation) ? Number(text.rotation) : 0) % 360
  const rotCmd = rotDeg ? `translate(${x}, ${y}) rotate(${rotDeg}) translate(${-x}, ${-y})` : ''
  const groupTransform = [rotCmd, skewCmd].filter(Boolean).join(' ')
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${defs.length?`<defs>${defs.join('\n')}</defs>`:''}
      ${groupTransform ? `<g transform="${groupTransform}">` : ''}
        <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${color}" fill-opacity="${opacity}" font-family="${fontFamilyAttrEscaped}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" ${strokeAttrs} ${filterAttr}>${content}</text>
      ${groupTransform ? `</g>` : ''}
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

function getTemplatesConfigPath() {
  return path.join(getTemplatesDir(), '_config.json')
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

function pad2(n) { return String(n).padStart(2, '0') }
function formatExifDate(dt) {
  try {
    if (!dt) return null
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      const y = dt.getFullYear()
      const m = pad2(dt.getMonth() + 1)
      const d = pad2(dt.getDate())
      const hh = pad2(dt.getHours())
      const mm = pad2(dt.getMinutes())
      const ss = pad2(dt.getSeconds())
      return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
    }
    const s = String(dt)
    // 常见 EXIF 字符串格式："YYYY:MM:DD HH:MM:SS"
    const m = s.match(/(\d{4}):?(\d{2}):?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m) {
      return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    }
    // ISO 8601（常见于 XMP）：YYYY-MM-DDTHH:mm:ss[.sss][Z|+08:00]
    const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/)
    if (m2) {
      return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]}`
    }
    return null
  } catch { return null }
}

// 将 GPSDateStamp ("YYYY:MM:DD") 与 GPSTimeStamp (可为 "HH:MM:SS" 或 [h,m,s] 数组) 合成为标准时间
function formatGpsDateTime(gpsDate, gpsTime) {
  try {
    if (!gpsDate && !gpsTime) return null
    let y, m, d, hh = '00', mm = '00', ss = '00'
    if (gpsDate) {
      const s = String(gpsDate)
      const md = s.match(/(\d{4}):?(\d{2}):?(\d{2})/)
      if (!md) return null
      y = md[1]; m = md[2]; d = md[3]
    } else {
      return null
    }
    if (gpsTime !== undefined && gpsTime !== null) {
      if (Array.isArray(gpsTime)) {
        const pad = (v)=> String(Math.floor(Number(v)||0)).padStart(2,'0')
        hh = pad(gpsTime[0]); mm = pad(gpsTime[1]); ss = pad(gpsTime[2])
      } else {
        const st = String(gpsTime)
        const mt = st.match(/(\d{2}):(\d{2}):(\d{2})/)
        if (mt) { hh = mt[1]; mm = mt[2]; ss = mt[3] }
      }
    }
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
  } catch { return null }
}

// 粗略解析 XMP 字段以提取拍摄时间（优先常见标签），并格式化
function parseXmpForDate(xmpBuf) {
  try {
    const txt = Buffer.isBuffer(xmpBuf) ? xmpBuf.toString('utf-8') : String(xmpBuf || '')
    const tryTags = [
      /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/i,
      /xmp:CreateDate=\"([^\"]+)\"/i,
      /<exif:DateTimeOriginal>([^<]+)<\/exif:DateTimeOriginal>/i,
      /exif:DateTimeOriginal=\"([^\"]+)\"/i,
      /<exif:DateTimeDigitized>([^<]+)<\/exif:DateTimeDigitized>/i,
      /<tiff:DateTime>([^<]+)<\/tiff:DateTime>/i,
      /<photoshop:DateCreated>([^<]+)<\/photoshop:DateCreated>/i,
      /<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/i,
    ]
    for (const re of tryTags) {
      const m = txt.match(re)
      if (m && m[1]) {
        const f = formatExifDate(m[1])
        if (f) return f
      }
    }
    // 退而求其次：从全文中找第一个 ISO 8601 或 EXIF 样式的时间
    const m2 = txt.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]}`
    const m3 = txt.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]} ${m3[4]}:${m3[5]}:${m3[6]}`
    return null
  } catch { return null }
}

// 读写模板自动加载配置
async function readTemplateConfig() {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = getTemplatesConfigPath()
  try {
    const txt = await fsp.readFile(p, 'utf-8')
    const j = JSON.parse(txt)
    return normalizeTemplateConfig(j)
  } catch {
    return { autoLoad: 'last', defaultName: null }
  }
}

function normalizeTemplateConfig(cfg) {
  const auto = (cfg?.autoLoad === 'default' || cfg?.autoLoad === 'last') ? cfg.autoLoad : 'last'
  const def = cfg?.defaultName ? String(cfg.defaultName).slice(0, 128) : null
  const metaFallback = normalizeMetaFallback(cfg?.metaFallback)
  return { autoLoad: auto, defaultName: def, metaFallback }
}

async function writeTemplateConfig(cfg) {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = getTemplatesConfigPath()
  await fsp.writeFile(p, JSON.stringify(normalizeTemplateConfig(cfg), null, 2), 'utf-8')
}

function normalizeMetaFallback(mf) {
  const allowFilename = mf?.allowFilename !== false
  const allowFileTime = mf?.allowFileTime === true
  return { allowFilename, allowFileTime }
}

function parseDateFromFilename(p) {
  try {
    const base = path.basename(p)
    // 常见：YYYYMMDD_HHMMSS 或 YYYY-MM-DD_HH-mm-ss 或 YYYY.MM.DD HH.mm.ss 等
    let m = base.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[ _T.,-]?(\d{2})[:_.\-]?(\d{2})[:_.\-]?(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    // 另一类：IMG_YYYYMMDD_HHMMSS
    m = base.match(/(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    return null
  } catch { return null }
}
