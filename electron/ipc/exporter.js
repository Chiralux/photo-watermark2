import path from 'node:path'
import { existsSync } from 'node:fs'
import os from 'node:os'
import sharp from 'sharp'
import { promises as fsp } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let bmpjs; try { bmpjs = require('bmp-js') } catch { bmpjs = null }
import PQueue from 'p-queue'
import { calcPosition, getImageAnchorFactors } from '../watermark-geometry.js'
import { buildTextSVG, buildTextSpriteSVG } from '../utils/svg.js'
import { ensureDir } from '../utils/files.js'
import { buildOutputPath } from '../utils/templates.js'

export function registerExportIpc(ipcMain, isDev) {
  ipcMain.handle('export:applyWatermark', async (_evt, payload) => {
    const { tasks, outputDir, format, naming, jpegQuality, resize } = payload
    if (isDev) { try { console.log('[export] format=%s jpegQuality=%s resize=%o', format, jpegQuality, resize) } catch {} }
    ensureDir(outputDir)
    const concurrency = Math.max(1, Math.min(os.cpus()?.length || 4, 4))
    const queue = new PQueue({ concurrency })
    const plannedOutputs = new Set()
    function uniqueOutputPath(inputPath) {
      const desired = buildOutputPath(inputPath, outputDir, naming, format)
      const dir = path.dirname(desired)
      const ext = path.extname(desired)
      const baseNoExt = path.basename(desired, ext)
      let candidate = desired
      let idx = 2
      while (plannedOutputs.has(candidate) || existsSync(candidate)) {
        candidate = path.join(dir, `${baseNoExt}-${idx}${ext}`)
        idx++
      }
      plannedOutputs.add(candidate)
      return candidate
    }

    const total = Array.isArray(tasks) ? tasks.length : 0
    let processed = 0
    try { _evt?.sender?.send?.('export:progress', { type: 'start', total }) } catch {}
    const results = []
    await Promise.all(tasks.map(task => queue.add(async () => {
      const { inputPath, config } = task
      const { type, text, image, layout } = config
      let baseBuf
      try {
        baseBuf = await sharp(inputPath).rotate().toBuffer()
      } catch (e) {
        const ext = String(path.extname(inputPath || '')).toLowerCase()
        if ((ext === '.bmp' || ext === '.dib') && bmpjs) {
          const bin = await fsp.readFile(inputPath)
          const decoded = bmpjs.decode(bin)
          const raw = { width: decoded.width, height: decoded.height, channels: 4 }
          baseBuf = await sharp(Buffer.from(decoded.data), { raw }).png().toBuffer()
        } else {
          throw e
        }
      }
      const baseMeta = await sharp(baseBuf).metadata()
      const W = baseMeta.width || 0
      const H = baseMeta.height || 0
      if (!W || !H) throw new Error('invalid base dimensions for export')
      let targetW = W, targetH = H
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
      const baseForComposite = (targetW === W && targetH === H)
        ? baseBuf
        : await sharp(baseBuf).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()

      let overlayInput
      if (type === 'text') {
        // 1) 生成文本精灵 PNG，并自动裁掉透明边
  const spriteSvg = buildTextSpriteSVG(text, targetW, targetH)
        let wmBuf = await sharp(Buffer.from(spriteSvg)).png().toBuffer()
        try { wmBuf = await sharp(wmBuf).trim().toBuffer() } catch {}
        // 2) 将其当作图片水印，复用图片定位/旋转/越界流程
        const wmm = await sharp(wmBuf).metadata()
        const mode = text?.scaleMode || 'proportional'
        let ww = 1, hh = 1
        if (mode === 'free') {
          const sx = Math.max(0.01, Number(text?.scaleX) || 1)
          const sy = Math.max(0.01, Number(text?.scaleY) || 1)
          ww = Math.max(1, Math.round((wmm.width || 1) * sx))
          hh = Math.max(1, Math.round((wmm.height || 1) * sy))
          wmBuf = await sharp(wmBuf).resize({ width: ww, height: hh, fit: 'fill' }).png().toBuffer()
        } else {
          const scale = Math.max(0.01, Number(text?.scale) || 1)
          ww = Math.max(1, Math.round((wmm.width || 1) * scale))
          hh = Math.max(1, Math.round((wmm.height || 1) * scale))
          wmBuf = await sharp(wmBuf).resize({ width: ww, height: hh, fit: 'inside' }).png().toBuffer()
        }
        try {
          const mdReal = await sharp(wmBuf).metadata()
          if (mdReal?.width) ww = mdReal.width
          if (mdReal?.height) hh = mdReal.height
        } catch {}
        const rot = Number.isFinite(text?.rotation) ? Number(text.rotation) : 0
        let rotBuf = wmBuf
        let rw = ww, rh = hh
        let rawLeft, rawTop
        // 与文本 SVG 逻辑一致：根据 preset 推导 vAlign 做基线微调，同时支持 baselineAdjust / baselineAdjustX
        // 统一锚点为文本图像中心，基线微调不再受九宫格影响
        const fontSize = Math.max(8, Number(text?.fontSize) || 32)
        const PREVIEW_W = 480, PREVIEW_H = 300
        const scalePreviewToImage = Math.min(PREVIEW_W / (targetW || PREVIEW_W), PREVIEW_H / (targetH || PREVIEW_H))
        const fontSizeImage = Math.max(8, fontSize / (scalePreviewToImage || 1))
        let dyAdjust = 0
        if (Number.isFinite(text?.baselineAdjust)) dyAdjust += Number(text?.baselineAdjust) / (scalePreviewToImage || 1)
        let dxAdjust = 0
        if (Number.isFinite(text?.baselineAdjustX)) dxAdjust += Number(text?.baselineAdjustX) / (scalePreviewToImage || 1)
        const pos0 = calcPosition(layout, targetW, targetH, !(layout?.allowOverflow !== false))
        const pos = { left: Math.round(pos0.left + dxAdjust), top: Math.round(pos0.top + dyAdjust) }
        if ((rot % 360) !== 0) {
          const { ax, ay } = getImageAnchorFactors(layout?.preset)
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
          const cx = Math.floor(rw / 2)
          const cy = Math.floor(rh / 2)
          rawLeft = Math.round(pos.left - cx)
          rawTop  = Math.round(pos.top  - cy)
        } else {
          const { ax, ay } = getImageAnchorFactors(layout?.preset)
          const anchorX = Math.round(ax * ww)
          const anchorY = Math.round(ay * hh)
          rawLeft = Math.round(pos.left - anchorX)
          rawTop  = Math.round(pos.top  - anchorY)
        }
        const allowOverflow = (layout?.allowOverflow !== false)
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
              .composite([{ input: piece, left: destLeft, top: destTop, blend: 'over', opacity: Math.max(0, Math.min(1, text.opacity ?? 0.6)) }])
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
            .composite([{ input: rotBuf, left, top, blend: 'over', opacity: Math.max(0, Math.min(1, text.opacity ?? 0.6)) }])
            .png()
            .toBuffer()
        }
      } else if (type === 'image' && image?.path) {
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
        try {
          const mdReal = await sharp(wmBuf).metadata()
          if (mdReal?.width) ww = mdReal.width
          if (mdReal?.height) hh = mdReal.height
        } catch {}
        const rot = Number.isFinite(image.rotation) ? Number(image.rotation) : 0
        let rotBuf = wmBuf
        let rw = ww, rh = hh
        let rawLeft, rawTop
        const pos = calcPosition(layout, targetW, targetH, !(layout?.allowOverflow !== false))
        if ((rot % 360) !== 0) {
          // 非零旋转：将锚点移至画布中心后再旋转，最终用中心对齐到目标点
          const { ax, ay } = getImageAnchorFactors(layout?.preset)
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
          const cx = Math.floor(rw / 2)
          const cy = Math.floor(rh / 2)
          rawLeft = Math.round(pos.left - cx)
          rawTop  = Math.round(pos.top  - cy)
        } else {
          // 零旋转：直接使用锚点系数定位至目标点（与前端预览一致）
          const { ax, ay } = getImageAnchorFactors(layout?.preset)
          const anchorX = Math.round(ax * ww)
          const anchorY = Math.round(ay * hh)
          rawLeft = Math.round(pos.left - anchorX)
          rawTop  = Math.round(pos.top  - anchorY)
        }
        const allowOverflow = (layout?.allowOverflow !== false)
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
              .composite([{ input: piece, left: destLeft, top: destTop, blend: 'over', opacity: Math.max(0, Math.min(1, image.opacity ?? 0.6)) }])
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
            .composite([{ input: rotBuf, left, top, blend: 'over', opacity: Math.max(0, Math.min(1, image.opacity ?? 0.6)) }])
            .png()
            .toBuffer()
        }
      }
      if (!overlayInput) {
        if (isDev) console.warn('[export] No overlay generated for', inputPath, 'type:', type)
      }
      let composites = []
      if (overlayInput) composites.push({ input: overlayInput, top: 0, left: 0 })
      try {
        for (const c of composites) {
          const m = await sharp(c.input).metadata()
          if ((m.width && m.width !== targetW) || (m.height && m.height !== targetH)) {
            c.input = await sharp(c.input).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
          }
        }
      } catch {}
      let pipeline = composites.length ? sharp(baseForComposite).composite(composites) : sharp(baseForComposite)
      let outputPath = uniqueOutputPath(inputPath)
      if (format === 'jpeg') {
        let q = 90
        if (Number.isFinite(jpegQuality)) q = Number(jpegQuality)
        q = Math.max(1, Math.min(100, Math.round(q || 0)))
        pipeline = pipeline.jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true })
      } else {
        pipeline = pipeline.png()
      }
      await pipeline.withMetadata({ orientation: 1 }).toFile(outputPath)
      results.push({ inputPath, outputPath, ok: true })
      processed++
      try { _evt?.sender?.send?.('export:progress', { type: 'progress', processed, total, inputPath, outputPath, ok: true }) } catch {}
    })))
    try { _evt?.sender?.send?.('export:progress', { type: 'done', processed, total }) } catch {}
    return results
  })
}
