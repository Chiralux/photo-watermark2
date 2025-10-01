import React, { useEffect, useMemo, useRef, useState } from 'react'

export interface FontSelectProps {
  value: string
  onChange: (v: string) => void
  common: string[]
  others: string[]
  placeholder?: string
}

export const FontSelect: React.FC<FontSelectProps> = ({ value, onChange, common, others, placeholder = '系统默认' }) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (open) {
      // 聚焦搜索框
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
    }
  }, [open])

  const filter = query.trim().toLowerCase()
  const listCommon = useMemo(() => (filter ? common.filter(f => f.toLowerCase().includes(filter)) : common), [common, filter])
  const listOthers = useMemo(() => (filter ? others.filter(f => f.toLowerCase().includes(filter)) : others), [others, filter])

  const handlePick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div className="font-select" ref={wrapRef}>
      <button type="button" className="trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="trigger-text">{value || placeholder}</span>
        <svg className="chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="listbox">
          <input ref={inputRef} className="search" type="text" placeholder="搜索字体..." value={query} onChange={e => setQuery(e.target.value)} />
          <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
            <div className={`item${value === '' ? ' selected' : ''}`} onClick={() => handlePick('')} role="option" aria-selected={value === ''}>系统默认</div>
            {(!filter || listCommon.length > 0) && (
              <>
                {!filter && <div className="group">常用</div>}
                {listCommon.map(f => (
                  <div key={`c-${f}`} className={`item${value === f ? ' selected' : ''}`} onClick={() => handlePick(f)} role="option" aria-selected={value === f}>{f}</div>
                ))}
              </>
            )}
            {(!filter || listOthers.length > 0) && (
              <>
                {!filter && <div className="group">其它</div>}
                {listOthers.map(f => (
                  <div key={`o-${f}`} className={`item${value === f ? ' selected' : ''}`} onClick={() => handlePick(f)} role="option" aria-selected={value === f}>{f}</div>
                ))}
              </>
            )}
            {(filter && listCommon.length === 0 && listOthers.length === 0) && (
              <div className="empty">未匹配到字体</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
