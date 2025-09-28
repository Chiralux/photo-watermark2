import path from 'node:path'
import { app } from 'electron'
import { existsSync, mkdirSync, promises as fsp, readdirSync } from 'node:fs'

export function getTemplatesDir() {
  return path.join(app.getPath('userData'), 'templates')
}

export function getTemplatesConfigPath() {
  return path.join(getTemplatesDir(), '_config.json')
}

export function sanitize(name = 'template') {
  return String(name).replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 64) || 'template'
}

export async function readTemplateConfig() {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = getTemplatesConfigPath()
  try {
    const txt = await fsp.readFile(p, 'utf-8')
    const j = JSON.parse(txt)
    return normalizeTemplateConfig(j)
  } catch {
    return { autoLoad: 'last', defaultName: null }
  }
}

export function normalizeTemplateConfig(cfg) {
  const auto = (cfg?.autoLoad === 'default' || cfg?.autoLoad === 'last') ? cfg.autoLoad : 'last'
  const def = cfg?.defaultName ? String(cfg.defaultName).slice(0, 128) : null
  const metaFallback = normalizeMetaFallback(cfg?.metaFallback)
  return { autoLoad: auto, defaultName: def, metaFallback }
}

export async function writeTemplateConfig(cfg) {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = getTemplatesConfigPath()
  await fsp.writeFile(p, JSON.stringify(normalizeTemplateConfig(cfg), null, 2), 'utf-8')
}

export function normalizeMetaFallback(mf) {
  const allowFilename = mf?.allowFilename !== false
  const allowFileTime = mf?.allowFileTime === true
  return { allowFilename, allowFileTime }
}

export function buildOutputPath(inputPath, outputDir, naming, format) {
  const base = path.basename(inputPath)
  const ext = format === 'jpeg' ? '.jpg' : '.png'
  const nameNoExt = base.replace(/\.[^.]+$/, '')
  let name = nameNoExt
  const prefix = (naming && (naming.prefix !== undefined && naming.prefix !== null)) ? naming.prefix : 'wm_'
  if (prefix) name = `${prefix}${name}`
  if (naming?.suffix) name = `${name}${naming.suffix}`
  return path.join(outputDir, `${name}${ext}`)
}

export function listTemplateNames() {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const reserved = new Set(['_last.json', '_config.json'])
  const names = readdirSync(dir)
    .filter(n => n.endsWith('.json') && !reserved.has(n))
    .map(n => n.replace(/\.json$/, ''))
  return names
}
