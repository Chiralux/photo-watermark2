import path from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'

export function listImages(paths) {
  const out = new Set()
  const exts = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'])
  for (const p of paths) {
    try {
      const st = statSync(p)
      if (st.isDirectory()) {
        walkDir(p, out, exts)
      } else if (st.isFile()) {
        const ext = path.extname(p).toLowerCase()
        if (exts.has(ext)) out.add(p)
      }
    } catch {}
  }
  return Array.from(out)
}

function walkDir(dir, out, exts) {
  try {
    const entries = readdirSync(dir)
    for (const name of entries) {
      const full = path.join(dir, name)
      try {
        const st = statSync(full)
        if (st.isDirectory()) walkDir(full, out, exts)
        else if (st.isFile()) {
          const ext = path.extname(full).toLowerCase()
          if (exts.has(ext)) out.add(full)
        }
      } catch {}
    }
  } catch {}
}

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}
