import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

type Template = {
  type: 'text' | 'image'
  text?: { content: string; fontFamily?: string; fontSize?: number; opacity?: number; color?: string }
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
  const [naming, setNaming] = useState<{ prefix?: string; suffix?: string }>({ suffix: '_watermarked' })

  const [tpl, setTpl] = useState<Template>({
    type: 'text',
    text: { content: '© MyBrand', fontFamily: 'Arial', fontSize: 32, opacity: 0.6, color: '#FFFFFF' },
    layout: { preset: 'center', offsetX: 0, offsetY: 0 },
  })

  // 启动时加载上次模板
  useEffect(() => {
    (async () => {
      try {
        const last = await window.api.templates.loadLast()
        if (last) setTpl(last)
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

  const onImport = async () => {
    if (!hasApi()) { alert('预加载未生效：无法访问系统文件对话框。请重启应用或联系开发者。'); return }
    const paths = await window.api.openFiles()
    if (paths?.length) setFiles(paths)
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

    const tasks = files.map(f => ({ inputPath: f, config: tpl }))
    const res = await window.api.exportApplyWatermark({ tasks, outputDir, format, naming, jpegQuality: 90 })
    alert(`导出完成：${res?.length || 0} 张`)
  }

  // 拖拽导入处理
  const handleDrop = async (e: any) => {
    e.preventDefault(); e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files || []) as any[]
    const paths = files.map(f => f.path).filter(Boolean)
    const list = (window as any).dragIngest ? await (window as any).dragIngest.ingest(paths) : []
    if (list?.length) setFiles(list)
  }
  const handleDragOver = (e: any) => { e.preventDefault() }

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver} style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, Arial' }}>
      <aside style={{ width: 280, borderRight: '1px solid #eee', padding: 12, overflow: 'auto' }}>
        <h3>文件</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onImport}>导入图片</button>
          <button onClick={async ()=>{ if(!(window as any).api){alert('预加载未生效');return} const list = await window.api.openDirectory(); if(list?.length) setFiles(list)}}>导入文件夹</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {files.map((f: string, i: number) => (
            <li key={f} onClick={() => setSelected(i)} style={{ cursor: 'pointer', padding: '6px 4px', background: selected===i?'#eef':'transparent' }}>
              {f.split(/\\/).pop()}
            </li>
          ))}
        </ul>
      </aside>

      <main style={{ flex: 1, display: 'flex' }}>
        <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f7' }}>
          {files.length ? (
            <PreviewBox template={tpl} imagePath={files[selected]} onChange={(layout) => setTpl({ ...tpl, layout })} />
          ) : (
            <div style={{ color: '#999' }}>请导入图片或拖拽图片/文件夹到窗口</div>
          )}
        </section>
        <section style={{ width: 320, borderLeft: '1px solid #eee', padding: 12, overflow: 'auto' }}>
          <h3>水印</h3>
          <div>
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
              </div>
              <label style={{ display: 'block', marginTop: 8 }}>颜色 <input type="color" value={tpl.text?.color || '#ffffff'} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, color: e.target.value } })} /></label>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div>九宫格</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {presets.map(p => (
                <button key={p.key} onClick={() => setTpl({ ...tpl, layout: { ...tpl.layout, preset: p.key } })} style={{ padding: 8, background: tpl.layout.preset===p.key?'#cde':'#fafafa' }}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <label>X偏移 <input type="number" value={tpl.layout.offsetX || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetX: Number(e.target.value) } })} style={{ width: 80 }} /></label>
              <label>Y偏移 <input type="number" value={tpl.layout.offsetY || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetY: Number(e.target.value) } })} style={{ width: 80 }} /></label>
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>导出</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <label><input type="radio" checked={format==='png'} onChange={() => setFormat('png')} /> PNG</label>
            <label><input type="radio" checked={format==='jpeg'} onChange={() => setFormat('jpeg')} /> JPEG</label>
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

function PreviewBox({ template, imagePath, onChange }: { template: Template; imagePath?: string; onChange: (layout: Template['layout']) => void }) {
  const W = 480, H = 300, margin = 16
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  const fileUrl = useMemo(() => {
    if (!imagePath) return ''
    if (imagePath.startsWith('file:')) return imagePath
    // Windows 本地路径转 file:// URL
    return 'file:///' + encodeURI(imagePath.replace(/\\/g, '/'))
  }, [imagePath])

  const geom = useMemo(() => {
    const ow = imgSize?.w || W
    const oh = imgSize?.h || H
    // 使用 cover 模式：填满容器，可能裁剪，避免两侧留边
    const scale = Math.max(W / ow, H / oh)
    const dw = Math.round(ow * scale)
    const dh = Math.round(oh * scale)
    const ox = Math.round((W - dw) / 2)
    const oy = Math.round((H - dh) / 2)

    // 计算原图坐标系中的基准锚点
    function baseAnchor(preset: string) {
      let x0 = Math.floor(ow / 2), y0 = Math.floor(oh / 2)
      switch (preset) {
        case 'tl': x0 = margin; y0 = margin; break
        case 'tc': x0 = Math.floor(ow / 2); y0 = margin; break
        case 'tr': x0 = ow - margin; y0 = margin; break
        case 'cl': x0 = margin; y0 = Math.floor(oh / 2); break
        case 'center': x0 = Math.floor(ow / 2); y0 = Math.floor(oh / 2); break
        case 'cr': x0 = ow - margin; y0 = Math.floor(oh / 2); break
        case 'bl': x0 = margin; y0 = oh - margin; break
        case 'bc': x0 = Math.floor(ow / 2); y0 = oh - margin; break
        case 'br': x0 = ow - margin; y0 = oh - margin; break
      }
      return { x0, y0 }
    }

    const { x0, y0 } = baseAnchor(template.layout.preset)
    const oxp = template.layout.offsetX || 0
    const oyp = template.layout.offsetY || 0
    const xOrig = x0 + oxp
    const yOrig = y0 + oyp
    const xDisp = ox + Math.round(xOrig * scale)
    const yDisp = oy + Math.round(yOrig * scale)

    return { ow, oh, scale, dw, dh, ox, oy, xDisp, yDisp, baseAnchor }
  }, [imgSize, template])

  const dragging = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

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
    const { x0, y0 } = geom.baseAnchor(template.layout.preset)
    const offsetX = Math.round(xOrig - x0)
    const offsetY = Math.round(yOrig - y0)
    onChange({ ...template.layout, offsetX, offsetY })
  }
  function handleUp() { dragging.current = null }

  return (
    <div style={{ width: W, height: H, background: '#fff', border: '1px dashed #ccc', position: 'relative', overflow: 'hidden' }} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}>
      {!!fileUrl && (
        <img src={fileUrl} onLoad={(e: any) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
             style={{ position: 'absolute', left: geom.ox, top: geom.oy, width: geom.dw, height: geom.dh, userSelect: 'none', pointerEvents: 'none' }} />
      )}
      {template.type === 'text' && (
        <div onMouseDown={handleDown} style={{ position: 'absolute', left: geom.xDisp, top: geom.yDisp, transform: 'translate(-50%, -50%)', color: template.text?.color, opacity: template.text?.opacity, fontSize: template.text?.fontSize, fontFamily: template.text?.fontFamily, cursor: 'move', userSelect: 'none', textShadow: '0 0 1px rgba(0,0,0,.2)' }}>
          {template.text?.content}
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
