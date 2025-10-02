import React, { useEffect, useState } from 'react'
import { Template, ResizeConfig } from '../types/template'

export function CompressedPreview({ template, imagePath, jpegQuality, resize, w, h, format = 'png' as 'png' | 'jpeg', paused = false }: {
  template: Template; imagePath: string; jpegQuality: number; resize?: ResizeConfig; w?: number; h?: number; format?: 'png' | 'jpeg'; paused?: boolean
}) {
  const W = Math.max(1, Math.round(w || 480)), H = Math.max(1, Math.round(h || 300))
  const [url, setUrl] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    const api = (window as any).api
    let stop = false
    // 若开始拖拽，立即取消当前任务
    if (paused && api?.preview?.cancel && (CompressedPreview as any)._lastJobId) {
      try { api.preview.cancel((CompressedPreview as any)._lastJobId) } catch {}
    }
    if (paused) return
    const jobId = `prev_${Date.now()}_${Math.random().toString(36).slice(2)}`
    ;(CompressedPreview as any)._lastJobId = jobId
    const timer = setTimeout(async () => {
      if (!imagePath || !api?.preview?.render) { setUrl(''); return }
      setLoading(true); setErr('')
      try {
        const res = await api.preview.render({ inputPath: imagePath, config: template, format, jpegQuality, resize, jobId })
        try {
          const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production'
          if (isDev && (res as any)?.debug) console.debug('[compressed-preview]', (res as any).debug)
        } catch {}
        if (!stop) {
          const u = res?.url || res?.dataUrl || ''
          if (res?.ok && u) setUrl(u)
          else { setUrl(''); setErr(res?.error || '预览失败') }
        }
      } catch (e:any) {
        if (!stop) { setUrl(''); setErr(String(e?.message || e)) }
      } finally {
        if (!stop) setLoading(false)
      }
    }, 200)
    return () => {
      stop = true
      clearTimeout(timer)
      // 取消后台进行中的任务
      if (api?.preview?.cancel) {
        try { api.preview.cancel(jobId) } catch {}
      }
    }
  }, [imagePath, template, jpegQuality, resize, format, paused])

  return (
    <div style={{ width: W, height: H, background: '#fff', border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {loading ? <div style={{ color: '#888', fontSize: 12 }}>预览生成中…</div> : (url ? <img src={url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <div style={{ color: '#888', fontSize: 12 }}>{err || '无 JPEG 预览'}</div>)}
    </div>
  )
}
