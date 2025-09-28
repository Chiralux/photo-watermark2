import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let fontList; try { fontList = require('font-list') } catch { fontList = null }
let fontScanner; try { fontScanner = require('font-scanner') } catch { fontScanner = null }

export function registerSystemFontsIpc(ipcMain) {
  ipcMain.handle('systemFonts:list', async () => {
    try {
      if (fontList && typeof fontList.getFonts === 'function') {
        const fonts = await fontList.getFonts()
        const families = Array.isArray(fonts) ? Array.from(new Set(fonts)).filter(Boolean).sort((a,b)=>a.localeCompare(b)) : []
        if (families.length) return families
      }
      if (fontScanner && typeof fontScanner.getAvailableFontsSync === 'function') {
        const fonts = fontScanner.getAvailableFontsSync()
        const families = Array.from(new Set(fonts.map(f => f.family))).filter(Boolean).sort((a,b)=>a.localeCompare(b))
        return families
      }
    } catch {}
    try {
      const dirs = []
      const pushIf = (p)=>{ try { if (existsSync(p)) dirs.push(p) } catch {} }
      if (process.platform === 'win32') {
        pushIf(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'))
      } else if (process.platform === 'darwin') {
        pushIf('/System/Library/Fonts'); pushIf('/Library/Fonts'); pushIf(path.join(os.homedir(), 'Library/Fonts'))
      } else {
        pushIf('/usr/share/fonts'); pushIf('/usr/local/share/fonts'); pushIf(path.join(os.homedir(), '.fonts'))
      }
      const families = new Set()
      const tryAdd = (name)=>{ if (!name) return; const fam = String(name).replace(/\.(ttf|otf|ttc)$/i,''); families.add(fam) }
      for (const d of dirs) {
        let list = []
        try { list = readdirSync(d) } catch { continue }
        for (const n of list) {
          if (/(\.(ttf|otf|ttc))$/i.test(n)) tryAdd(n)
        }
      }
      return Array.from(families).sort((a,b)=>a.localeCompare(b))
    } catch { return [] }
  })

  ipcMain.handle('systemFonts:styles', async () => {
    try {
      if (fontScanner && typeof fontScanner.getAvailableFontsSync === 'function') {
        const fonts = fontScanner.getAvailableFontsSync()
        const map = new Map()
        for (const f of fonts) {
          const fam = f?.family
          if (!fam) continue
          const style = String(f?.style || '').toLowerCase()
          const italicish = /italic|oblique/.test(style)
          if (!map.has(fam)) map.set(fam, { hasItalic: false, styles: new Set() })
          const ent = map.get(fam)
          if (italicish) ent.hasItalic = true
          ent.styles.add(f?.style || '')
        }
        const out = {}
        for (const [k, v] of map.entries()) out[k] = { hasItalic: !!v.hasItalic, styles: Array.from(v.styles) }
        return out
      }
    } catch {}
    return {}
  })
}
