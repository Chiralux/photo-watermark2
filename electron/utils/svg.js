import sharp from 'sharp'
import { calcPosition } from '../watermark-geometry.js'

export function escapeHtml(str) {
  return String(str).replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))
}

// 生成文本水印 SVG，与导出端保持一致
export function buildTextSVG(text, layout, W, H) {
  const content = escapeHtml(text?.content || 'Watermark')
  const fontFamily = text?.fontFamily || 'Arial, Helvetica, sans-serif'
  const fontFamilyAttr = /[\s,]/.test(fontFamily) ? `'${fontFamily}', Arial, Helvetica, sans-serif` : `${fontFamily}, Arial, Helvetica, sans-serif`
  const fontFamilyAttrEscaped = escapeHtml(fontFamilyAttr)
  const PREVIEW_W = 480, PREVIEW_H = 300
  const scalePreviewToImage = Math.min(PREVIEW_W / (W || PREVIEW_W), PREVIEW_H / (H || PREVIEW_H))
  const fontSizeRaw = text?.fontSize || 32
  const fontSize = Math.max(8, (fontSizeRaw / (scalePreviewToImage || 1)))
  const color = text?.color || '#FFFFFF'
  const opacity = Math.max(0, Math.min(1, text?.opacity ?? 0.6))
  const fontWeight = (text?.fontWeight ?? 'normal')
  const fontStyle = (text?.fontStyle ?? 'normal')

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
  // 与预览端/usePreviewGeometry 及导出图片水印一致：
  // 当 allowOverflow 未显式设为 false 时，默认不钳制（clampInside=false）
  const clampInside = !(layout?.allowOverflow !== false)
  const { left, top } = calcPosition({ preset: layout?.preset, offsetX: layout?.offsetX || 0, offsetY: layout?.offsetY || 0 }, W, H, clampInside)
  let x = left
  let y = top
  let dyPx = 0
  // 顶部对齐不再额外下移，保证 tl/tc/tr 紧贴上边距
  if (vAlign === 'top') dyPx = 0
  else if (vAlign === 'middle') dyPx = fontSize * 0.40
  else if (vAlign === 'bottom') dyPx = -Math.round(fontSize * 0.2)
  const baselineAdjustPreviewPx = Number(text?.baselineAdjust || 0)
  if (baselineAdjustPreviewPx) {
    const baselineAdjustImagePx = baselineAdjustPreviewPx / (scalePreviewToImage || 1)
    dyPx += baselineAdjustImagePx
  }
  const baselineAdjustXPreviewPx = Number(text?.baselineAdjustX || 0)
  if (baselineAdjustXPreviewPx) {
    const baselineAdjustXImagePx = baselineAdjustXPreviewPx / (scalePreviewToImage || 1)
    x = x + baselineAdjustXImagePx
  }
  y = y + dyPx

  const defs = []
  if (shadowEnabled) {
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
  const syntheticItalic = !!text?.italicSynthetic
  const skewDeg = Number.isFinite(text?.italicSkewDeg) ? Number(text.italicSkewDeg) : 12
  const skewCmd = syntheticItalic ? `translate(${x}, ${y}) skewX(${-skewDeg}) translate(${-x}, ${-y})` : ''
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

// 将文本渲染为“精灵图”SVG（不包含定位/旋转），用于当作图片叠加。
// 之后在主进程里再进行旋转、锚点定位、越界裁剪，与图片水印完全一致。
export function buildTextSpriteSVG(text, W, H) {
  const contentRaw = text?.content || 'Watermark'
  const content = escapeHtml(contentRaw)
  const fontFamily = text?.fontFamily || 'Arial, Helvetica, sans-serif'
  const fontFamilyAttr = /[\s,]/.test(fontFamily) ? `'${fontFamily}', Arial, Helvetica, sans-serif` : `${fontFamily}, Arial, Helvetica, sans-serif`
  const fontFamilyAttrEscaped = escapeHtml(fontFamilyAttr)
  const PREVIEW_W = 480, PREVIEW_H = 300
  const scalePreviewToImage = Math.min(PREVIEW_W / (W || PREVIEW_W), PREVIEW_H / (H || PREVIEW_H))
  const fontSizeRaw = Number(text?.fontSize) || 32
  const fontSize = Math.max(8, fontSizeRaw / (scalePreviewToImage || 1))
  const color = text?.color || '#FFFFFF'
  // 直接在 SVG 上应用文字整体不透明度，避免 composite 阶段可能的兼容问题
  const normalizeOpacity = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return 1
    if (n <= 0) return 0
    if (n <= 1) return n
    return Math.min(1, n / 100)
  }
  const opacity = normalizeOpacity(text?.opacity ?? 0.6)
  const fontWeight = (text?.fontWeight ?? 'normal')
  const fontStyle = (text?.fontStyle ?? 'normal')

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
  const rawOutlineW = Number(text?.outline?.width)
  const outlineWidthPreviewPx = (outlineEnabled ? Math.max(1, Math.round(isFinite(rawOutlineW) ? rawOutlineW : 1)) : 0)
  const outlineWidthPx = Math.max(0, Math.round(outlineWidthPreviewPx / (scalePreviewToImage || 1)))
  const outlineOpacity = Math.max(0, Math.min(1, Number(text?.outline?.opacity) ?? 1))
  const outlineColorRGB = hexToRgb(text?.outline?.color || '#000000')

  const shadowEnabled = !!text?.shadow?.enabled
  const shadowOffsetXPreview = Math.round(Number(text?.shadow?.offsetX) || 0)
  const shadowOffsetYPreview = Math.round(Number(text?.shadow?.offsetY) || 0)
  const rawShadowBlur = Number(text?.shadow?.blur)
  const shadowBlurPreview = (shadowEnabled ? Math.max(1, Math.round(isFinite(rawShadowBlur) ? rawShadowBlur : 1)) : 0)
  const shadowOffsetX = shadowEnabled ? (shadowOffsetXPreview / (scalePreviewToImage || 1)) : 0
  const shadowOffsetY = shadowEnabled ? (shadowOffsetYPreview / (scalePreviewToImage || 1)) : 0
  const shadowBlur = shadowEnabled ? Math.max(0, shadowBlurPreview / (scalePreviewToImage || 1)) : 0
  const shadowOpacity = Math.max(0, Math.min(1, Number(text?.shadow?.opacity) ?? 1))
  const shadowColorRGB = hexToRgb(text?.shadow?.color || '#000000')

  // 估算画布尺寸：足够大，后续用 sharp.trim() 收紧
  const len = contentRaw.length || 1
  const pad = Math.round(fontSize * 2)
  const approxTextW = Math.max(fontSize * len * 0.8, fontSize * 2)
  const approxTextH = Math.max(Math.round(fontSize * 1.5), fontSize)
  const expandOutline = outlineEnabled ? outlineWidthPx * 2 : 0
  const expandShadowX = shadowEnabled ? (Math.abs(shadowOffsetX) + shadowBlur) : 0
  const expandShadowY = shadowEnabled ? (Math.abs(shadowOffsetY) + shadowBlur) : 0
  const SW = Math.max(8, Math.ceil(approxTextW + pad * 2 + expandOutline + expandShadowX * 2))
  const SH = Math.max(8, Math.ceil(approxTextH + pad * 2 + expandOutline + expandShadowY * 2))

  const cx = Math.round(SW / 2)
  const cy = Math.round(SH / 2)

  const defs = []
  if (shadowEnabled) {
    defs.push(`
  <filter id="wmShadowSprite" x="0" y="0" width="${SW}" height="${SH}" filterUnits="userSpaceOnUse">
        <feDropShadow dx="${shadowOffsetX}" dy="${shadowOffsetY}" stdDeviation="${shadowBlur}"
          flood-color="rgb(${shadowColorRGB.r},${shadowColorRGB.g},${shadowColorRGB.b})" flood-opacity="${shadowOpacity}" />
      </filter>`)
  }
  const strokeAttrs = outlineEnabled && outlineWidthPx>0
    ? `stroke="rgb(${outlineColorRGB.r},${outlineColorRGB.g},${outlineColorRGB.b})" stroke-opacity="${outlineOpacity}" stroke-width="${outlineWidthPx}" paint-order="stroke"`
    : ''
  const filterAttr = shadowEnabled ? `filter="url(#wmShadowSprite)"` : ''
  const syntheticItalic = !!text?.italicSynthetic
  const skewDeg = Number.isFinite(text?.italicSkewDeg) ? Number(text.italicSkewDeg) : 12
  const skewCmd = syntheticItalic ? `translate(${cx}, ${cy}) skewX(${-skewDeg}) translate(${-cx}, ${-cy})` : ''
  const groupTransform = [skewCmd].filter(Boolean).join(' ')
  const groupOpacityAttr = `opacity="${opacity}"`

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">
      ${defs.length?`<defs>${defs.join('\n')}</defs>`:''}
      ${groupTransform ? `<g transform="${groupTransform}" ${groupOpacityAttr}>` : `<g ${groupOpacityAttr}>`}
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-family="${fontFamilyAttrEscaped}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" ${strokeAttrs} ${filterAttr}>${content}</text>
      </g>
  </svg>`
}
