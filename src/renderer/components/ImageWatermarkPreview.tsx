/**
 * 图片水印预览组件
 * - 负责按模板计算缩放后的显示尺寸
 * - 根据九宫格锚点(anchor)设置 transform-origin
 * - 通过 translate 将锚点对齐到几何定位点，再应用旋转
 */
import React from 'react'
import type { Template } from '../types/template'
import { anchorMap, anchorPresets } from '../utils/anchor'

export function ImageWatermarkPreview({
  wmUrl,
  wmSize,
  setWmSize,
  geom,
  template,
  onMouseDown,
}: {
  wmUrl: string
  wmSize: { w: number; h: number } | null
  setWmSize: (s: { w: number; h: number }) => void
  geom: { xDisp: number; yDisp: number; scale: number }
  template: Template
  onMouseDown: (e: any) => void
}) {
  const natW = wmSize?.w || 1
  const natH = wmSize?.h || 1
  const mode = template.image?.scaleMode || 'proportional'
  let ww = natW, hh = natH
  if (mode === 'free') {
    const sx = Math.max(0.01, Number(template.image?.scaleX) || 1)
    const sy = Math.max(0.01, Number(template.image?.scaleY) || 1)
    ww = Math.max(1, Math.round(natW * sx))
    hh = Math.max(1, Math.round(natH * sy))
  } else {
    const s = Math.max(0.01, Number(template.image?.scale) || 1)
    ww = Math.max(1, Math.round(natW * s))
    hh = Math.max(1, Math.round(natH * s))
  }
  const wDisp = Math.max(1, Math.round(ww * geom.scale))
  const hDisp = Math.max(1, Math.round(hh * geom.scale))

  const preset = template.layout.preset as typeof anchorPresets[number]
  const [ax, ay] = anchorMap[preset] || [0.5, 0.5]
  const anchorX = ax * wDisp
  const anchorY = ay * hDisp

  const left = geom.xDisp
  const top = geom.yDisp
  const transformOrigin = `${anchorX}px ${anchorY}px`
  const translateX = left - anchorX
  const translateY = top - anchorY
  const rotation = typeof template.image?.rotation === 'number' && !isNaN(template.image.rotation)
    ? template.image.rotation : 0

  return (
    <img
      src={wmUrl}
      onLoad={(e:any)=> setWmSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: wDisp,
        height: hDisp,
        transformOrigin,
        transform: `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg)`,
        opacity: Math.max(0, Math.min(1, Number(template.image?.opacity ?? 0.6))),
        cursor: 'move',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    />
  )
}
