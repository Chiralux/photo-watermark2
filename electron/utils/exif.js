import path from 'node:path'

export function getOrientedSize(meta) {
  const w = meta?.width || 1024
  const h = meta?.height || 768
  const ori = meta?.orientation
  if ([5,6,7,8].includes(ori)) return { width: h, height: w }
  return { width: w, height: h }
}

function pad2(n) { return String(n).padStart(2, '0') }

export function formatExifDate(dt) {
  try {
    if (!dt) return null
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      const y = dt.getFullYear()
      const m = pad2(dt.getMonth() + 1)
      const d = pad2(dt.getDate())
      const hh = pad2(dt.getHours())
      const mm = pad2(dt.getMinutes())
      const ss = pad2(dt.getSeconds())
      return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
    }
    const s = String(dt)
    const m = s.match(/(\d{4}):?(\d{2}):?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/)
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]}`
    return null
  } catch { return null }
}

export function formatGpsDateTime(gpsDate, gpsTime) {
  try {
    if (!gpsDate && !gpsTime) return null
    let y, m, d, hh = '00', mm = '00', ss = '00'
    if (gpsDate) {
      const s = String(gpsDate)
      const md = s.match(/(\d{4}):?(\d{2}):?(\d{2})/)
      if (!md) return null
      y = md[1]; m = md[2]; d = md[3]
    } else return null
    if (gpsTime !== undefined && gpsTime !== null) {
      if (Array.isArray(gpsTime)) {
        const pad = (v)=> String(Math.floor(Number(v)||0)).padStart(2,'0')
        hh = pad(gpsTime[0]); mm = pad(gpsTime[1]); ss = pad(gpsTime[2])
      } else {
        const st = String(gpsTime)
        const mt = st.match(/(\d{2}):(\d{2}):(\d{2})/)
        if (mt) { hh = mt[1]; mm = mt[2]; ss = mt[3] }
      }
    }
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
  } catch { return null }
}

export function parseXmpForDate(xmpBuf) {
  try {
    const txt = Buffer.isBuffer(xmpBuf) ? xmpBuf.toString('utf-8') : String(xmpBuf || '')
    const tryTags = [
      /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/i,
      /xmp:CreateDate=\"([^\"]+)\"/i,
      /<exif:DateTimeOriginal>([^<]+)<\/exif:DateTimeOriginal>/i,
      /exif:DateTimeOriginal=\"([^\"]+)\"/i,
      /<exif:DateTimeDigitized>([^<]+)<\/exif:DateTimeDigitized>/i,
      /<tiff:DateTime>([^<]+)<\/tiff:DateTime>/i,
      /<photoshop:DateCreated>([^<]+)<\/photoshop:DateCreated>/i,
      /<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/i,
    ]
    for (const re of tryTags) {
      const m = txt.match(re)
      if (m && m[1]) {
        const f = formatExifDate(m[1])
        if (f) return f
      }
    }
    const m2 = txt.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]}`
    const m3 = txt.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]} ${m3[4]}:${m3[5]}:${m3[6]}`
    return null
  } catch { return null }
}

export function parseDateFromFilename(p) {
  try {
    const base = path.basename(p)
    let m = base.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[ _T.,-]?(\d{2})[:_.\-]?(\d{2})[:_.\-]?(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    m = base.match(/(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    return null
  } catch { return null }
}
