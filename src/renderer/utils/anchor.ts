export const anchorPresets = ['tl','tc','tr','cl','center','cr','bl','bc','br'] as const
export type AnchorPreset = typeof anchorPresets[number]

// 统一以水印中心为锚点，无论预设为何
export const anchorMap: Record<AnchorPreset, [number, number]> = {
  tl: [0.5, 0.5], tc: [0.5, 0.5], tr: [0.5, 0.5],
  cl: [0.5, 0.5], center: [0.5, 0.5], cr: [0.5, 0.5],
  bl: [0.5, 0.5], bc: [0.5, 0.5], br: [0.5, 0.5]
}

// 与导出逻辑一致的 transform-origin（百分比形式，给文本使用）
export function transformOriginByPreset(_preset: string): string {
  return '50% 50%'
}
