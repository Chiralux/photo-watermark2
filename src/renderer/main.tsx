import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Template, ResizeConfig } from './types/template'
import { wrapFontFamily } from './utils/font'
import { CompressedPreview } from './components/CompressedPreview'
import { EstimatedSizeHint } from './components/EstimatedSizeHint'
import { PreviewBox } from './components/PreviewBox'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openDirectory: () => Promise<string[]>
      selectOutputDir: () => Promise<string>
      exportApplyWatermark: (payload: any) => Promise<any>
      preview: { render: (payload: any) => Promise<{ ok: boolean; url?: string; dataUrl?: string; width?: number; height?: number; error?: string }> }
      templates: {
        list: () => Promise<string[]>
        load: (name: string) => Promise<Template>
        save: (name: string, data: Template) => Promise<boolean>
        delete: (name: string) => Promise<boolean>
        loadLast: () => Promise<Template | null>
        saveLast: (data: Template) => Promise<boolean>
        getAutoLoadConfig: () => Promise<{ autoLoad: 'last' | 'default'; defaultName: string | null }>
        setAutoLoadConfig: (cfg: { autoLoad: 'last' | 'default'; defaultName: string | null }) => Promise<boolean>
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
  const [currMeta, setCurrMeta] = useState<{ dateTaken?: string | null; dateSource?: string | null } | null>(null)
  const [currSize, setCurrSize] = useState<{ w: number; h: number } | null>(null)
  const [outputDir, setOutputDir] = useState<string>('')
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [naming, setNaming] = useState<{ prefix?: string; suffix?: string }>({ prefix: 'wm_', suffix: '_watermarked' })
  // 导出尺寸调整
  const [resizeMode, setResizeMode] = useState<'original'|'percent'|'custom'>(()=>{
    try {
      const v = localStorage.getItem('resizeMode')
      return (v==='percent'||v==='custom') ? (v as any) : 'original'
    } catch { return 'original' }
  })
  const [customWidth, setCustomWidth] = useState<number>(()=>{
    try { const v = Number(localStorage.getItem('customWidth')); return Number.isFinite(v) && v>0 ? Math.round(v) : 2048 } catch { return 2048 }
  })
  const [customHeight, setCustomHeight] = useState<number>(()=>{
    try { const v = Number(localStorage.getItem('customHeight')); return Number.isFinite(v) && v>0 ? Math.round(v) : 2048 } catch { return 2048 }
  })
  const [resizePercent, setResizePercent] = useState<number>(()=>{
    try { const v = Number(localStorage.getItem('resizePercent')); return Number.isFinite(v) && v>0 ? Math.round(v) : 100 } catch { return 100 }
  })
  // JPEG 质量（0-100，可选高级），仅在导出为 JPEG 时启用
  const [jpegQuality, setJpegQuality] = useState<number>(() => {
    try {
      const v = localStorage.getItem('jpegQuality')
      const n = Number(v)
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 90
    } catch { return 90 }
  })
  const [showDebugAnchors, setShowDebugAnchors] = useState<boolean>(false)
  const [tplName, setTplName] = useState<string>('')
  const [tplList, setTplList] = useState<string[]>([])
  const [fontList, setFontList] = useState<string[]>([])
  const [fontQuery, setFontQuery] = useState<string>('')
  const [fontAvailable, setFontAvailable] = useState<boolean>(true)
  const commonFonts = useMemo(() => (
    [
      'Segoe UI', 'Microsoft YaHei', 'Arial', 'Helvetica', 'PingFang SC',
      'SimSun', 'SimHei', 'Times New Roman', 'Courier New', 'Consolas'
    ]
  ), [])
  const fontListPrioritized = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    commonFonts.forEach(f => { if (f && !seen.has(f)) { out.push(f); seen.add(f) } })
    fontList.forEach(f => { if (f && !seen.has(f)) { out.push(f); seen.add(f) } })
    return out
  }, [fontList, commonFonts])
  const fontListCommon = useMemo(() => fontListPrioritized.filter(f => commonFonts.includes(f)), [fontListPrioritized, commonFonts])
  const fontListOthers = useMemo(() => fontListPrioritized.filter(f => !commonFonts.includes(f)), [fontListPrioritized, commonFonts])
  const fontFilter = useMemo(() => fontQuery.trim().toLowerCase(), [fontQuery])
  const fontListCommonFiltered = useMemo(() => (
    fontFilter ? fontListCommon.filter(f => f.toLowerCase().includes(fontFilter)) : fontListCommon
  ), [fontListCommon, fontFilter])
  const fontListOthersFiltered = useMemo(() => (
    fontFilter ? fontListOthers.filter(f => f.toLowerCase().includes(fontFilter)) : fontListOthers
  ), [fontListOthers, fontFilter])
  const filteredFontsMerged = useMemo(() => {
    const seen = new Set<string>()
    const merged = [...fontListCommonFiltered, ...fontListOthersFiltered]
    return merged.filter(f => { if (seen.has(f)) return false; seen.add(f); return true })
  }, [fontListCommonFiltered, fontListOthersFiltered])
  // 自动加载：'last' | 'default'，以及默认模板名
  const [autoLoad, setAutoLoad] = useState<'last' | 'default'>('last')
  const [defaultTplName, setDefaultTplName] = useState<string>('')
  const [metaFallback, setMetaFallback] = useState<{ allowFilename: boolean; allowFileTime: boolean }>({ allowFilename: true, allowFileTime: false })
  // 导出范围：仅当前预览 or 全部
  const [exportScope, setExportScope] = useState<'current' | 'all'>(() => {
    try {
      const v = localStorage.getItem('exportScope')
      return (v === 'current' || v === 'all') ? (v as any) : 'current'
    } catch {
      return 'current'
    }
  })

  // 压缩实时预览：在 JPEG 模式下可选，生成与导出一致的压缩效果
  const [enableCompressedPreview, setEnableCompressedPreview] = useState<boolean>(() => {
    try { return localStorage.getItem('enableCompressedPreview') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('enableCompressedPreview', enableCompressedPreview ? '1' : '0') } catch {}
  }, [enableCompressedPreview])

  const [tpl, setTpl] = useState<Template>({
    type: 'text',
    text: {
      content: '© MyBrand',
      fontFamily: 'Arial',
      fontSize: 32,
      fontWeight: 'normal',
      fontStyle: 'normal',
      opacity: 0.6,
      color: '#FFFFFF',
      baselineAdjust: 0,
      outline: { enabled: false, color: '#000000', width: 1, opacity: 0.25 },
      shadow: { enabled: false, color: '#000000', offsetX: 1, offsetY: 1, blur: 2, opacity: 0.3 },
    },
    layout: { preset: 'center', offsetX: 0, offsetY: 0 },
  })

  // 启动时加载上次模板 + 字体列表 + 配置
  useEffect(() => {
    (async () => {
      try {
        // 读取自动加载配置
        let cfg = await window.api.templates.getAutoLoadConfig().catch(()=>({ autoLoad: 'last', defaultName: null }))
        if (!cfg || (cfg.autoLoad !== 'last' && cfg.autoLoad !== 'default')) cfg = { autoLoad: 'last', defaultName: null }
  setAutoLoad((cfg.autoLoad as 'last' | 'default'))

        // 读取模板列表
        const names = await window.api.templates.list().catch(()=>[])
        setTplList(Array.isArray(names)? names : [])
        if (cfg.defaultName) setDefaultTplName(cfg.defaultName)
        // 读取系统字体
        try { const fs = await (window as any).api?.systemFonts?.list?.(); if (Array.isArray(fs)) setFontList(fs) } catch {}

        // 读取元数据回退配置
        if ((window as any).api?.meta?.getFallbackConfig) {
          const mf = await (window as any).api.meta.getFallbackConfig().catch(()=>null)
          if (mf) setMetaFallback({ allowFilename: mf.allowFilename !== false, allowFileTime: mf.allowFileTime === true })
        }

        // 按配置加载模板
        if (cfg.autoLoad === 'default' && cfg.defaultName) {
          try {
            const t = await window.api.templates.load(cfg.defaultName)
            if (t) setTpl(t)
          } catch {
            // 回退到 last
            const last = await window.api.templates.loadLast()
            if (last) setTpl(last)
          }
        } else {
          const last = await window.api.templates.loadLast()
          if (last) setTpl(last)
        }
      } catch {}
    })()
  }, [])

  // 检测当前选择字体是否可用（Chromium 字体加载 API）
  useEffect(() => {
    const fam = tpl.text?.fontFamily
    if (!fam) { setFontAvailable(true); return }
    let ok = true
    try {
      const fonts: any = (document as any).fonts
      ok = fonts?.check ? !!fonts.check(`12px "${fam}"`) : true
    } catch { ok = true }
    setFontAvailable(ok)
  }, [tpl.text?.fontFamily])

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

  // 记住 JPEG 质量
  useEffect(() => {
    try { localStorage.setItem('jpegQuality', String(jpegQuality)) } catch {}
  }, [jpegQuality])
  // 记住尺寸设置
  useEffect(()=>{ try { localStorage.setItem('resizeMode', resizeMode) } catch {} }, [resizeMode])
  useEffect(()=>{ try { localStorage.setItem('customWidth', String(customWidth)) } catch {} }, [customWidth])
  useEffect(()=>{ try { localStorage.setItem('customHeight', String(customHeight)) } catch {} }, [customHeight])
  useEffect(()=>{ try { localStorage.setItem('resizePercent', String(resizePercent)) } catch {} }, [resizePercent])

  // 读取当前选中文件的元数据（拍摄时间）
  useEffect(() => {
    (async () => {
      try {
        const path = files.length ? files[Math.max(0, Math.min(selected, files.length - 1))] : ''
        if (!path || !(window as any).imageMeta?.get) { setCurrMeta(null); return }
        const m = await (window as any).imageMeta.get(path)
        setCurrMeta({ dateTaken: m?.dateTaken ?? null, dateSource: m?.dateSource ?? null })
        const w = m?.orientedWidth || m?.width || 0
        const h = m?.orientedHeight || m?.height || 0
        setCurrSize(w && h ? { w, h } : null)
      } catch { setCurrMeta(null) }
    })()
  }, [files, selected])

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
    const resize = ((): any => {
      if (resizeMode === 'custom') {
        const w = Math.max(0, Math.round(customWidth||0))
        const h = Math.max(0, Math.round(customHeight||0))
        return { mode: 'custom', width: w || undefined, height: h || undefined }
      }
      if (resizeMode === 'percent') return { mode: 'percent', percent: Math.max(1, Math.round(resizePercent||0)) }
      return { mode: 'original' }
    })()
    const res = await window.api.exportApplyWatermark({ tasks, outputDir, format, naming, jpegQuality, resize })
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
          {files.map((f: string, i: number) => {
            const fileUrl = f.startsWith('file:') ? f : ('file:///' + encodeURI(f.replace(/\\/g, '/')))
            const name = f.split(/\\/).pop()
            return (
              <li
                key={f}
                onClick={() => setSelected(i)}
                style={{
                  cursor: 'pointer',
                  padding: '6px 6px',
                  background: selected===i?'#eef':'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                title={f}
              >
                <img
                  src={fileUrl}
                  alt={name}
                  width={48}
                  height={48}
                  loading="lazy"
                  style={{
                    width: 48,
                    height: 48,
                    objectFit: 'cover',
                    borderRadius: 4,
                    background: '#f3f3f3',
                    imageOrientation: 'from-image' as any,
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
              </li>
            )
          })}
        </ul>

        <h3 style={{ marginTop: 12 }}>模板</h3>
        <div style={{ marginBottom: 8, padding: 8, border: '1px solid #eee', borderRadius: 6, background: '#fafafa' }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>自动加载</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label><input type="radio" name="autoload" checked={autoLoad==='last'} onChange={()=>setAutoLoad('last')} /> 上次退出时设置</label>
            <label><input type="radio" name="autoload" checked={autoLoad==='default'} onChange={()=>setAutoLoad('default')} /> 默认模板</label>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            {autoLoad === 'default' && (
              <select value={defaultTplName} onChange={(e:any)=>setDefaultTplName(e.target.value)} style={{ flex: 1 }}>
                <option value="">（未选择）</option>
                {tplList.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            <button onClick={async ()=>{
              const ok = await window.api.templates.setAutoLoadConfig({ autoLoad, defaultName: autoLoad==='default' ? (defaultTplName || null) : null })
              if (!ok) { alert('保存失败'); return }
              alert('自动加载设置已保存')
            }}>保存</button>
          </div>
        </div>
        <div style={{ marginBottom: 8, padding: 8, border: '1px solid #eee', borderRadius: 6, background: '#fafafa' }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>拍摄时间回退</div>
          <label style={{ display: 'block', marginBottom: 6 }}>
            <input type="checkbox" checked={metaFallback.allowFilename} onChange={async (e:any)=>{
              const next = { ...metaFallback, allowFilename: !!e.target.checked }
              setMetaFallback(next)
              try { await (window as any).api?.meta?.setFallbackConfig?.(next) } catch {}
            }} />
            允许从文件名推断时间（如 20250113_141523）
          </label>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={metaFallback.allowFileTime} onChange={async (e:any)=>{
              const next = { ...metaFallback, allowFileTime: !!e.target.checked }
              setMetaFallback(next)
              try { await (window as any).api?.meta?.setFallbackConfig?.(next) } catch {}
            }} />
            允许用文件修改时间作为兜底（可能不是拍摄时间）
          </label>
        </div>
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
                    // 若删除的是当前默认模板，清空选择
                    if (n === defaultTplName) setDefaultTplName('')
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
            <div style={{ position: 'relative', width: 480, height: 300 }}>
              <PreviewBox
                template={tpl}
                imagePath={files[selected]}
                onChange={(layout) => setTpl({ ...tpl, layout })}
                showDebugAnchors={showDebugAnchors}
                resize={((): ResizeConfig => {
                  if (resizeMode === 'custom') return { mode: 'custom', width: Math.max(0, Math.round(customWidth||0)) || undefined, height: Math.max(0, Math.round(customHeight||0)) || undefined }
                  if (resizeMode === 'percent') return { mode: 'percent', percent: Math.max(1, Math.round(resizePercent||0)) }
                  return { mode: 'original' }
                })()}
              />
            </div>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <textarea value={tpl.text?.content || ''} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, content: e.target.value } })} rows={3} style={{ width: '100%' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button disabled={!currMeta?.dateTaken} title={currMeta?.dateTaken || '未检索到时间信息'} onClick={() => {
                    const dt = currMeta?.dateTaken
                    if (!dt) return
                    setTpl(prev => ({ ...prev, text: { ...prev.text!, content: dt } }))
                  }}>使用拍摄时间</button>
                </div>
              </div>
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>拍摄时间：{currMeta?.dateTaken || '未读取'}{currMeta?.dateTaken ? (currMeta?.dateSource ? `（来源：${currMeta.dateSource}）` : '') : ''}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <label>字体
                  <select value={tpl.text?.fontFamily || ''} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, fontFamily: e.target.value } })} style={{ maxWidth: 220, marginLeft: 6 }}>
                    <option value="">系统默认</option>
                    {fontListCommonFiltered.length>0 && (
                      <optgroup label="常用">
                        {fontListCommonFiltered.map(f => <option key={f} value={f}>{f}</option>)}
                      </optgroup>
                    )}
                    {fontListOthersFiltered.length>0 && (
                      <optgroup label="其它">
                        {fontListOthersFiltered.map(f => <option key={f} value={f}>{f}</option>)}
                      </optgroup>
                    )}
                    {(fontListCommonFiltered.length===0 && fontListOthersFiltered.length===0) && (
                      <option value="" disabled>未匹配到字体</option>
                    )}
                  </select>
                </label>
                <input
                  type="text"
                  placeholder="搜索字体..."
                  value={fontQuery}
                  onChange={(e:any)=> setFontQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 100 }}
                />
                {!!tpl.text?.fontFamily && (
                  <span style={{ color: fontAvailable? '#2a7' : '#d77', fontSize: 12 }}>
                    {fontAvailable ? '已加载' : '未检测到该字体（可能回退默认）'}
                  </span>
                )}
              </div>
              {fontFilter && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color:'#666', fontSize: 12, marginBottom: 4 }}>匹配 {filteredFontsMerged.length} 项</div>
                  <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #eee', borderRadius: 4, background: '#fff' }}>
                    {filteredFontsMerged.slice(0, 50).map(f => (
                      <div
                        key={f}
                        onMouseDown={(e)=> e.preventDefault()}
                        onClick={() => setTpl({ ...tpl, text: { ...tpl.text!, fontFamily: f } })}
                        style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f4f4f4' }}
                        title={`点击应用：${f}`}
                      >
                        <span style={{ fontFamily: wrapFontFamily(f), fontSize: 14 }}>{f}</span>
                        <span style={{ fontFamily: wrapFontFamily(f), color: '#555', marginLeft: 12 }}>
                          {(tpl.text?.content || 'Aa汉字123').slice(0, 12)}
                        </span>
                      </div>
                    ))}
                    {filteredFontsMerged.length > 50 && (
                      <div style={{ color:'#999', fontSize: 12, padding: '6px 8px' }}>已显示前 50 项，继续输入以缩小范围</div>
                    )}
                    {filteredFontsMerged.length === 0 && (
                      <div style={{ color:'#999', fontSize: 12, padding: '6px 8px' }}>未匹配到字体</div>
                    )}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <label>字号 <input type="number" value={tpl.text?.fontSize || 32} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, fontSize: Number(e.target.value) } })} style={{ width: 80 }} /></label>
                <label>粗体
                  <input type="checkbox" checked={(tpl.text?.fontWeight||'normal')!=='normal'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, fontWeight: e.target.checked ? 'bold' : 'normal' } })} style={{ marginLeft: 6 }} />
                </label>
                <label>斜体
                  <input type="checkbox" checked={(tpl.text?.fontStyle||'normal')==='italic'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, fontStyle: e.target.checked ? 'italic' : 'normal' } })} style={{ marginLeft: 6 }} />
                </label>
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
              {/* 描边设置 */}
              <fieldset style={{ marginTop: 8, border: '1px solid #eee' }}>
                <legend style={{ color: '#666' }}>描边</legend>
                <label>
                  <input type="checkbox" checked={!!tpl.text?.outline?.enabled} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), enabled: !!e.target.checked } } })} /> 启用
                </label>
                {tpl.text?.outline?.enabled && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <label>颜色 <input type="color" value={tpl.text?.outline?.color || '#000000'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), color: e.target.value } } })} /></label>
                    <label>宽度(px) <input type="number" min={0} step={1} style={{ width: 80 }} value={tpl.text?.outline?.width ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), width: Math.max(0, Math.round(Number(e.target.value)||0)) } } })} /></label>
                    <label>不透明度 <input type="number" min={0} max={1} step={0.05} style={{ width: 80 }} value={tpl.text?.outline?.opacity ?? 0.25} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), opacity: Math.max(0, Math.min(1, Number(e.target.value)||0)) } } })} /></label>
                  </div>
                )}
              </fieldset>
              {/* 阴影设置 */}
              <fieldset style={{ marginTop: 8, border: '1px solid #eee' }}>
                <legend style={{ color: '#666' }}>阴影</legend>
                <label>
                  <input type="checkbox" checked={!!tpl.text?.shadow?.enabled} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), enabled: !!e.target.checked } } })} /> 启用
                </label>
                {tpl.text?.shadow?.enabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <label>颜色 <input type="color" value={tpl.text?.shadow?.color || '#000000'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), color: e.target.value } } })} /></label>
                    <label>不透明度 <input type="number" min={0} max={1} step={0.05} style={{ width: 80 }} value={tpl.text?.shadow?.opacity ?? 0.3} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), opacity: Math.max(0, Math.min(1, Number(e.target.value)||0)) } } })} /></label>
                    <label>偏移X(px) <input type="number" step={1} style={{ width: 80 }} value={tpl.text?.shadow?.offsetX ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), offsetX: Math.round(Number(e.target.value)||0) } } })} /></label>
                    <label>偏移Y(px) <input type="number" step={1} style={{ width: 80 }} value={tpl.text?.shadow?.offsetY ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), offsetY: Math.round(Number(e.target.value)||0) } } })} /></label>
                    <label>模糊(px) <input type="number" min={0} step={1} style={{ width: 80 }} value={tpl.text?.shadow?.blur ?? 2} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), blur: Math.max(0, Math.round(Number(e.target.value)||0)) } } })} /></label>
                  </div>
                )}
              </fieldset>
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
          {format === 'jpeg' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>JPEG 质量</span>
                <input type="number" min={0} max={100} value={jpegQuality}
                  onChange={(e:any)=> setJpegQuality(Math.max(0, Math.min(100, Number(e.target.value)||0)))}
                  style={{ width: 72 }} />
              </div>
              <input type="range" min={0} max={100} step={1} value={jpegQuality}
                onChange={(e:any)=> setJpegQuality(Number(e.target.value)||0)}
                style={{ width: '100%' }} />
              <label style={{ display: 'block', marginTop: 6 }}>
                <input type="checkbox" checked={enableCompressedPreview} onChange={(e:any)=> setEnableCompressedPreview(!!e.target.checked)} />
                压缩实时预览（在预览中模拟 JPEG 质量效果）
              </label>
              {enableCompressedPreview && files.length>0 && (
                <div style={{ marginTop: 8, display: 'inline-block', border: '1px dashed #ccc', borderRadius: 4, overflow: 'hidden' }}>
                  <CompressedPreview
                    template={tpl}
                    imagePath={files[selected]}
                    jpegQuality={jpegQuality}
                    resize={((): ResizeConfig => {
                      if (resizeMode === 'custom') return { mode: 'custom', width: Math.max(0, Math.round(customWidth||0)) || undefined, height: Math.max(0, Math.round(customHeight||0)) || undefined }
                      if (resizeMode === 'percent') return { mode: 'percent', percent: Math.max(1, Math.round(resizePercent||0)) }
                      return { mode: 'original' }
                    })()}
                    w={220}
                    h={138}
                  />
                </div>
              )}
            </div>
          )}
          {/* 预计导出尺寸提示 */}
          <EstimatedSizeHint
            size={currSize}
            mode={resizeMode}
            widthVal={customWidth}
            heightVal={customHeight}
            percentVal={resizePercent}
          />
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>尺寸调整（可选）</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="resizeMode" checked={resizeMode==='original'} onChange={()=>setResizeMode('original')} />
                原始尺寸（不调整）
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="resizeMode" checked={resizeMode==='percent'} onChange={()=>setResizeMode('percent')} />
                按百分比（%）
                <input
                  type="number" min={1} step={1} value={resizePercent}
                  onChange={(e:any)=> { setResizePercent(Math.max(1, Math.round(Number(e.target.value)||0))); setResizeMode('percent') }}
                  style={{ width: 96 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="resizeMode" checked={resizeMode==='custom'} onChange={()=>setResizeMode('custom')} />
                自定义长宽（px）
                <input
                  type="number" min={0} step={1} placeholder="宽"
                  value={customWidth}
                  onChange={(e:any)=> { setCustomWidth(Math.max(0, Math.round(Number(e.target.value)||0))); setResizeMode('custom') }}
                  style={{ width: 86 }}
                />
                ×
                <input
                  type="number" min={0} step={1} placeholder="高"
                  value={customHeight}
                  onChange={(e:any)=> { setCustomHeight(Math.max(0, Math.round(Number(e.target.value)||0))); setResizeMode('custom') }}
                  style={{ width: 86 }}
                />
              </label>
              <div style={{ color:'#666', fontSize:12 }}>
                说明：
                - 百分比：基于原图尺寸等比缩放。
                - 自定义长宽：可同时填写宽和高；如仅填一边，则按原始宽高比自动推算另一边；填写 0 表示该边未指定。
              </div>
            </div>
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

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
