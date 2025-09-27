import React from 'react'

export function EstimatedSizeHint({ size, mode, widthVal, heightVal, percentVal }: {
  size: { w: number; h: number } | null
  mode: 'original'|'percent'|'custom'
  widthVal: number
  heightVal: number
  percentVal: number
}) {
  if (!size) return null
  const { w, h } = size
  let outW = w, outH = h
  if (mode === 'percent') {
    const p = Math.max(1, Math.round(percentVal||0))
    const ratio = p / 100
    outW = Math.max(1, Math.round(w * ratio))
    outH = Math.max(1, Math.round(h * ratio))
  } else if (mode === 'custom') {
    const W = Math.max(0, Math.round(widthVal||0))
    const H = Math.max(0, Math.round(heightVal||0))
    if (W && H) { outW = W; outH = H }
    else if (W && !H) {
      const ratio = w ? (W / w) : 1
      outW = W; outH = Math.max(1, Math.round(h * ratio))
    } else if (!W && H) {
      const ratio = h ? (H / h) : 1
      outH = H; outW = Math.max(1, Math.round(w * ratio))
    }
  }
  return (
    <div style={{ marginTop: 6, color: '#666', fontSize: 12 }}>
      预计导出尺寸：{outW} × {outH}px
    </div>
  )
}
