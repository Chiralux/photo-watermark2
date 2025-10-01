import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Template, ResizeConfig, SavedTemplateFile, ExportSettings, NamingRule } from './types/template'
import { wrapFontFamily } from './utils/font'
import { CompressedPreview } from './components/CompressedPreview'
import { EstimatedSizeHint } from './components/EstimatedSizeHint'
import { PreviewBox } from './components/PreviewBox'
import { FontSelect } from './components/FontSelect'
import './styles/theme.css'

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
        load: (name: string) => Promise<SavedTemplateFile>
        save: (name: string, data: SavedTemplateFile) => Promise<boolean>
        delete: (name: string) => Promise<boolean>
        loadLast: () => Promise<SavedTemplateFile | null>
        saveLast: (data: SavedTemplateFile) => Promise<boolean>
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
  const [naming, setNaming] = useState<NamingRule>({ prefix: 'wm_', suffix: '_watermarked' })
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
  const [fontHasItalic, setFontHasItalic] = useState<boolean>(false)
  const [fontStylesMap, setFontStylesMap] = useState<Record<string, { hasItalic: boolean; styles: string[] }>>({})
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
  // 预览拖拽中：用于暂停压缩预览生成，避免拖动卡顿
  const [draggingPreview, setDraggingPreview] = useState<boolean>(false)
  // 冷却：左键按下后额外暂停 250ms，即便迅速松开也不立刻恢复
  const [cooldownActive, setCooldownActive] = useState<boolean>(false)
  const cooldownTimerRef = useRef<any>(null)

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
    layout: { preset: 'center', offsetX: 0, offsetY: 0, allowOverflow: true },
  })

  // 顶部模块切换：水印 / 布局 / 导出
  const [activeTab, setActiveTab] = useState<'watermark'|'layout'|'export'>('watermark')

  // 工具：根据当前 UI 状态构造可保存的模板文件对象
  const buildSavedTemplate = (): SavedTemplateFile => ({
    version: 1,
    template: tpl,
    export: {
      format,
      naming,
      jpegQuality,
      resize: ((): ResizeConfig => {
        if (resizeMode === 'custom') return { mode: 'custom', width: Math.max(0, Math.round(customWidth||0)) || undefined, height: Math.max(0, Math.round(customHeight||0)) || undefined }
        if (resizeMode === 'percent') return { mode: 'percent', percent: Math.max(1, Math.round(resizePercent||0)) }
        return { mode: 'original' }
      })(),
      enableCompressedPreview,
    }
  })

  // 工具：应用从磁盘读取的模板（兼容旧版仅有模板的 JSON）
  const applyLoadedTemplate = (loaded: SavedTemplateFile | Template | null | undefined) => {
    if (!loaded) return
    const isWrapped = typeof (loaded as any)?.template === 'object'
    if (isWrapped) {
      const obj = loaded as Exclude<SavedTemplateFile, Template>
      if (obj.template) setTpl(obj.template)
      const ex = obj.export || ({} as ExportSettings)
      if (ex.format === 'png' || ex.format === 'jpeg') setFormat(ex.format)
      if (ex.naming) setNaming({ prefix: ex.naming.prefix, suffix: ex.naming.suffix })
      if (typeof ex.jpegQuality === 'number' && Number.isFinite(ex.jpegQuality)) setJpegQuality(Math.max(0, Math.min(100, Math.round(ex.jpegQuality))))
      if (ex.resize) {
        const r = ex.resize
        if (r.mode === 'custom') {
          setResizeMode('custom')
          if (Number.isFinite(r.width!)) setCustomWidth(Math.max(0, Math.round(Number(r.width))))
          if (Number.isFinite(r.height!)) setCustomHeight(Math.max(0, Math.round(Number(r.height))))
        } else if (r.mode === 'percent') {
          setResizeMode('percent')
          if (Number.isFinite(r.percent!)) setResizePercent(Math.max(1, Math.round(Number(r.percent))))
        } else {
          setResizeMode('original')
        }
      }
      if (typeof ex.enableCompressedPreview === 'boolean') setEnableCompressedPreview(ex.enableCompressedPreview)
    } else {
      // 旧格式：直接就是 Template
      setTpl(loaded as Template)
    }
  }

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
  // 读取字体样式信息（是否包含 italic/oblique）
  try { const sm = await (window as any).api?.systemFonts?.styles?.(); if (sm && typeof sm === 'object') setFontStylesMap(sm) } catch {}

        // 读取元数据回退配置
        if ((window as any).api?.meta?.getFallbackConfig) {
          const mf = await (window as any).api.meta.getFallbackConfig().catch(()=>null)
          if (mf) setMetaFallback({ allowFilename: mf.allowFilename !== false, allowFileTime: mf.allowFileTime === true })
        }

        // 按配置加载模板
        if (cfg.autoLoad === 'default' && cfg.defaultName) {
          try {
            const t = await window.api.templates.load(cfg.defaultName)
            applyLoadedTemplate(t)
          } catch {
            // 回退到 last
            const last = await window.api.templates.loadLast()
            applyLoadedTemplate(last)
          }
        } else {
          const last = await window.api.templates.loadLast()
          applyLoadedTemplate(last)
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

  // 检测当前字体是否具备原生 italic 变体：优先用主进程返回的样式表，其次用 document.fonts.check 回退
  useEffect(() => {
    const fam = tpl.text?.fontFamily
    if (!fam) { setFontHasItalic(false); return }
    let has = false
    // 统一化名字做一些中文常见字体的强制判断
    const f = fam.toLowerCase()
    const forceNoItalic = (() => {
      // 包含这些关键字的家族几乎不提供原生斜体
      const noItalSubstr = ['simsun', 'nsimsun', 'simhei', 'microsoft yahei', '微软雅黑', '宋体', '黑体', 'pingfang', 'noto sans cjk sc', 'noto sans sc', 'source han sans', '思源黑体', 'wenquanyi', 'dengxian', '等线']
      return noItalSubstr.some(k => f.includes(k))
    })()
    if (forceNoItalic) { setFontHasItalic(false); return }
    // 主进程字体扫描优先
    if (fontStylesMap && fontStylesMap[fam]) {
      has = !!fontStylesMap[fam].hasItalic
    } else {
      // 英文字体的正面白名单
      const knownHasItalic = new Set(['Arial','Times New Roman','Georgia','Helvetica','Courier New','Consolas','Segoe UI'])
      if (knownHasItalic.has(fam)) has = true
      else has = false
    }
    setFontHasItalic(has)
  }, [tpl.text?.fontFamily, fontStylesMap])

  // 根据字体是否有斜体，联动当前样式：
  // - 若无斜体且当前为 fontStyle=italic，则切回 normal 并启用仿斜；
  // - 若有斜体且当前启用了仿斜，则关闭仿斜并切换到 fontStyle=italic。
  useEffect(() => {
    setTpl(prev => {
      const has = fontHasItalic
      const t = prev.text || {} as any
      // 复制，避免引用同一对象
      const nextText = { ...t }
      let changed = false
      if (!has) {
        if (nextText.fontStyle === 'italic') {
          nextText.fontStyle = 'normal'
          nextText.italicSynthetic = true
          if (nextText.italicSkewDeg === undefined || nextText.italicSkewDeg === null) nextText.italicSkewDeg = 12
          changed = true
        }
      } else {
        if (nextText.italicSynthetic) {
          nextText.italicSynthetic = false
          nextText.fontStyle = 'italic'
          changed = true
        }
      }
      return changed ? { ...prev, text: nextText } : prev
    })
  }, [fontHasItalic])

  // 模板或导出相关设置变更时自动保存（带导出设置）
  useEffect(() => {
    const id = setTimeout(() => {
      window.api.templates.saveLast(buildSavedTemplate()).catch(() => {})
    }, 200)
    return () => clearTimeout(id)
  }, [tpl, format, naming?.prefix, naming?.suffix, jpegQuality, resizeMode, customWidth, customHeight, resizePercent, enableCompressedPreview])

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
      <aside className="sidebar-left">
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">文件</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onImport}>导入图片</button>
            <button className="btn" onClick={async ()=>{ if(!(window as any).api){alert('预加载未生效');return} const list = await window.api.openDirectory(); if(list?.length) appendFiles(list)}}>导入文件夹</button>
          </div>
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">文件列表</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">自动加载</div>
          <div className="form labels-left auto-label tiny-gap" style={{ marginBottom: 8 }}>
            <div className="form-row">
              <label className="left">模式</label>
              <div className="control">
    <label className="row-inline"><input type="radio" name="autoload" checked={autoLoad==='last'} onChange={()=>setAutoLoad('last')} /> 上次退出时设置</label>
                <label className="row-inline"><input type="radio" name="autoload" checked={autoLoad==='default'} onChange={()=>setAutoLoad('default')} /> 默认模板</label>
              </div>
            </div>
            {autoLoad === 'default' ? (
              <div className="form-row">
                <label className="left">默认模板</label>
                <div className="control">
                  <select value={defaultTplName} onChange={(e:any)=>setDefaultTplName(e.target.value)}>
                    <option value="">（未选择）</option>
                    {tplList.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button className="btn" onClick={async ()=>{
                    const ok = await window.api.templates.setAutoLoadConfig({ autoLoad, defaultName: defaultTplName || null })
                    if (!ok) { alert('保存失败'); return }
                    alert('自动加载设置已保存')
                  }}>保存</button>
                </div>
              </div>
            ) : (
              <div className="form-row">
                <label />
                <div className="control">
                  <button className="btn" onClick={async ()=>{
                    const ok = await window.api.templates.setAutoLoadConfig({ autoLoad, defaultName: null })
                    if (!ok) { alert('保存失败'); return }
                    alert('自动加载设置已保存')
                  }}>保存</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">拍摄时间回退</div>
          <div className="form labels-left auto-label tiny-gap">
            <div className="form-row">
              <label className="left">文件名兜底</label>
              <div className="control">
                <label className="row-inline">
                  <input type="checkbox" checked={metaFallback.allowFilename} onChange={async (e:any)=>{
                    const next = { ...metaFallback, allowFilename: !!e.target.checked }
                    setMetaFallback(next)
                    try { await (window as any).api?.meta?.setFallbackConfig?.(next) } catch {}
                  }} />
                  <span className="muted">允许从文件名推断时间（如 20250113_141523）</span>
                </label>
              </div>
            </div>
            <div className="form-row">
              <label className="left">修改时间兜底</label>
              <div className="control">
                <label className="row-inline">
                  <input type="checkbox" checked={metaFallback.allowFileTime} onChange={async (e:any)=>{
                    const next = { ...metaFallback, allowFileTime: !!e.target.checked }
                    setMetaFallback(next)
                    try { await (window as any).api?.meta?.setFallbackConfig?.(next) } catch {}
                  }} />
                  <span className="muted">允许用文件修改时间作为兜底（可能不是拍摄时间）</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">保存模板</div>
          <div className="form labels-left auto-label tiny-gap">
            <div className="form-row">
              <label className="left">模板名</label>
              <div className="control">
                <input placeholder="输入模板名" value={tplName} onChange={(e:any)=>setTplName(e.target.value)} />
                <button className="btn" onClick={async ()=>{
                  const name = tplName.trim()
                  if (!name) { alert('请输入模板名'); return }
                  await window.api.templates.save(name, buildSavedTemplate())
                  setTplName('')
                  const names = await window.api.templates.list().catch(()=>[])
                  setTplList(Array.isArray(names)? names : [])
                  // 也把当前配置设为最近一次
                  await window.api.templates.saveLast(buildSavedTemplate())
                  alert('模板已保存')
                }}>保存</button>
              </div>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">模板列表</div>
          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {tplList.length? tplList.map(n => (
                 <li key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid #f2f2f2' }}>
                   <span>{n}</span>
                   <span style={{ display: 'inline-flex', gap: 6 }}>
                     <button className="btn sm outline-primary" title="加载此模板" onClick={async ()=>{
                    try {
                      const t = await window.api.templates.load(n)
                      applyLoadedTemplate(t)
                      await window.api.templates.saveLast(t)
                    } catch { alert('加载模板失败') }
                     }}>
                       <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                         <path d="M12 5v14M5 12h14" />
                       </svg>
                       <span style={{ marginLeft: 6 }}>加载</span>
                     </button>
                     <button className="btn sm outline-danger" title={`删除模板 “${n}”`} onClick={async ()=>{
                    const ok = confirm(`删除模板 “${n}”？`)
                    if (!ok) return
                    const ok2 = await window.api.templates.delete(n)
                    if (!ok2) { alert('删除失败'); return }
                    const names = await window.api.templates.list().catch(()=>[])
                    setTplList(Array.isArray(names)? names : [])
                    // 若删除的是当前默认模板，清空选择
                    if (n === defaultTplName) setDefaultTplName('')
                     }}>
                       <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                         <polyline points="3 6 5 6 21 6" />
                         <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                         <path d="M10 11v6M14 11v6" />
                         <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                       </svg>
                       <span style={{ marginLeft: 6 }}>删除</span>
                     </button>
                </span>
              </li>
            )) : (
              <li style={{ padding: 8, color: '#888' }}>暂无模板</li>
            )}
            </ul>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex' }}>
        <section style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f7' }}>
          {files.length ? (
            <div>
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
                  onDraggingChange={(v:boolean)=>{
                    if (v) {
                      setDraggingPreview(true)
                      setCooldownActive(true)
                      if (cooldownTimerRef.current) { clearTimeout(cooldownTimerRef.current); cooldownTimerRef.current = null }
                      cooldownTimerRef.current = setTimeout(() => { setCooldownActive(false); cooldownTimerRef.current = null }, 250)
                    } else {
                      setDraggingPreview(false)
                      // 不清除 cooldown：由定时器自然归零，保证“按下后 0.25s 内”都暂停
                    }
                  }}
                />
              </div>
              <div style={{ height: 8 }} />
              <div style={{ width: 480, height: 300 }}>
                <CompressedPreview
                  template={tpl}
                  imagePath={files[selected]}
                  jpegQuality={jpegQuality}
                  resize={((): ResizeConfig => {
                    if (resizeMode === 'custom') return { mode: 'custom', width: Math.max(0, Math.round(customWidth||0)) || undefined, height: Math.max(0, Math.round(customHeight||0)) || undefined }
                    if (resizeMode === 'percent') return { mode: 'percent', percent: Math.max(1, Math.round(resizePercent||0)) }
                    return { mode: 'original' }
                  })()}
                  format={format === 'jpeg' && enableCompressedPreview ? 'jpeg' : 'png'}
                  w={480}
                  h={300}
                  paused={draggingPreview || cooldownActive}
                />
              </div>
            </div>
          ) : (
            <div style={{ color: '#999' }}>请导入图片或拖拽图片/文件夹到窗口</div>
          )}
        </section>
        <section className="sidebar">
          {/* 顶部模块分栏 */}
          <div className="segmented" style={{ marginBottom: 10, width: '100%' }}>
            <button className={activeTab==='watermark' ? 'active' : ''} onClick={()=> setActiveTab('watermark')}>水印</button>
            <button className={activeTab==='layout' ? 'active' : ''} onClick={()=> setActiveTab('layout')}>布局</button>
            <button className={activeTab==='export' ? 'active' : ''} onClick={()=> setActiveTab('export')}>导出</button>
          </div>

          {activeTab === 'watermark' && (
            <div className="panel">
              <div className="panel-title">水印</div>
              <div className="segmented" style={{ marginBottom: 8 }}>
              <button
                className={tpl.type==='text' ? 'active' : ''}
                onClick={() => setTpl({ ...tpl, type: 'text' })}
              >文本</button>
              <button
                className={tpl.type==='image' ? 'active' : ''}
                onClick={() => setTpl({ ...tpl, type: 'image', image: { path: '', opacity: 0.6, scale: 1 } })}
              >图片</button>
              </div>

          {tpl.type === 'text' && (
            <div className="text-watermark" style={{ marginTop: 8 }}>
              {/* 文本内容 */}
              <div className="panel">
                <div className="panel-title">内容</div>
                <div className="form labels-left">
                  <div className="form-row">
                    <div className="input-group" style={{ width: '100%', gridColumn: '1 / span 2' }}>
                      <textarea value={tpl.text?.content || ''} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, content: e.target.value } })} />
                      <button className="btn icon" disabled={!currMeta?.dateTaken} title={currMeta?.dateTaken || '未检索到时间信息'} onClick={() => {
                        const dt = currMeta?.dateTaken
                        if (!dt) return
                        setTpl(prev => ({ ...prev, text: { ...prev.text!, content: dt } }))
                      }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="help">拍摄时间可快捷填充（若已读取到元数据）。</div>
              </div>
              {/* 旋转设置（统一表单样式） */}
              <div className="panel" style={{ marginTop: 8 }}>
                <div className="panel-title">旋转</div>
                <div className="form auto-label tiny-gap">
                  <div className="form-row">
                    <label className="left">角度</label>
                    <div className="control" style={{ width: '100%', minWidth: 0 }}>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={tpl.text?.rotation ?? 0}
                        onChange={e => setTpl({ ...tpl, text: { ...tpl.text!, rotation: Number(e.target.value) } })}
                        style={{ flex: 1 }}
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={tpl.text?.rotation ?? 0}
                        onChange={e => setTpl({ ...tpl, text: { ...tpl.text!, rotation: Number(e.target.value) } })}
                        style={{ width: 56 }}
                      />
                      <span className="unit">°</span>
                    </div>
                  </div>
                </div>
                <div className="panel-sub">支持任意角度旋转：正值顺时针，负值逆时针。</div>
              </div>
              <div className="panel" style={{ marginTop: 8 }}>
                <div className="panel-title">字体与样式</div>
                <div className="form labels-left auto-label tiny-gap uniform-fields">
                  <div className="form-row">
                    <label>字体</label>
                    <div className="control" style={{ width: '100%' }}>
                      <FontSelect
                        value={tpl.text?.fontFamily || ''}
                        onChange={(v)=> setTpl({ ...tpl, text: { ...tpl.text!, fontFamily: v } })}
                        common={fontListCommon}
                        others={fontListOthers}
                      />
                      {!!tpl.text?.fontFamily && (
                        <span className="help" style={{ color: fontAvailable? '#2a7' : '#d77' }}>
                          {fontAvailable ? '已加载' : '未检测到该字体（可能回退默认）'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label>字号</label>
                    <div className="control">
                      <input type="number" value={tpl.text?.fontSize || 32} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, fontSize: Number(e.target.value) } })} />
                      <span className="unit">px</span>
                    </div>
                  </div>
                  <div className="form-row">
                    <label>粗细</label>
                    <div className="control">
                      <label className="row-inline"><input type="checkbox" checked={(tpl.text?.fontWeight||'normal')!=='normal'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, fontWeight: e.target.checked ? 'bold' : 'normal' } })} /> 粗体</label>
                      {fontHasItalic ? (
                        <label className="row-inline"><input type="checkbox" checked={(tpl.text?.fontStyle||'normal')==='italic'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, fontStyle: e.target.checked ? 'italic' : 'normal' } })} /> 斜体</label>
                      ) : (
                        <>
                          <label className="row-inline" title="所选字体没有原生 italic 变体，开启仿斜以获得类似效果。">
                            <input type="checkbox" checked={!!tpl.text?.italicSynthetic} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, italicSynthetic: !!e.target.checked } })} /> 仿斜
                          </label>
                          {tpl.text?.italicSynthetic && (
                            <div className="control">
                              <input className="input-xxs" type="number" step={1} value={tpl.text?.italicSkewDeg ?? 12} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, italicSkewDeg: Number(e.target.value) } })} />
                              <span className="unit">°</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label>不透明度</label>
                    <div className="control">
                      <input type="number" min={0} max={1} step={0.05} value={tpl.text?.opacity ?? 0.6} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, opacity: Number(e.target.value) } })} />
                    </div>
                  </div>
                  <div className="form-row">
                    <label>颜色</label>
                    <div className="control">
                      <input type="color" value={tpl.text?.color || '#ffffff'} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, color: e.target.value } })} />
                    </div>
                  </div>
                  <div className="form-row">
                    <label>基线微调</label>
                    <div className="control">
                      <input type="number" step={1} value={tpl.text?.baselineAdjust ?? 0} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, baselineAdjust: Number(e.target.value) } })} />
                      <span className="unit">px</span>
                    </div>
                  </div>
                  <div className="form-row">
                    <label>水平微调</label>
                    <div className="control">
                      <input type="number" step={1} value={tpl.text?.baselineAdjustX ?? 0} onChange={(e: any) => setTpl({ ...tpl, text: { ...tpl.text!, baselineAdjustX: Number(e.target.value) } })} />
                      <span className="unit">px</span>
                    </div>
                  </div>
                </div>
                <div className="help">微调仅影响导出位置，不改变预览位置；单位为预览像素（导出时会按比例换算）。</div>
              </div>
              {/* 内置搜索下拉已提供筛选，这里不再额外展示匹配结果面板 */}
              {/* 移除面板外的重复内联控件，不透明度等均已纳入“字体与样式”表单 */}
              {/* 描边设置 */}
              <div className="panel" style={{ marginTop: 8 }}>
                <div className="panel-title">描边</div>
                <div className="form labels-left auto-label tiny-gap uniform-fields">
                  <div className="form-row">
                    <label>启用</label>
                    <div className="control">
                      <input type="checkbox" checked={!!tpl.text?.outline?.enabled} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), enabled: !!e.target.checked } } })} />
                    </div>
                  </div>
                  {tpl.text?.outline?.enabled && (
                    <>
                      <div className="form-row">
                        <label>颜色</label>
                        <div className="control"><input type="color" value={tpl.text?.outline?.color || '#000000'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), color: e.target.value } } })} /></div>
                      </div>
                      <div className="form-row">
                        <label>宽度</label>
                        <div className="control"><input type="number" min={0} step={1} value={tpl.text?.outline?.width ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), width: Math.max(0, Math.round(Number(e.target.value)||0)) } } })} /> <span className="unit">px</span></div>
                      </div>
                      <div className="form-row">
                        <label>不透明度</label>
                        <div className="control"><input type="number" min={0} max={1} step={0.05} value={tpl.text?.outline?.opacity ?? 0.25} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, outline: { ...(tpl.text?.outline||{}), opacity: Math.max(0, Math.min(1, Number(e.target.value)||0)) } } })} /></div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* 阴影设置 */}
              <div className="panel" style={{ marginTop: 8 }}>
                <div className="panel-title">阴影</div>
                <div className="form labels-left auto-label tiny-gap uniform-fields">
                  <div className="form-row">
                    <label>启用</label>
                    <div className="control">
                      <input type="checkbox" checked={!!tpl.text?.shadow?.enabled} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), enabled: !!e.target.checked } } })} />
                    </div>
                  </div>
                  {tpl.text?.shadow?.enabled && (
                    <>
                      <div className="form-row">
                        <label>颜色</label>
                        <div className="control"><input type="color" value={tpl.text?.shadow?.color || '#000000'} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), color: e.target.value } } })} /></div>
                      </div>
                      <div className="form-row">
                        <label>不透明度</label>
                        <div className="control"><input type="number" min={0} max={1} step={0.05} value={tpl.text?.shadow?.opacity ?? 0.3} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), opacity: Math.max(0, Math.min(1, Number(e.target.value)||0)) } } })} /></div>
                      </div>
                      <div className="form-row">
                        <label>偏移 X</label>
                        <div className="control"><input type="number" step={1} value={tpl.text?.shadow?.offsetX ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), offsetX: Math.round(Number(e.target.value)||0) } } })} /> <span className="unit">px</span></div>
                      </div>
                      <div className="form-row">
                        <label>偏移 Y</label>
                        <div className="control"><input type="number" step={1} value={tpl.text?.shadow?.offsetY ?? 1} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), offsetY: Math.round(Number(e.target.value)||0) } } })} /> <span className="unit">px</span></div>
                      </div>
                      <div className="form-row">
                        <label>模糊</label>
                        <div className="control"><input type="number" min={0} step={1} value={tpl.text?.shadow?.blur ?? 2} onChange={(e:any)=> setTpl({ ...tpl, text: { ...tpl.text!, shadow: { ...(tpl.text?.shadow||{}), blur: Math.max(0, Math.round(Number(e.target.value)||0)) } } })} /> <span className="unit">px</span></div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {tpl.type === 'image' && (
            <div className="panel" style={{ marginTop: 8 }}>
              <div className="panel-title">图片水印</div>
              <div className="form labels-left auto-label tiny-gap uniform-fields">
                <div className="form-row">
                  <label>操作</label>
                  <div className="control">
                    <button className="btn"
                      onClick={async ()=>{
                        if (!hasApi()) { alert('预加载未生效：无法访问系统文件对话框。'); return }
                        const paths = await window.api.openFiles()
                        const p = Array.isArray(paths) && paths[0] ? paths[0] : ''
                        if (!p) return
                        setTpl(prev => ({ ...prev, type: 'image', image: { ...(prev.image||{}), path: p, opacity: prev.image?.opacity ?? 0.6, scale: prev.image?.scale ?? 1, scaleMode: prev.image?.scaleMode || 'proportional', scaleX: prev.image?.scaleX ?? 1, scaleY: prev.image?.scaleY ?? 1 } }))
                      }}
                    >选择图片...</button>
                    <button className="btn" onClick={()=> setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: '' } }))} disabled={!tpl.image?.path}>清除</button>
                  </div>
                </div>
                <div className="form-row">
                  <label>预览</label>
                  <div className="control" style={{ width: '100%', minWidth: 0 }}>
                    {tpl.image?.path ? (
                      <>
                        <div style={{ width: 48, height: 48, border: '1px solid #eee', borderRadius: 4, overflow: 'hidden', background: '#f3f3f3' }}>
                          <img
                            src={tpl.image.path.startsWith('file:')? tpl.image.path : ('file:///' + encodeURI(tpl.image.path.replace(/\\/g,'/')))}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', imageOrientation: 'from-image' as any }}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, color: '#555' }} title={tpl.image.path}>
                          {(tpl.image.path.split(/\\/).pop())}
                        </div>
                      </>
                    ) : (
                      <span className="help">未选择图片。建议使用带透明通道的 PNG 作为水印 Logo。</span>
                    )}
                  </div>
                </div>
                <div className="form-row">
                  <label>旋转</label>
                  <div className="control" style={{ width: '100%' }}>
                    <input type="range" min={-180} max={180} step={1}
                      value={tpl.image?.rotation ?? 0}
                      onChange={e => setTpl(prev => ({
                        ...prev,
                        image: { ...(prev.image||{}), path: prev.image?.path || '', rotation: Number(e.target.value) }
                      }))}
                      style={{ flex: 1 }} />
                    <input className="input-xs" type="number" min={-180} max={180} step={1}
                      value={tpl.image?.rotation ?? 0}
                      onChange={e => setTpl(prev => ({
                        ...prev,
                        image: { ...(prev.image||{}), path: prev.image?.path || '', rotation: Number(e.target.value) }
                      }))} />
                    <span className="unit">°</span>
                  </div>
                </div>
                <div className="form-row">
                  <label>缩放模式</label>
                  <div className="control">
                    <label className="row-inline"><input type="radio" name="imgScaleMode" checked={(tpl.image?.scaleMode||'proportional')==='proportional'} onChange={()=> setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scaleMode: 'proportional' } }))} /> 等比</label>
                    <label className="row-inline"><input type="radio" name="imgScaleMode" checked={(tpl.image?.scaleMode||'proportional')==='free'} onChange={()=> setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scaleMode: 'free' } }))} /> 自由</label>
                  </div>
                </div>
                {(tpl.image?.scaleMode||'proportional') === 'proportional' ? (
                  <div className="form-row">
                    <label>缩放</label>
                    <div className="control" style={{ width: '100%' }}>
                      <input type="range" min={1} max={400} step={1}
                        value={Math.max(1, Math.round((tpl.image?.scale ?? 1) * 100))}
                        onChange={(e:any)=>{
                          const pct = Math.max(1, Math.round(Number(e.target.value)||0))
                          setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scale: pct/100 } }))
                        }} style={{ flex: 1 }} />
                      <input className="input-xs" type="number" min={1} max={1000} step={1}
                        value={Math.max(1, Math.round((tpl.image?.scale ?? 1) * 100))}
                        onChange={(e:any)=>{
                          const pct = Math.max(1, Math.round(Number(e.target.value)||0))
                          setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scale: pct/100 } }))
                        }} />
                      <span className="unit">%</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="form-row">
                      <label>宽度</label>
                      <div className="control"><input type="number" min={1} max={1000} step={1}
                        value={Math.max(1, Math.round((tpl.image?.scaleX ?? 1) * 100))}
                        onChange={(e:any)=>{
                          const pct = Math.max(1, Math.round(Number(e.target.value)||0))
                          setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scaleMode: 'free', scaleX: pct/100 } }))
                        }} /> <span className="unit">%</span></div>
                    </div>
                    <div className="form-row">
                      <label>高度</label>
                      <div className="control"><input type="number" min={1} max={1000} step={1}
                        value={Math.max(1, Math.round((tpl.image?.scaleY ?? 1) * 100))}
                        onChange={(e:any)=>{
                          const pct = Math.max(1, Math.round(Number(e.target.value)||0))
                          setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', scaleMode: 'free', scaleY: pct/100 } }))
                        }} /> <span className="unit">%</span></div>
                    </div>
                  </>
                )}
                <div className="form-row">
                  <label>不透明度</label>
                  <div className="control" style={{ width: '100%' }}>
                    <input type="range" min={0} max={100} step={1}
                      value={Math.round(((tpl.image?.opacity ?? 0.6) * 100))}
                      onChange={(e:any)=>{
                        const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value)||0)))
                        setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', opacity: v/100 } }))
                      }} style={{ flex: 1 }} />
                    <input className="input-xs" type="number" min={0} max={100} step={1}
                      value={Math.round(((tpl.image?.opacity ?? 0.6) * 100))}
                      onChange={(e:any)=>{
                        const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value)||0)))
                        setTpl(prev => ({ ...prev, image: { ...(prev.image||{}), path: prev.image?.path || '', opacity: v/100 } }))
                      }} />
                    <span className="unit">%</span>
                  </div>
                </div>
              </div>
              <div className="help">旋转支持正负角度；缩放支持等比或自由宽高；不透明度单位为 %。</div>
            </div>
          )}
          </div>
          )}

          {activeTab === 'layout' && (
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">布局</div>
            <div className="grid-3x3" style={{ marginBottom: 8 }}>
              {presets.map(p => (
                <button
                  key={p.key}
                  className={`cell ${tpl.layout.preset===p.key ? 'active' : ''}`}
                  onClick={() => setTpl({ ...tpl, layout: { ...tpl.layout, preset: p.key, offsetX: 0, offsetY: 0 } })}
                  title={p.label}
                />
              ))}
            </div>
            <div className="form labels-left controls-left auto-label tiny-gap uniform-fields">
              <div className="form-row">
                <label>X 偏移</label>
                <div className="control">
                  <input className="input-xs" type="number" value={tpl.layout.offsetX || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetX: Number(e.target.value) } })} />
                  <span className="unit">px</span>
                </div>
              </div>
              <div className="form-row">
                <label>Y 偏移</label>
                <div className="control">
                  <input className="input-xs" type="number" value={tpl.layout.offsetY || 0} onChange={(e: any) => setTpl({ ...tpl, layout: { ...tpl.layout, offsetY: Number(e.target.value) } })} />
                  <span className="unit">px</span>
                </div>
              </div>
              <div className="form-row">
                {/* 越界显示：默认已开启，控件移除 */}
              </div>
            </div>
          </div>
          )}

          {activeTab === 'export' && (
          <>
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-title">导出</div>
            <div className="form labels-left auto-label tiny-gap uniform-fields">
              <div className="form-row">
                <label>格式</label>
                <div className="control">
                  <label className="row-inline"><input type="radio" checked={format==='png'} onChange={() => setFormat('png')} /> PNG</label>
                  <label className="row-inline"><input type="radio" checked={format==='jpeg'} onChange={() => setFormat('jpeg')} /> JPEG</label>
                </div>
              </div>
              {format === 'jpeg' && (
                <>
                  <div className="form-row">
                    <label>JPEG 质量</label>
                    <div className="control" style={{ width: '100%' }}>
                      <input type="range" min={0} max={100} step={1} value={jpegQuality}
                        onChange={(e:any)=> setJpegQuality(Number(e.target.value)||0)} style={{ flex: 1 }} />
                      <input className="input-xs" type="number" min={0} max={100} value={jpegQuality}
                        onChange={(e:any)=> setJpegQuality(Math.max(0, Math.min(100, Number(e.target.value)||0)))} />
                    </div>
                  </div>
                  <div className="form-row">
                    <label>压缩预览</label>
                    <div className="control">
                      <label className="row-inline">
                        <input type="checkbox" checked={enableCompressedPreview} onChange={(e:any)=> setEnableCompressedPreview(!!e.target.checked)} />
                        <span className="muted">在预览中模拟 JPEG 质量</span>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* 已统一为底部主预览（根据勾选切换 PNG/JPEG），移除此处小尺寸压缩预览以避免重复 */}
          </div>
          {/* 预计导出尺寸提示 */}
          <EstimatedSizeHint
            size={currSize}
            mode={resizeMode}
            widthVal={customWidth}
            heightVal={customHeight}
            percentVal={resizePercent}
          />
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">尺寸调整</div>
            <div className="form labels-left controls-left auto-label gap-20 uniform-fields resize-form">
              <div className="form-row">
                <label className="left">模式</label>
                <div className="control">
                  <label className="row-inline"><input type="radio" name="resizeMode" checked={resizeMode==='original'} onChange={()=>setResizeMode('original')} /> 原始尺寸</label>
                  <label className="row-inline"><input type="radio" name="resizeMode" checked={resizeMode==='percent'} onChange={()=>setResizeMode('percent')} /> 百分比</label>
                  <label className="row-inline"><input type="radio" name="resizeMode" checked={resizeMode==='custom'} onChange={()=>setResizeMode('custom')} /> 自定义</label>
                </div>
              </div>
              {resizeMode==='percent' && (
                <div className="form-row">
                  <label>比例</label>
                  <div className="control"><input className="input-sm" type="number" min={1} step={1} value={resizePercent}
                    onChange={(e:any)=> { setResizePercent(Math.max(1, Math.round(Number(e.target.value)||0))); setResizeMode('percent') }} /> <span className="unit">%</span></div>
                </div>
              )}
              {resizeMode==='custom' && (
                <>
                  <div className="form-row">
                    <label className="left">宽度</label>
                    <div className="control"><input className="input-sm" type="number" min={0} step={1} value={customWidth}
                      onChange={(e:any)=> { setCustomWidth(Math.max(0, Math.round(Number(e.target.value)||0))); setResizeMode('custom') }} /> <span className="unit">px</span></div>
                  </div>
                  <div className="form-row">
                    <label className="left">高度</label>
                    <div className="control"><input className="input-sm" type="number" min={0} step={1} value={customHeight}
                      onChange={(e:any)=> { setCustomHeight(Math.max(0, Math.round(Number(e.target.value)||0))); setResizeMode('custom') }} /> <span className="unit">px</span></div>
                  </div>
                </>
              )}
            </div>
            <div className="panel-sub">说明：百分比基于原图尺寸等比缩放；自定义长宽可填一边按原始宽高比推算，填 0 表示未指定。</div>
          </div>
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-title">命名与导出</div>
            <div className="form labels-left controls-left auto-label micro-gap uniform-fields">
              <div className="form-row">
                <label className="left">导出范围</label>
                <div className="control">
                  <label className="row-inline">
                    <input type="radio" name="exportScope" checked={exportScope==='current'} onChange={() => setExportScope('current')} /> 仅当前预览
                  </label>
                  <label className="row-inline">
                    <input type="radio" name="exportScope" checked={exportScope==='all'} onChange={() => setExportScope('all')} /> 列表全部
                  </label>
                </div>
              </div>
              <div className="form-row">
                <label className="left">前缀</label>
                <div className="control">
                  <input type="text" value={naming.prefix || ''} onChange={(e: any) => setNaming({ ...naming, prefix: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <label className="left">后缀</label>
                <div className="control">
                  <input type="text" value={naming.suffix || ''} onChange={(e: any) => setNaming({ ...naming, suffix: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <label className="left">导出目录</label>
                <div className="control wrap">
                  <button className="btn sm" onClick={onSelectOutput}>选择导出文件夹</button>
                  <div style={{ color: '#666', wordBreak: 'break-all' }}>{outputDir || '未选择'}</div>
                </div>
              </div>
              <div className="form-row">
                <label />
                <div className="control">
                  <button className="btn primary" onClick={onExport} disabled={!files.length || !outputDir}>开始导出</button>
                </div>
              </div>
            </div>
          </div>
          </>
          )}
        </section>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
