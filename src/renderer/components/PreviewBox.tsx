import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Template, ResizeConfig } from '../types/template'
import { hexToRgba } from '../utils/color'
import { wrapFontFamily } from '../utils/font'

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
      const left = clampInside ? Math.max(0, Math.min(ow - 1, rawLeft)) : rawLeft
      const top  = clampInside ? Math.max(0, Math.min(oh - 1, rawTop)) : rawTop
      return { left, top }
    }

    const pos = calcPosition(
      template.layout.preset,
      template.layout.offsetX || 0,
      template.layout.offsetY || 0,
      !((template.layout as any)?.allowOverflow !== false) // 未设置或为 true 时不钳制
    )
    const xDisp = ox + Math.round(pos.left * scale)
    const yDisp = oy + Math.round(pos.top * scale)

    return { ow, oh, scale, dw, dh, ox, oy, xDisp, yDisp, calcPosition }
  }, [imgSize, orientedSize, template, resize])

  const dragging = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

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
    dragging.current = { startX: e.clientX, startY: e.clientY, baseX: geom.xDisp, baseY: geom.yDisp }
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
      {template.type === 'image' && wmUrl && (
        <img
          src={wmUrl}
          onLoad={(e:any)=> setWmSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onMouseDown={handleDown}
          style={{
            position: 'absolute',
            left: geom.xDisp,
            top: geom.yDisp,
            // 计算缩放后在预览画布上的尺寸
            width: (()=>{
              const natW = wmSize?.w || 1
              const natH = wmSize?.h || 1
              const mode = template.image?.scaleMode || 'proportional'
              if (mode === 'free') {
                const sx = Math.max(0.01, Number(template.image?.scaleX) || 1)
                return Math.max(1, Math.round(natW * sx * geom.scale))
              } else {
                const s = Math.max(0.01, Number(template.image?.scale) || 1)
                // 模拟 sharp inside 算法的舍入：先对目标盒子取整，再反推有效缩放，最后再取整尺寸
                const ww1 = Math.max(1, Math.round(natW * s))
                const hh1 = Math.max(1, Math.round(natH * s))
                const sEff = Math.min(ww1 / natW, hh1 / natH)
                const wwEff = Math.max(1, Math.round(natW * sEff))
                return Math.max(1, Math.round(wwEff * geom.scale))
              }
            })(),
            height: (()=>{
              const natW = wmSize?.w || 1
              const natH = wmSize?.h || 1
              const mode = template.image?.scaleMode || 'proportional'
              if (mode === 'free') {
                const sy = Math.max(0.01, Number(template.image?.scaleY) || 1)
                return Math.max(1, Math.round(natH * sy * geom.scale))
              } else {
                const s = Math.max(0.01, Number(template.image?.scale) || 1)
                const ww1 = Math.max(1, Math.round(natW * s))
                const hh1 = Math.max(1, Math.round(natH * s))
                const sEff = Math.min(ww1 / natW, hh1 / natH)
                const hhEff = Math.max(1, Math.round(natH * sEff))
                return Math.max(1, Math.round(hhEff * geom.scale))
              }
            })(),
            transform: (
              template.layout.preset === 'tl' ? 'translate(0, 0)' :
              template.layout.preset === 'tc' ? 'translate(-50%, 0)' :
              template.layout.preset === 'tr' ? 'translate(-100%, 0)' :
              template.layout.preset === 'cl' ? 'translate(0, -50%)' :
              template.layout.preset === 'center' ? 'translate(-50%, -50%)' :
              template.layout.preset === 'cr' ? 'translate(-100%, -50%)' :
              template.layout.preset === 'bl' ? 'translate(0, -100%)' :
              template.layout.preset === 'bc' ? 'translate(-50%, -100%)' :
              'translate(-100%, -100%)'
            ),
            opacity: Math.max(0, Math.min(1, Number(template.image?.opacity ?? 0.6))),
            cursor: 'move',
            userSelect: 'none',
            pointerEvents: 'auto'
          }}
        />
      )}
      {template.type === 'text' && (
        <div
          onMouseDown={handleDown}
          style={{
            position: 'absolute',
            left: geom.xDisp,
            top: geom.yDisp,
            transform: (
              template.layout.preset === 'tl' ? 'translate(0, 0)' :
              template.layout.preset === 'tc' ? 'translate(-50%, 0)' :
              template.layout.preset === 'tr' ? 'translate(-100%, 0)' :
              template.layout.preset === 'cl' ? 'translate(0, -50%)' :
              template.layout.preset === 'center' ? 'translate(-50%, -50%)' :
              template.layout.preset === 'cr' ? 'translate(-100%, -50%)' :
              template.layout.preset === 'bl' ? 'translate(0, -100%)' :
              template.layout.preset === 'bc' ? 'translate(-50%, -100%)' :
              'translate(-100%, -100%)'
            ) + (template.text?.italicSynthetic ? ` skewX(${-(template.text?.italicSkewDeg ?? 12)}deg)` : ''),
            transformOrigin: '50% 50%',
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
      )}

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
            const curr = geom.calcPosition(template.layout.preset, template.layout.offsetX || 0, template.layout.offsetY || 0)
            const xd = geom.ox + Math.round(curr.left * geom.scale)
            const yd = geom.oy + Math.round(curr.top  * geom.scale)
            return <div style={{ position: 'absolute', left: xd, top: yd, width: 10, height: 10, background: 'rgba(0,128,255,.9)', border: '1px solid #fff', borderRadius: 5, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} title="current" />
          })()}
        </>
      )}
    </div>
  )
}
