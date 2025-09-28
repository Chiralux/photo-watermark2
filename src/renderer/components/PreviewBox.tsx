import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Template, ResizeConfig } from '../types/template'
import { usePreviewGeometry } from '../hooks/usePreviewGeometry'
import { ImageWatermarkPreview } from './ImageWatermarkPreview'
import { TextWatermarkPreview } from './TextWatermarkPreview'

export function PreviewBox({ template, imagePath, onChange, showDebugAnchors, resize }: {
  template: Template
  imagePath?: string
  onChange: (layout: Template['layout']) => void
  showDebugAnchors?: boolean
  resize?: ResizeConfig
}) {
  const W = 480, H = 300, margin = 16
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [orientedSize, setOrientedSize] = useState<{ w: number; h: number } | null>(null)
  const [wmSize, setWmSize] = useState<{ w: number; h: number } | null>(null)

  const fileUrl = useMemo(() => {
    if (!imagePath) return ''
    if (imagePath.startsWith('file:')) return imagePath
    return 'file:///' + encodeURI(imagePath.replace(/\\/g, '/'))
  }, [imagePath])

  const wmUrl = useMemo(() => {
    const p = template.type === 'image' ? template.image?.path : ''
    if (!p) return ''
    if (p.startsWith('file:')) return p
    return 'file:///' + encodeURI(p.replace(/\\/g, '/'))
  }, [template])

  const geom = usePreviewGeometry(W, H, margin, imgSize, orientedSize, template, resize)

  // 计算当前锚点在“底图局部坐标系”中的像素位置（用于在裁剪容器内定位）
  const currPos = useMemo(() => {
    return geom.calcPosition(
      template.layout.preset,
      template.layout.offsetX || 0,
      template.layout.offsetY || 0,
      !((template.layout as any)?.allowOverflow !== false) // 与导出/预览一致：allowOverflow=>不钳制
    )
  }, [geom, template.layout])
  const xLocal = Math.round(currPos.left * geom.scale)
  const yLocal = Math.round(currPos.top  * geom.scale)
  const xAbs = geom.ox + xLocal
  const yAbs = geom.oy + yLocal

  const dragging = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // transformOriginByPreset 已迁移至 utils/anchor

  useEffect(() => {
    if (!geom || !template?.layout) return
    // 当允许越界时，不进行任何钳制，让 offset 可超出边界
    if (((template.layout as any)?.allowOverflow !== false)) return
    const base = geom.calcPosition(template.layout.preset, 0, 0, true)
    const minOffsetX = -base.left
    const maxOffsetX = (geom.ow - 1) - base.left
    const minOffsetY = -base.top
    const maxOffsetY = (geom.oh - 1) - base.top
    const curX = template.layout.offsetX || 0
    const curY = template.layout.offsetY || 0
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const nx = clamp(curX, minOffsetX, maxOffsetX)
    const ny = clamp(curY, minOffsetY, maxOffsetY)
    if (nx !== curX || ny !== curY) {
      onChange({ ...template.layout, offsetX: nx, offsetY: ny })
    }
  }, [geom.ow, geom.oh, template.layout.preset, (template.layout as any)?.allowOverflow])

  function handleDown(e: any) {
    // 以“当前锚点在预览容器中的绝对位置”为拖拽基准，保持与旧逻辑一致
    dragging.current = { startX: e.clientX, startY: e.clientY, baseX: xAbs, baseY: yAbs }
    // 绑定窗口级事件，允许鼠标移出容器仍然跟踪
    window.addEventListener('mousemove', handleMove as any, { passive: false })
    window.addEventListener('mouseup', handleUp as any, { passive: false, once: false })
    e.stopPropagation(); e.preventDefault()
  }
  function handleMove(e: any) {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.startX
    const dy = e.clientY - dragging.current.startY
    const minX = 0, maxX = W
    const minY = 0, maxY = H
    // 允许越界时，不再将拖拽点钳制在容器内，最大限度还原真实偏移
    const allowOverflow = ((template.layout as any)?.allowOverflow !== false)
    const nxRaw = Math.round(dragging.current.baseX + dx)
    const nyRaw = Math.round(dragging.current.baseY + dy)
    const nx = allowOverflow ? nxRaw : Math.max(minX, Math.min(maxX, nxRaw))
    const ny = allowOverflow ? nyRaw : Math.max(minY, Math.min(maxY, nyRaw))

    const xOrig = (nx - geom.ox) / geom.scale
    const yOrig = (ny - geom.oy) / geom.scale
    const base = geom.calcPosition(template.layout.preset, 0, 0, true)
    const offsetX = Math.round(xOrig - base.left)
    const offsetY = Math.round(yOrig - base.top)
    onChange({ ...template.layout, offsetX, offsetY })
  }
  function handleUp() {
    dragging.current = null
    window.removeEventListener('mousemove', handleMove as any)
    window.removeEventListener('mouseup', handleUp as any)
  }

  return (
  <div style={{ width: W, height: H, background: '#fff', border: '1px dashed #ccc', position: 'relative', overflow: 'hidden' }}>
      {!!fileUrl && (
        <img src={fileUrl} onLoad={async (e: any) => {
                setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                try {
                  if ((window as any).imageMeta?.get && imagePath) {
                    const m = await (window as any).imageMeta.get(imagePath)
                    const w = m?.orientedWidth || m?.width
                    const h = m?.orientedHeight || m?.height
                    if (w && h) setOrientedSize({ w, h })
                  }
                } catch {}
              }
            }
            style={{ position: 'absolute', left: geom.ox, top: geom.oy, width: geom.dw, height: geom.dh, userSelect: 'none', pointerEvents: 'none', imageOrientation: 'from-image' as any }} />
      )}
      {/* 水印包裹在与底图一致位置/尺寸的裁剪容器中，越界部分将被裁掉，与导出/压缩预览一致 */}
  <div style={{ position: 'absolute', left: geom.ox, top: geom.oy, width: geom.dw, height: geom.dh, overflow: 'hidden', pointerEvents: 'auto' }}>
        {template.type === 'image' && wmUrl && (
          <ImageWatermarkPreview
            wmUrl={wmUrl}
            wmSize={wmSize}
            setWmSize={(s)=> setWmSize(s)}
            geom={{ xDisp: xLocal, yDisp: yLocal, scale: geom.scale }}
            template={template}
            onMouseDown={handleDown}
          />
        )}
        {template.type === 'text' && (
          <TextWatermarkPreview
            geom={{ xDisp: xLocal, yDisp: yLocal }}
            template={template}
            onMouseDown={handleDown}
          />
        )}
      </div>

      {showDebugAnchors && (
        <>
          {['tl','tc','tr','cl','center','cr','bl','bc','br'].map((k) => {
            const p = geom.calcPosition(k, 0, 0)
            const xd = geom.ox + Math.round(p.left * geom.scale)
            const yd = geom.oy + Math.round(p.top  * geom.scale)
            return (
              <div key={k} style={{ position: 'absolute', left: xd, top: yd, width: 8, height: 8, background: 'rgba(255,0,0,.8)', borderRadius: 4, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} title={k} />
            )
          })}
          {(() => {
            return <div style={{ position: 'absolute', left: xAbs, top: yAbs, width: 10, height: 10, background: 'rgba(0,128,255,.9)', border: '1px solid #fff', borderRadius: 5, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} title="current" />
          })()}
        </>
      )}
    </div>
  )
}
