/**
 * 计算预览区域内的几何数据：包含原图目标尺寸(ow/oh)、
 * 预览缩放比例(scale)、位移(ox/oy)、显示尺寸(dw/dh)、
 * 以及根据九宫格与偏移计算像素坐标的 calcPosition。
 * 统一由此 hook 提供，便于导出与预览的一致性。
 */
import { useMemo } from 'react'
import type { ResizeConfig, Template } from '../types/template'
import { clamp } from '../utils/math'

export type PreviewGeometry = ReturnType<typeof usePreviewGeometry>

export function usePreviewGeometry(
  W: number,
  H: number,
  margin: number,
  imgSize: { w: number; h: number } | null,
  orientedSize: { w: number; h: number } | null,
  template: Template,
  resize?: ResizeConfig
) {
  const geom = useMemo(() => {
    const baseW = orientedSize?.w || imgSize?.w || W
    const baseH = orientedSize?.h || imgSize?.h || H
    let ow = baseW, oh = baseH
    if (resize?.mode === 'percent' && Number.isFinite(resize?.percent)) {
      const p = Math.max(1, Math.round(Number(resize.percent)))
      const r = p / 100
      ow = Math.max(1, Math.round(baseW * r))
      oh = Math.max(1, Math.round(baseH * r))
    } else if (resize?.mode === 'custom') {
      const wIn = Number(resize?.width)
      const hIn = Number(resize?.height)
      const hasW = Number.isFinite(wIn) && wIn > 0
      const hasH = Number.isFinite(hIn) && hIn > 0
      if (hasW && hasH) { ow = Math.round(wIn); oh = Math.round(hIn) }
      else if (hasW && !hasH) { const s = Math.max(1, Math.round(wIn)) / baseW; ow = Math.max(1, Math.round(wIn)); oh = Math.max(1, Math.round(baseH * s)) }
      else if (!hasW && hasH) { const s = Math.max(1, Math.round(hIn)) / baseH; oh = Math.max(1, Math.round(hIn)); ow = Math.max(1, Math.round(baseW * s)) }
    }
    const scale = Math.min(W / ow, H / oh)
    const dw = Math.round(ow * scale)
    const dh = Math.round(oh * scale)
    const ox = Math.round((W - dw) / 2)
    const oy = Math.round((H - dh) / 2)

    function calcPosition(preset: string, offsetX = 0, offsetY = 0, clampInside = true) {
      let x = Math.floor(ow / 2), y = Math.floor(oh / 2)
      switch (preset) {
        case 'tl': x = margin; y = margin; break
        case 'tc': x = Math.floor(ow / 2); y = margin; break
        case 'tr': x = Math.max(0, ow - margin); y = margin; break
        case 'cl': x = margin; y = Math.floor(oh / 2); break
        case 'center': x = Math.floor(ow / 2); y = Math.floor(oh / 2); break
        case 'cr': x = Math.max(0, ow - margin); y = Math.floor(oh / 2); break
        case 'bl': x = margin; y = Math.max(0, oh - margin); break
        case 'bc': x = Math.floor(ow / 2); y = Math.max(0, oh - margin); break
        case 'br': x = Math.max(0, ow - margin); y = Math.max(0, oh - margin); break
      }
      const rawLeft = Math.round(x + (offsetX || 0))
      const rawTop  = Math.round(y + (offsetY || 0))
      const left = clampInside ? clamp(rawLeft, 0, ow - 1) : rawLeft
      const top  = clampInside ? clamp(rawTop , 0, oh - 1) : rawTop
      return { left, top }
    }

    const pos = calcPosition(
      template.layout.preset,
      template.layout.offsetX || 0,
      template.layout.offsetY || 0,
      !((template.layout as any)?.allowOverflow !== false)
    )
    const xDisp = ox + Math.round(pos.left * scale)
    const yDisp = oy + Math.round(pos.top * scale)

    return { ow, oh, scale, dw, dh, ox, oy, xDisp, yDisp, calcPosition }
  }, [W, H, margin, imgSize, orientedSize, template, resize])

  return geom
}
