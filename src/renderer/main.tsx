import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

type Template = {
  type: 'text' | 'image'
  text?: { content: string; fontFamily?: string; fontSize?: number; opacity?: number; color?: string; baselineAdjust?: number }
  image?: { path: string; opacity?: number; scale?: number }
  layout: { preset: string; offsetX?: number; offsetY?: number }
}

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openDirectory: () => Promise<string[]>
      selectOutputDir: () => Promise<string>
      exportApplyWatermark: (payload: any) => Promise<any>
      templates: {
        list: () => Promise<string[]>
        load: (name: string) => Promise<Template>
        save: (name: string, data: Template) => Promise<boolean>
        delete: (name: string) => Promise<boolean>
        loadLast: () => Promise<Template | null>
        saveLast: (data: Template) => Promise<boolean>
      }
    }
  }
}

const presets = [
  { key: 'tl', label: '左上' }, { key: 'tc', label: '上中' }, { key: 'tr', label: '右上' },
  { key: 'cl', label: '左中' }, { key: 'center', label: '中心' }, { key: 'cr', label: '右中' },
  { key: 'bl', label: '左下' }, { key: 'bc', label: '下中' }, { key: 'br', label: '右下' },
]

function App() {
  const hasApi = () => typeof window !== 'undefined' && (window as any).api && typeof (window as any).api.openFiles === 'function'
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<number>(0)
  const [outputDir, setOutputDir] = useState<string>('')
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [naming, setNaming] = useState<{ prefix?: string; suffix?: string }>({ prefix: 'wm_', suffix: '_watermarked' })
  const [showDebugAnchors, setShowDebugAnchors] = useState<boolean>(false)
  const [tplName, setTplName] = useState<string>('')
  const [tplList, setTplList] = useState<string[]>([])
  // 导出范围：仅当前预览 or 全部
  const [exportScope, setExportScope] = useState<'current' | 'all'>(() => {
    try { const v = localStorage.getItem('exportScope'); return (v === 'current' || v === 'all') ? (v as any) : 'all' } catch { return 'all' }
  })

  const [tpl, setTpl] = useState<Template>({
    type: 'text',
    text: { content: '© MyBrand', fontFamily: 'Arial', fontSize: 32, opacity: 0.6, color: '#FFFFFF', baselineAdjust: 0 },
    layout: { preset: 'center', offsetX: 0, offsetY: 0 },
  })

  // 启动时加载上次模板
  useEffect(() => {
    (async () => {
      try {
        const last = await window.api.templates.loadLast()
        if (last) setTpl(last)
        // 读取模板列表
        const names = await window.api.templates.list().catch(()=>[])
        setTplList(Array.isArray(names)? names : [])
      } catch {}
    })()
  }, [])

  // 模板变更时自动保存
  useEffect(() => {
    const id = setTimeout(() => {
      window.api.templates.saveLast(tpl).catch(() => {})
    }, 200)
    return () => clearTimeout(id)
  }, [tpl])

  // 记住导出范围选择
  useEffect(() => {
    try { localStorage.setItem('exportScope', exportScope) } catch {}
  }, [exportScope])

  // 工具函数：把新文件“追加”到现有列表（不覆盖），并去重（不区分大小写）；
  // 行为：若有新增，自动选中新增的第一张，便于快速预览。
  const appendFiles = (incoming: string[]) => {
    if (!incoming?.length) return
    setFiles(prev => {
      const oldLen = prev.length
      const seen = new Set(prev.map(p => p.toLowerCase()))
      const toAdd = incoming.filter(p => {
        const key = p.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (toAdd.length) {
        // 选中新追加的第一张
        setSelected(oldLen)
        return [...prev, ...toAdd]
      }
      return prev
    })
  }

  // 通过文件对话框导入：采用“追加不覆盖”的策略
  const onImport = async () => {
    if (!hasApi()) { alert('预加载未生效：无法访问系统文件对话框。请重启应用或联系开发者。'); return }
    const paths = await window.api.openFiles()
    if (paths?.length) appendFiles(paths)
  }

  const onSelectOutput = async () => {
    if (!hasApi()) { alert('预加载未生效：无法访问系统目录对话框。'); return }
    const dir = await window.api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }

  const onExport = async () => {
    if (!hasApi()) { alert('预加载未生效：无法执行导出。'); return }
    if (!files.length) return alert('请先导入图片')
    if (!outputDir) return alert('请先选择导出文件夹')
    // 基本防覆盖：若输出目录与首张图片目录一致则提醒
    const srcDir = files[0].replace(/\\[^\\]+$/, '')
    if (srcDir === outputDir) {
      const ok = confirm('输出目录与源目录相同，可能覆盖原图，是否继续？')
      if (!ok) return
    }
    // 根据导出范围构建任务
    const idx = Math.max(0, Math.min(selected, files.length - 1))
    const chosen = exportScope === 'current' ? [files[idx]] : files
    const tasks = chosen.map(f => ({ inputPath: f, config: tpl }))
    const res = await window.api.exportApplyWatermark({ tasks, outputDir, format, naming, jpegQuality: 90 })
    alert(`导出完成：${res?.length || 0} 张`)
  }

  // 拖拽导入处理
  // 拖拽导入：同样“追加不覆盖”，并自动选中新追加的首张
  const handleDrop = async (e: any) => {
    e.preventDefault(); e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files || []) as any[]
    const paths = files.map(f => f.path).filter(Boolean)
    const list = (window as any).dragIngest ? await (window as any).dragIngest.ingest(paths) : []
    if (list?.length) appendFiles(list)
  }
  const handleDragOver = (e: any) => { e.preventDefault() }

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver} style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, Arial' }}>
      <aside style={{ width: 280, borderRight: '1px solid #eee', padding: 12, overflow: 'auto' }}>
        <h3>文件</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onImport}>导入图片</button>
          <button onClick={async ()=>{ if(!(window as any).api){alert('预加载未生效');return} const list = await window.api.openDirectory(); if(list?.length) appendFiles(list)}}>导入文件夹</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {files.map((f: string, i: number) => (
            <li key={f} onClick={() => setSelected(i)} style={{ cursor: 'pointer', padding: '6px 4px', background: selected===i?'#eef':'transparent' }}>
              {f.split(/\\/).pop()}
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: 12 }}>模板</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input placeholder="输入模板名" value={tplName} onChange={(e:any)=>setTplName(e.target.value)} style={{ flex: 1 }} />
          <button onClick={async ()=>{
            const name = tplName.trim()
            if (!name) { alert('请输入模板名'); return }
            await window.api.templates.save(name, tpl)
            setTplName('')
            const names = await window.api.templates.list().catch(()=>[])
            setTplList(Array.isArray(names)? names : [])
            // 也把当前配置设为最近一次
            await window.api.templates.saveLast(tpl)
            alert('模板已保存')
          }}>保存</button>
        </div>
        <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {tplList.length? tplList.map(n => (
              <li key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid #f2f2f2' }}>
                <span>{n}</span>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button onClick={async ()=>{
                    try {
                      const t = await window.api.templates.load(n)
                      if (t) setTpl(t)
                      await window.api.templates.saveLast(t)
                    } catch { alert('加载模板失败') }
                  }}>加载</button>
                  <button onClick={async ()=>{
                    const ok = confirm(`删除模板 “${n}”？`)
                    if (!ok) return
                    const ok2 = await window.api.templates.delete(n)
                    if (!ok2) { alert('删除失败'); return }
                    const names = await window.api.templates.list().catch(()=>[])
                    setTplList(Array.isArray(names)? names : [])
                  }}>删除</button>
                </span>
              </li>
            )) : (
              <li style={{ padding: 8, color: '#888' }}>暂无模板</li>
            )}
          </ul>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex' }}>
        <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f7' }}>
          {files.length ? (
            <PreviewBox template={tpl} imagePath={files[selected]} onChange={(layout) => setTpl({ ...tpl, layout })} showDebugAnchors={showDebugAnchors} />
          ) : (
            <div style={{ color: '#999' }}>请导入图片或拖拽图片/文件夹到窗口</div>
          )}
        </section>
        <section style={{ width: 320, borderLeft: '1px solid #eee', padding: 12, overflow: 'auto' }}>
          <h3>水印</h3>
          <div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={showDebugAnchors} onChange={(e: any) => setShowDebugAnchors(!!e.target.checked)} /> 显示调试锚点
            </label>
            <label>
              <input type="radio" name="wmtype" checked={tpl.type==='text'} onChange={() => setTpl({ ...tpl, type: 'text' })} /> 文本
            </label>
            <label style={{ marginLeft: 16 }}>
              <input type="radio" name="wmtype" checked={tpl.type==='image'} onChange={() => setTpl({ ...tpl, type: 'image', image: { path: '', opacity: 0.6, scale: 1 } })} /> 图片（高级）
            </label>
          </div>

          {tpl.type === 'text' && (
            <div style={{ marginTop: 8 }}>
              <div>内容</div>
              <textarea value={tpl.text?.content || ''} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, content: e.target.value } })} rows={3} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <label>字号 <input type="number" value={tpl.text?.fontSize || 32} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, fontSize: Number(e.target.value) } })} style={{ width: 80 }} /></label>
                <label>不透明度 <input type="number" min={0} max={1} step={0.05} value={tpl.text?.opacity ?? 0.6} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, opacity: Number(e.target.value) } })} style={{ width: 80 }} /></label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  基线微调(px)
                  <span
                    style={{ display: 'inline-block', width: 16, height: 16, lineHeight: '16px', borderRadius: 8, background: '#e6f0ff', color: '#245', textAlign: 'center', cursor: 'default', fontSize: 12 }}
                    title={
                      '只影响导出图像的文字垂直位置，不改变预览位置。\n' +
                      '用途：当你发现导出的水印比预览略高/略低时，用它来做像素级校准。\n' +
                      '正数：导出向下移动；负数：导出向上移动。\n' +
                      '单位：预览像素（会自动按图片尺寸换算成原图像素）。'
                    }
                  >?
                  </span>
                  <input type="number" step={1} value={tpl.text?.baselineAdjust ?? 0} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, baselineAdjust: Number(e.target.value) } })} style={{ width: 100 }} />
                </label>
              </div>
              <label style={{ display: 'block', marginTop: 8 }}>颜色 <input type="color" value={tpl.text?.color || '#ffffff'} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, color: e.target.value } })} /></label>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div>九宫格</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {presets.map(p => (
                <button
                  key={p.key}
                  onClick={() => setTpl({ ...tpl, layout: { ...tpl.layout, preset: p.key, offsetX: 0, offsetY: 0 } })}
                  style={{ padding: 8, background: tpl.layout.preset===p.key?'#cde':'#fafafa' }}
                >{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <label>X偏移 <input type="number" value={tpl.layout.offsetX || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetX: Number(e.target.value) } })} style={{ width: 80 }} /></label>
              <label>Y偏移 <input type="number" value={tpl.layout.offsetY || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetY: Number(e.target.value) } })} style={{ width: 80 }} /></label>
              <button onClick={() => setTpl({ ...tpl, layout: { ...tpl.layout, offsetX: 0, offsetY: 0 } })}>重置偏移</button>
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>导出</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <label><input type="radio" checked={format==='png'} onChange={() => setFormat('png')} /> PNG</label>
            <label><input type="radio" checked={format==='jpeg'} onChange={() => setFormat('jpeg')} /> JPEG</label>
          </div>
          <div style={{ marginTop: 8 }}>
            <div>导出范围</div>
            <label>
              <input type="radio" name="exportScope" checked={exportScope==='current'} onChange={() => setExportScope('current')} /> 仅当前预览
            </label>
            <label style={{ marginLeft: 12 }}>
              <input type="radio" name="exportScope" checked={exportScope==='all'} onChange={() => setExportScope('all')} /> 列表全部
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <label>前缀 <input value={naming.prefix || ''} onChange={(e: any) => setNaming({ ...naming, prefix: e.target.value })} /></label>
            <label style={{ marginLeft: 8 }}>后缀 <input value={naming.suffix || ''} onChange={(e: any) => setNaming({ ...naming, suffix: e.target.value })} /></label>
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={onSelectOutput}>选择导出文件夹</button>
            <div style={{ color: '#666', wordBreak: 'break-all' }}>{outputDir || '未选择'}</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={onExport} disabled={!files.length || !outputDir}>开始导出</button>
          </div>
        </section>
      </main>
    </div>
  )
}

