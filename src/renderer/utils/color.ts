// 颜色工具：#RGB/#RRGGBB -> rgba(r,g,b,a)
export function hexToRgba(hex?: string, alpha: number = 1): string {
  if (!hex) return `rgba(0,0,0,${alpha})`
  let s = hex.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  if (/^([0-9a-fA-F]{6})$/.test(s)) {
    const r = parseInt(s.slice(0,2), 16)
    const g = parseInt(s.slice(2,4), 16)
    const b = parseInt(s.slice(4,6), 16)
    const a = Math.max(0, Math.min(1, alpha))
    return `rgba(${r},${g},${b},${a})`
  }
  return `rgba(0,0,0,${Math.max(0, Math.min(1, alpha))})`
}
