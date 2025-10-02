export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export const degToRad = (deg: number) => (deg * Math.PI) / 180

export function roundInt(n: number) { return Math.round(n) }

// 归一化不透明度：支持 0-1 与 0-100 两种输入
export function normalizeOpacity(v: unknown, defaultValue: number = 1) {
	let raw = v as any
	if (raw == null) return Math.max(0, Math.min(1, defaultValue))
	if (typeof raw === 'string') {
		raw = raw.trim()
		if (raw.endsWith('%')) raw = raw.slice(0, -1)
	}
	const n = Number(raw)
	if (!Number.isFinite(n)) return Math.max(0, Math.min(1, defaultValue))
	if (n <= 0) return 0
	if (n <= 1) return n
	return Math.min(1, n / 100)
}
