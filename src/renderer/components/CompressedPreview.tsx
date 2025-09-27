import React, { useEffect, useState } from 'react'
import { Template, ResizeConfig } from '../types/template'

export function CompressedPreview({ template, imagePath, jpegQuality, resize, w, h }: {
  template: Template; imagePath: string; jpegQuality: number; resize?: ResizeConfig; w?: number; h?: number
}) {
  const W = Math.max(1, Math.round(w || 480)), H = Math.max(1, Math.round(h || 300))
  const [url, setUrl] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    let stop = false
    const timer = setTimeout(async () => {
      const api = (window as any).api
      if (!imagePath || !api?.preview?.render) { setUrl(''); return }
      setLoading(true); setErr('')
      try {
        const res = await api.preview.render({ inputPath: imagePath, config: template, format: 'jpeg', jpegQuality, resize })
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
    return () => { stop = true; clearTimeout(timer) }
  }, [imagePath, template, jpegQuality, resize])

  return (
    <div style={{ width: W, height: H, background: '#fff', border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {loading ? <div style={{ color: '#888', fontSize: 12 }}>JPEG 预览生成中…</div> : (url ? <img src={url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <div style={{ color: '#888', fontSize: 12 }}>{err || '无 JPEG 预览'}</div>)}
    </div>
  )
}
