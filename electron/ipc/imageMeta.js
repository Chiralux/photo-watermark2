import sharp from 'sharp'
import { promises as fsp, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { getOrientedSize, formatExifDate, formatGpsDateTime, parseXmpForDate, parseDateFromFilename } from '../utils/exif.js'
import { readTemplateConfig } from '../utils/templates.js'
const require = createRequire(import.meta.url)
let exifReader; try { exifReader = require('exif-reader') } catch { exifReader = null }
let exifParser; try { exifParser = require('exif-parser') } catch { exifParser = null }
let exifr; try { exifr = require('exifr') } catch { exifr = null }

export function registerImageMetaIpc(ipcMain) {
  ipcMain.handle('image:getMetadata', async (_evt, inputPath) => {
    try {
      const meta = await sharp(inputPath).metadata()
      const { width, height } = meta
      const oriented = getOrientedSize(meta)
      let dateTaken = null
      let dateSource = null
      try {
        if (meta.exif && exifReader) {
          const ex = exifReader(meta.exif) || {}
          const exif = ex.exif || ex.Exif || ex
          const imageIfd = ex.image || ex.Image || {}
          const dt = (
            exif?.DateTimeOriginal ||
            exif?.DateTimeDigitized ||
            exif?.CreateDate ||
            imageIfd?.DateTime ||
            exif?.ModifyDate ||
            imageIfd?.ModifyDate
          )
          const f = formatExifDate(dt)
          if (f) { dateTaken = f; dateSource = 'exif' }
          if (!dateTaken) {
            const gps = ex.gps || ex.GPS || {}
            const gf = formatGpsDateTime(gps?.GPSDateStamp || gps?.DateStamp, gps?.GPSTimeStamp || gps?.TimeStamp)
            if (gf) { dateTaken = gf; dateSource = 'gps' }
          }
        }
        if (!dateTaken && exifParser) {
          try {
            const buf = meta.exif ? meta.exif : await fsp.readFile(inputPath)
            const parser = exifParser.create(buf)
            const res = parser.parse()
            const tags = res?.tags || {}
            const dt2 = (tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate ?? tags.DateTimeDigitized ?? null)
            const f2 = formatExifDate(dt2)
            if (f2) { dateTaken = f2; dateSource = 'exif' }
            if (!dateTaken) {
              const gf = formatGpsDateTime(tags.GPSDateStamp, tags.GPSTimeStamp)
              if (gf) { dateTaken = gf; dateSource = 'gps' }
            }
          } catch {}
        }
        if (!dateTaken && meta.exif) {
          try {
            const ascii = Buffer.from(meta.exif).toString('latin1')
            const tags = [
              /DateTimeOriginal[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
              /DateTimeDigitized[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
              /CreateDate[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
              /ModifyDate[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
              /DateTime[^0-9]*(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
            ]
            for (const re of tags) {
              const m = ascii.match(re)
              if (m) { dateTaken = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`; dateSource = 'exif'; break }
            }
          } catch {}
        }
        if (!dateTaken && meta.xmp) {
          const f = parseXmpForDate(meta.xmp)
          if (f) { dateTaken = f; dateSource = 'xmp' }
        }
        if (!dateTaken && exifr) {
          try {
            const out = await exifr.parse(inputPath, { tiff: true, ifd0: true, exif: true, gps: true, xmp: true })
            const dt = out?.DateTimeOriginal || out?.CreateDate || out?.ModifyDate || out?.DateTimeDigitized || out?.DateTime
            const f4 = formatExifDate(dt)
            if (f4) { dateTaken = f4; dateSource = 'exif' }
            if (!dateTaken) {
              const gf = formatGpsDateTime(out?.GPSDateStamp, out?.GPSTimeStamp)
              if (gf) { dateTaken = gf; dateSource = 'gps' }
            }
          } catch {}
        }
        if (!dateTaken) {
          try {
            const cfg = await readTemplateConfig()
            const useName = cfg?.metaFallback?.allowFilename !== false
            const useFile = cfg?.metaFallback?.allowFileTime === true
            if (useName && !dateTaken) {
              const f = parseDateFromFilename(inputPath)
              if (f) { dateTaken = f; dateSource = 'filename' }
            }
            if (useFile && !dateTaken) {
              try {
                const st = statSync(inputPath)
                if (st?.mtime) {
                  const f2 = formatExifDate(st.mtime)
                  if (f2) { dateTaken = f2; dateSource = 'filetime' }
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
      return { width: width || 0, height: height || 0, orientation: meta.orientation || 1, orientedWidth: oriented.width, orientedHeight: oriented.height, dateTaken, dateSource }
    } catch (e) {
      return { width: 0, height: 0, orientation: 1, orientedWidth: 0, orientedHeight: 0, dateTaken: null, dateSource: null }
    }
  })
}
