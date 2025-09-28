import path from 'node:path'
import { existsSync, mkdirSync, promises as fsp } from 'node:fs'
import { getTemplatesDir, sanitize, listTemplateNames, readTemplateConfig, writeTemplateConfig, normalizeTemplateConfig, normalizeMetaFallback } from '../utils/templates.js'

export function registerTemplatesIpc(ipcMain) {
  ipcMain.handle('template:list', async () => listTemplateNames())

  ipcMain.handle('template:load', async (_evt, name) => {
    const dir = getTemplatesDir()
    const p = path.join(dir, `${sanitize(name)}.json`)
    const txt = await fsp.readFile(p, 'utf-8')
    return JSON.parse(txt)
  })

  ipcMain.handle('template:save', async (_evt, { name, data }) => {
    const dir = getTemplatesDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const p = path.join(dir, `${sanitize(name)}.json`)
    await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('template:delete', async (_evt, name) => {
    try {
      const dir = getTemplatesDir()
      const s = sanitize(name)
      if (s === '_last' || s === '_config') return false
      const p = path.join(dir, `${s}.json`)
      await fsp.unlink(p)
      return true
    } catch { return false }
  })

  ipcMain.handle('template:loadLast', async () => {
    try {
      const p = path.join(getTemplatesDir(), `_last.json`)
      const txt = await fsp.readFile(p, 'utf-8')
      return JSON.parse(txt)
    } catch { return null }
  })

  ipcMain.handle('template:saveLast', async (_evt, data) => {
    const dir = getTemplatesDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const p = path.join(dir, `_last.json`)
    await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('template:getAutoLoadConfig', async () => {
    try { return await readTemplateConfig() } catch { return { autoLoad: 'last', defaultName: null } }
  })

  ipcMain.handle('template:setAutoLoadConfig', async (_evt, cfg) => {
    try { const normalized = normalizeTemplateConfig(cfg); await writeTemplateConfig(normalized); return true } catch { return false }
  })

  ipcMain.handle('meta:getFallbackConfig', async () => {
    try {
      const cfg = await readTemplateConfig()
      const metaFallback = cfg?.metaFallback || { allowFilename: true, allowFileTime: false }
      return metaFallback
    } catch { return { allowFilename: true, allowFileTime: false } }
  })

  ipcMain.handle('meta:setFallbackConfig', async (_evt, metaFallback) => {
    try {
      const cfg = await readTemplateConfig()
      const merged = { ...cfg, metaFallback: normalizeMetaFallback(metaFallback) }
      await writeTemplateConfig(merged)
      return true
    } catch { return false }
  })
}
