/**
 * 图片水印预览组件
 * - 负责按模板计算缩放后的显示尺寸
 * - 根据九宫格锚点(anchor)设置 transform-origin
 * - 通过 translate 将锚点对齐到几何定位点，再应用旋转
 */
import React from 'react'
import type { Template } from '../types/template'
import { anchorMap, anchorPresets } from '../utils/anchor'

function ImageWatermarkPreviewInner({
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

  // 在裁剪容器内渲染：geom.xDisp/geom.yDisp 已是相对容器的局部坐标
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
  // 以容器左上为(0,0)，再通过 translate 将锚点移动到局部坐标
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

function areEqual(prev: any, next: any) {
  // 忽略函数引用变化，仅关注与渲染相关的标量/字符串
  if (prev.wmUrl !== next.wmUrl) return false
  if (prev.geom.xDisp !== next.geom.xDisp || prev.geom.yDisp !== next.geom.yDisp || prev.geom.scale !== next.geom.scale) return false
  if ((prev.wmSize?.w||0) !== (next.wmSize?.w||0) || (prev.wmSize?.h||0) !== (next.wmSize?.h||0)) return false
  const pi = prev.template?.image || {}
  const ni = next.template?.image || {}
  if (pi.path !== ni.path) return false
  if ((pi.scale||1) !== (ni.scale||1)) return false
  if ((pi.scaleX||1) !== (ni.scaleX||1)) return false
  if ((pi.scaleY||1) !== (ni.scaleY||1)) return false
  if ((pi.scaleMode||'proportional') !== (ni.scaleMode||'proportional')) return false
  if ((pi.opacity??0.6) !== (ni.opacity??0.6)) return false
  if ((pi.rotation||0) !== (ni.rotation||0)) return false
  if (prev.template?.layout?.preset !== next.template?.layout?.preset) return false
  return true
}

export const ImageWatermarkPreview = React.memo(ImageWatermarkPreviewInner, areEqual)
