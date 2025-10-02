import sharp from 'sharp'
import { parentPort, workerData } from 'worker_threads'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let bmpjs; try { bmpjs = require('bmp-js') } catch { bmpjs = null }
import { calcPosition, getImageAnchorFactors } from '../watermark-geometry.js'
import { buildTextSpriteSVG } from '../utils/svg.js'

async function run(payload) {
  try {
    const { inputPath, config, format, jpegQuality, resize } = payload || {}
    const PREVIEW_W = 480, PREVIEW_H = 300
    const debug = {}
    let baseBuf
    try {
      baseBuf = await sharp(inputPath).rotate().toBuffer()
    } catch (e) {
      // Fallback for some BMP variants unsupported by libvips
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
    if (!W || !H) throw new Error('invalid base dimensions')
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

    // 归一化不透明度：支持 0-1、0-100 以及 "28%" 字符串
    const normalizeOpacity = (v) => {
      let raw = v
      if (raw == null) return 1
      if (typeof raw === 'string') {
        raw = raw.trim()
        if (raw.endsWith('%')) raw = raw.slice(0, -1)
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) return 1
      if (n <= 0) return 0
      if (n <= 1) return n
      return Math.min(1, n / 100)
    }

    let overlayInput
  if (config?.type === 'text') {
      const spriteSvg = buildTextSpriteSVG(config.text, targetW, targetH)
      let wmBuf = await sharp(Buffer.from(spriteSvg)).png().toBuffer()
      try { wmBuf = await sharp(wmBuf).trim().toBuffer() } catch {}
      const wmm = await sharp(wmBuf).metadata()
      const mode = config.text?.scaleMode || 'proportional'
      let ww = 1, hh = 1
      if (mode === 'free') {
        const sx = Math.max(0.01, Number(config.text?.scaleX) || 1)
        const sy = Math.max(0.01, Number(config.text?.scaleY) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * sx))
        hh = Math.max(1, Math.round((wmm.height || 1) * sy))
        wmBuf = await sharp(wmBuf).resize({ width: ww, height: hh, fit: 'fill' }).png().toBuffer()
      } else {
        const scale = Math.max(0.01, Number(config.text?.scale) || 1)
        ww = Math.max(1, Math.round((wmm.width || 1) * scale))
        hh = Math.max(1, Math.round((wmm.height || 1) * scale))
        wmBuf = await sharp(wmBuf).resize({ width: ww, height: hh, fit: 'inside' }).png().toBuffer()
      }
      const rot = Number.isFinite(config.text?.rotation) ? Number(config.text.rotation) : 0
      let rotBuf = wmBuf
      let rw = ww, rh = hh
      let rawLeft, rawTop
      function getVAlignByPreset(preset) {
        switch (preset) {
          case 'tl': case 'tc': case 'tr': return 'top'
          case 'cl': case 'center': case 'cr': return 'middle'
          case 'bl': case 'bc': case 'br': return 'bottom'
          default: return 'middle'
        }
      }
      const vAlign = getVAlignByPreset(config.layout?.preset)
      const fontSize = Math.max(8, Number(config.text?.fontSize) || 32)
      const scalePreviewToImage = Math.min(PREVIEW_W / (targetW || PREVIEW_W), PREVIEW_H / (targetH || PREVIEW_H))
      const fontSizeImage = Math.max(8, fontSize / (scalePreviewToImage || 1))
      let dyAdjust = 0
      if (vAlign === 'top') dyAdjust = 0
      else if (vAlign === 'middle') dyAdjust = fontSizeImage * 0.40
      else if (vAlign === 'bottom') dyAdjust = -Math.round(fontSizeImage * 0.2)
      if (Number.isFinite(config.text?.baselineAdjust)) dyAdjust += Number(config.text?.baselineAdjust) / (scalePreviewToImage || 1)
      let dxAdjust = 0
      if (Number.isFinite(config.text?.baselineAdjustX)) dxAdjust += Number(config.text?.baselineAdjustX) / (scalePreviewToImage || 1)
      const pos0 = calcPosition(config.layout, targetW, targetH, !(config.layout?.allowOverflow !== false))
      const pos = { left: Math.round(pos0.left + dxAdjust), top: Math.round(pos0.top + dyAdjust) }
      if ((rot % 360) !== 0) {
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
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
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
        const anchorX = Math.round(ax * ww)
        const anchorY = Math.round(ay * hh)
        rawLeft = Math.round(pos.left - anchorX)
        rawTop  = Math.round(pos.top  - anchorY)
      }
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
            // 文本不透明度已内嵌在 SVG 精灵的 fill-opacity 中，这里不再额外设置 opacity
            .composite([{ input: piece, left: destLeft, top: destTop, blend: 'over' }])
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
          // 文本不透明度已内嵌在 SVG 精灵的 fill-opacity 中，这里不再额外设置 opacity
          .composite([{ input: rotBuf, left, top, blend: 'over' }])
          .png()
          .toBuffer()
      }
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
      const rot = Number.isFinite(config.image.rotation) ? Number(config.image.rotation) : 0
      let rotBuf = wmBuf
      let rw = ww, rh = hh
      let rawLeft, rawTop
      const pos = calcPosition(config.layout, targetW, targetH, !(config.layout?.allowOverflow !== false))
      if ((rot % 360) !== 0) {
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
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
        const { ax, ay } = getImageAnchorFactors(config.layout?.preset)
        const anchorX = Math.round(ax * ww)
        const anchorY = Math.round(ay * hh)
        rawLeft = Math.round(pos.left - anchorX)
        rawTop  = Math.round(pos.top  - anchorY)
      }
  const allowOverflow = (config.layout?.allowOverflow !== false)
  // 归一化目标不透明度；某些环境下 per-input opacity 在 composite 中不稳定，这里预烘焙到 alpha 通道
  const desiredOpacity = normalizeOpacity(config.image.opacity ?? 0.6)
  try { Object.assign(debug, { type: 'image', opacityRaw: config.image.opacity, opacityNormalized: desiredOpacity }) } catch {}
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
          // 预烘焙透明度，避免 composite 的 opacity 不一致
          const pieceWithOpacity = (desiredOpacity < 1)
            ? await sharp(piece).ensureAlpha().linear([1,1,1, desiredOpacity], [0,0,0,0]).png().toBuffer()
            : piece
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
            .png()
            .composite([{ input: pieceWithOpacity, left: destLeft, top: destTop, blend: 'over' }])
            .png()
            .toBuffer()
        } else {
          overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer()
        }
      } else {
        let left = Math.max(0, Math.min(targetW - rw, rawLeft))
        let top  = Math.max(0, Math.min(targetH - rh, rawTop))
        const rotWithOpacity = (desiredOpacity < 1)
          ? await sharp(rotBuf).ensureAlpha().linear([1,1,1, desiredOpacity], [0,0,0,0]).png().toBuffer()
          : rotBuf
        overlayInput = await sharp({ create: { width: targetW, height: targetH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
          .png()
          .composite([{ input: rotWithOpacity, left, top, blend: 'over' }])
          .png()
          .toBuffer()
      }
    }

    let composites = []
    if (overlayInput) {
      try {
        const md = await sharp(overlayInput).metadata()
        if ((md.width && md.width !== targetW) || (md.height && md.height !== targetH)) {
          overlayInput = await sharp(overlayInput).resize({ width: targetW, height: targetH, fit: 'fill' }).toBuffer()
        }
      } catch {}
      composites.push({ input: overlayInput, left: 0, top: 0 })
    }
    let pipeline = composites.length ? sharp(baseForComposite).composite(composites) : sharp(baseForComposite)
  const fmt = (typeof format === 'string' && format.toLowerCase() === 'jpeg') ? 'jpeg' : 'png'
    const q = Math.max(1, Math.min(100, Math.round(Number.isFinite(jpegQuality) ? Number(jpegQuality) : 90)))
    const encoded = fmt === 'jpeg'
      ? await pipeline.jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer()
      : await pipeline.png().toBuffer()
    // 允许调用方跳过固定尺寸缩放，以保持原图比例（用于前端基础预览的 TIFF 回退）
    const noScale = !!(payload && payload.noScale)
    if (noScale) {
      const pngBuf = (fmt === 'jpeg') ? await sharp(encoded).png().toBuffer() : encoded
      const md = await sharp(pngBuf).metadata().catch(()=>({ width: PREVIEW_W, height: PREVIEW_H }))
      const dataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`
      return { ok: true, url: dataUrl, width: md?.width || 0, height: md?.height || 0, debug }
    } else {
      const scaledPng = await sharp(encoded)
        .resize({ width: PREVIEW_W, height: PREVIEW_H, fit: 'contain', background: { r:255, g:255, b:255, alpha:1 } })
        .png()
        .toBuffer()
      const dataUrl = `data:image/png;base64,${scaledPng.toString('base64')}`
      return { ok: true, url: dataUrl, width: PREVIEW_W, height: PREVIEW_H, debug }
    }
  } catch (e) {
    return { ok: false, error: `[preview-worker] ${String(e?.message || e)}` }
  }
}

;(async () => {
  const res = await run(workerData)
  try { parentPort?.postMessage(res) } catch {}
})()
