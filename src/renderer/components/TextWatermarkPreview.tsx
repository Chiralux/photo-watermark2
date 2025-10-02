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
import { normalizeOpacity } from '../utils/math'

function TextWatermarkPreviewInner({
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
  // 顶部对齐时不再额外下移，确保 tl/tc/tr 紧贴上边距
  if (vAlign === 'top') dyAdjust = 0
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
  // 先做锚点百分比平移，再做像素级基线/水平微调，最后旋转/仿斜
  const pixelAdjust = (dxAdjust !== 0 || dyAdjust !== 0)
    ? ` translate(${Math.round(dxAdjust)}px, ${Math.round(dyAdjust)}px)`
    : ''
  const transform = `${translate}${pixelAdjust}${rotation ? ` rotate(${rotation}deg)` : ''}${skew}`

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
        display: 'inline-block',
        whiteSpace: 'pre',          // 不自动换行，保留手动换行
        wordBreak: 'keep-all',      // CJK 文本尽量不分词换行
        overflow: 'visible',
        color: template.text?.color,
  // 兼容 0-1 与 0-100 两种输入，保持与导出端一致
  opacity: normalizeOpacity(template.text?.opacity ?? 0.6, 0.6),
        fontSize: template.text?.fontSize,
        lineHeight: `${template.text?.fontSize || 32}px`,
        fontFamily: wrapFontFamily(template.text?.fontFamily),
        fontWeight: (template.text?.fontWeight as any) || 'normal',
        fontStyle: (template.text?.fontStyle as any) || 'normal',
        WebkitTextStroke: (template.text?.outline?.enabled
          ? `${Math.max(1, Number(template.text?.outline?.width) || 0)}px ${hexToRgba(template.text?.outline?.color, template.text?.outline?.opacity ?? 1)}`
          : undefined
        ) as any,
        textShadow: (template.text?.shadow?.enabled
          ? `${Math.round(Number(template.text?.shadow?.offsetX) || 0)}px ${Math.round(Number(template.text?.shadow?.offsetY) || 0)}px ${Math.max(1, Number(template.text?.shadow?.blur) || 0)}px ${hexToRgba(template.text?.shadow?.color, template.text?.shadow?.opacity ?? 1)}`
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

function areEqual(prev: any, next: any) {
  if (prev.geom.xDisp !== next.geom.xDisp || prev.geom.yDisp !== next.geom.yDisp) return false
  const pt = prev.template?.text || {}
  const nt = next.template?.text || {}
  // 对文本自身的关键属性进行比较
  if (pt.content !== nt.content) return false
  if ((pt.fontSize||32) !== (nt.fontSize||32)) return false
  if (pt.fontFamily !== nt.fontFamily) return false
  if ((pt.fontWeight||'normal') !== (nt.fontWeight||'normal')) return false
  if ((pt.fontStyle||'normal') !== (nt.fontStyle||'normal')) return false
  // 归一化后比较 (支持 0-1/0-100/% 字符串)
  if (normalizeOpacity(pt.opacity ?? 0.6, 0.6) !== normalizeOpacity(nt.opacity ?? 0.6, 0.6)) return false
  if (pt.color !== nt.color) return false
  if ((pt.outline?.enabled||false) !== (nt.outline?.enabled||false)) return false
  if (pt.outline?.color !== nt.outline?.color) return false
  if ((pt.outline?.width||0) !== (nt.outline?.width||0)) return false
  if ((pt.outline?.opacity||0) !== (nt.outline?.opacity||0)) return false
  if ((pt.shadow?.enabled||false) !== (nt.shadow?.enabled||false)) return false
  if (pt.shadow?.color !== nt.shadow?.color) return false
  if ((pt.shadow?.offsetX||0) !== (nt.shadow?.offsetX||0)) return false
  if ((pt.shadow?.offsetY||0) !== (nt.shadow?.offsetY||0)) return false
  if ((pt.shadow?.blur||0) !== (nt.shadow?.blur||0)) return false
  if ((pt.rotation||0) !== (nt.rotation||0)) return false
  if ((pt.italicSynthetic||false) !== (nt.italicSynthetic||false)) return false
  if ((pt.italicSkewDeg||0) !== (nt.italicSkewDeg||0)) return false
  // 与布局相关：仅 preset 影响 transform/对齐，offset 在 PreviewBox 中已转为 geom
  if (prev.template?.layout?.preset !== next.template?.layout?.preset) return false
  return true
}

export const TextWatermarkPreview = React.memo(TextWatermarkPreviewInner, areEqual)