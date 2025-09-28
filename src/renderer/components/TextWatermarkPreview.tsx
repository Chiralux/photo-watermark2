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
        left: geom.xDisp,
        top: geom.yDisp,
        transformOrigin: transformOriginByPreset(template.layout.preset),
        transform,
        color: template.text?.color,
        opacity: template.text?.opacity,
        fontSize: template.text?.fontSize,
        lineHeight: `${template.text?.fontSize || 32}px`,
        fontFamily: wrapFontFamily(template.text?.fontFamily),
        fontWeight: (template.text?.fontWeight as any) || 'normal',
        fontStyle: (template.text?.fontStyle as any) || 'normal',
        WebkitTextStroke: (template.text?.outline?.enabled ? `${Math.max(0, template.text?.outline?.width || 0)}px ${hexToRgba(template.text?.outline?.color, template.text?.outline?.opacity ?? 1)}` : undefined) as any,
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