function PreviewBox({ template, imagePath, onChange, showDebugAnchors }: { template: Template; imagePath?: string; onChange: (layout: Template['layout']) => void; showDebugAnchors?: boolean }) {
  const W = 480, H = 300, margin = 16
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [orientedSize, setOrientedSize] = useState<{ w: number; h: number } | null>(null)

  const fileUrl = useMemo(() => {
    if (!imagePath) return ''
    if (imagePath.startsWith('file:')) return imagePath
    // Windows 本地路径转 file:// URL
    return 'file:///' + encodeURI(imagePath.replace(/\\/g, '/'))
  }, [imagePath])

  const geom = useMemo(() => {
    // 优先使用经 EXIF 方向修正后的尺寸，确保与浏览器显示一致
    const ow = orientedSize?.w || imgSize?.w || W
    const oh = orientedSize?.h || imgSize?.h || H
    // 使用 contain 模式：完整显示整张图片
    const scale = Math.min(W / ow, H / oh)
    const dw = Math.round(ow * scale)
    const dh = Math.round(oh * scale)
    const ox = Math.round((W - dw) / 2)
    const oy = Math.round((H - dh) / 2)

    // 与导出端一致的九宫格定位（返回中心点，且做边界夹取）
    function calcPosition(preset: string, offsetX = 0, offsetY = 0) {
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
      const left = Math.max(0, Math.min(ow - 1, Math.round(x + (offsetX || 0))))
      const top  = Math.max(0, Math.min(oh - 1, Math.round(y + (offsetY || 0))))
      return { left, top }
    }

    const pos = calcPosition(template.layout.preset, template.layout.offsetX || 0, template.layout.offsetY || 0)
    const xDisp = ox + Math.round(pos.left * scale)
    const yDisp = oy + Math.round(pos.top * scale)

    return { ow, oh, scale, dw, dh, ox, oy, xDisp, yDisp, calcPosition }
  }, [imgSize, orientedSize, template])

  const dragging = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // 若历史模板中包含过大的偏移，这里自动按当前图片尺寸与预设可达范围夹取，避免被位置夹回边缘造成“看似错位”
  useEffect(() => {
    if (!geom || !template?.layout) return
    const base = geom.calcPosition(template.layout.preset, 0, 0)
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
  }, [geom.ow, geom.oh, template.layout.preset])

  function handleDown(e: any) {
    dragging.current = { startX: e.clientX, startY: e.clientY, baseX: geom.xDisp, baseY: geom.yDisp }
    e.stopPropagation(); e.preventDefault()
  }
  function handleMove(e: any) {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.startX
    const dy = e.clientY - dragging.current.startY
    // 限制在容器可视区域内拖动（cover 模式下图片可能超出容器边界）
    const minX = 0, maxX = W
    const minY = 0, maxY = H
    const nx = Math.max(minX, Math.min(maxX, Math.round(dragging.current.baseX + dx)))
    const ny = Math.max(minY, Math.min(maxY, Math.round(dragging.current.baseY + dy)))

    // 反推到原图坐标
    const xOrig = (nx - geom.ox) / geom.scale
    const yOrig = (ny - geom.oy) / geom.scale
    // 基准点：当前预设下、offset=0 的中心
    const base = geom.calcPosition(template.layout.preset, 0, 0)
    const offsetX = Math.round(xOrig - base.left)
    const offsetY = Math.round(yOrig - base.top)
    onChange({ ...template.layout, offsetX, offsetY })
  }
  function handleUp() { dragging.current = null }

  return (
    <div style={{ width: W, height: H, background: '#fff', border: '1px dashed #ccc', position: 'relative', overflow: 'hidden' }} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}>
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
      {template.type === 'text' && (
        <div
          onMouseDown={handleDown}
          style={{
            position: 'absolute',
            left: geom.xDisp,
            top: geom.yDisp,
            // 根据九宫格预设决定锚点，确保不会因中心锚点导致越界
            transform: (
              template.layout.preset === 'tl' ? 'translate(0, 0)' :
              template.layout.preset === 'tc' ? 'translate(-50%, 0)' :
              template.layout.preset === 'tr' ? 'translate(-100%, 0)' :
              template.layout.preset === 'cl' ? 'translate(0, -50%)' :
              template.layout.preset === 'center' ? 'translate(-50%, -50%)' :
              template.layout.preset === 'cr' ? 'translate(-100%, -50%)' :
              template.layout.preset === 'bl' ? 'translate(0, -100%)' :
              template.layout.preset === 'bc' ? 'translate(-50%, -100%)' :
              /* br */ 'translate(-100%, -100%)'
            ),
            color: template.text?.color,
            opacity: template.text?.opacity,
            fontSize: template.text?.fontSize,
            lineHeight: `${template.text?.fontSize || 32}px`,
            fontFamily: template.text?.fontFamily,
            cursor: 'move',
            userSelect: 'none',
            textShadow: '0 0 1px rgba(0,0,0,.2)'
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

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
