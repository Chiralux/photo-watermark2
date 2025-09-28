/**
 * 文本水印预览组件
 * - 负责文本的 transform 组合：translate(锚点校正)+rotate(+仿斜)
 * - 样式包含描边/阴影/字体族等，保持与导出端一致的视觉
 */
import React from 'react'
import type { Template } from '../types/template'
import { transformOriginByPreset } from '../utils/anchor'
import { hexToRgba } from '../utils/color'
import { wrapFontFamily } from '../utils/font'

export function TextWatermarkPreview({
  geom,
  template,
  onMouseDown,
}: {
  geom: { xDisp: number; yDisp: number }
  template: Template
  onMouseDown: (e: any) => void
}) {
  const rotation = typeof template.text?.rotation === 'number' && !isNaN(template.text.rotation)
    ? template.text.rotation : 0

  // 与导出端 svg 文本逻辑对齐：根据九宫格确定 vAlign，并做基线/水平微调
  function getVAlignByPreset(preset: string): 'top'|'middle'|'bottom' {
    switch (preset) {
      case 'tl':
      case 'tc':
      case 'tr':
        return 'top'
      case 'cl':
      case 'center':
      case 'cr':
        return 'middle'
      case 'bl':
      case 'bc':
      case 'br':
        return 'bottom'
      default:
        return 'middle'
    }
  }
  const vAlign = getVAlignByPreset(template.layout.preset)
  const fontSize = Number(template.text?.fontSize || 32)
  let dyAdjust = 0
  if (vAlign === 'top') dyAdjust = Math.round(fontSize * 0.8)
  else if (vAlign === 'middle') dyAdjust = fontSize * 0.40
  else if (vAlign === 'bottom') dyAdjust = -Math.round(fontSize * 0.2)

  // 预览端直接使用像素，不需要缩放换算
  if (Number.isFinite(template.text?.baselineAdjust)) {
    dyAdjust += Number(template.text!.baselineAdjust)
  }
  let dxAdjust = 0
  if (Number.isFinite(template.text?.baselineAdjustX)) {
    dxAdjust += Number(template.text!.baselineAdjustX)
  }

  const translate = (
    template.layout.preset === 'tl' ? 'translate(0, 0)' :
    template.layout.preset === 'tc' ? 'translate(-50%, 0)' :
    template.layout.preset === 'tr' ? 'translate(-100%, 0)' :
    template.layout.preset === 'cl' ? 'translate(0, -50%)' :
    template.layout.preset === 'center' ? 'translate(-50%, -50%)' :
    template.layout.preset === 'cr' ? 'translate(-100%, -50%)' :
    template.layout.preset === 'bl' ? 'translate(0, -100%)' :
    template.layout.preset === 'bc' ? 'translate(-50%, -100%)' :
    'translate(-100%, -100%)'
  )
  const skew = template.text?.italicSynthetic ? ` skewX(${-(template.text?.italicSkewDeg ?? 12)}deg)` : ''
  const transform = `${translate}${rotation ? ` rotate(${rotation}deg)` : ''}${skew}`

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        // 直接使用容器内的局部坐标
        left: geom.xDisp,
        top: geom.yDisp,
        transformOrigin: transformOriginByPreset(template.layout.preset),
        transform,
        color: template.text?.color,
        opacity: template.text?.opacity ?? 0.6,
        fontSize: template.text?.fontSize,
        lineHeight: `${template.text?.fontSize || 32}px`,
        fontFamily: wrapFontFamily(template.text?.fontFamily),
        fontWeight: (template.text?.fontWeight as any) || 'normal',
        fontStyle: (template.text?.fontStyle as any) || 'normal',
        WebkitTextStroke: (template.text?.outline?.enabled
          ? `${Math.max(0, template.text?.outline?.width || 0)}px ${hexToRgba(template.text?.outline?.color, template.text?.outline?.opacity ?? 1)}`
          : undefined
        ) as any,
        textShadow: (template.text?.shadow?.enabled
          ? `${Math.round(template.text?.shadow?.offsetX || 0)}px ${Math.round(template.text?.shadow?.offsetY || 0)}px ${Math.max(0, template.text?.shadow?.blur || 0)}px ${hexToRgba(template.text?.shadow?.color, template.text?.shadow?.opacity ?? 1)}`
          : '0 0 1px rgba(0,0,0,.2)'
        ),
        cursor: 'move',
        userSelect: 'none',
      }}
    >
      {template.text?.content}
    </div>
  )
}
