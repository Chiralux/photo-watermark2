export const anchorPresets = ['tl','tc','tr','cl','center','cr','bl','bc','br'] as const
export type AnchorPreset = typeof anchorPresets[number]

export const anchorMap: Record<AnchorPreset, [number, number]> = {
  tl: [0, 0], tc: [0.5, 0], tr: [1, 0],
  cl: [0, 0.5], center: [0.5, 0.5], cr: [1, 0.5],
  bl: [0, 1], bc: [0.5, 1], br: [1, 1]
}

// 与导出逻辑一致的 transform-origin（百分比形式，给文本使用）
export function transformOriginByPreset(preset: string): string {
  switch (preset) {
    case 'tl': return '0% 0%'
    case 'tc': return '50% 0%'
    case 'tr': return '100% 0%'
    case 'cl': return '0% 50%'
    case 'center': return '50% 50%'
    case 'cr': return '100% 50%'
    case 'bl': return '0% 100%'
    case 'bc': return '50% 100%'
    case 'br': return '100% 100%'
    default: return '50% 50%'
  }
}
