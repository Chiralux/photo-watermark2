export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export const degToRad = (deg: number) => (deg * Math.PI) / 180

export function roundInt(n: number) { return Math.round(n) }
