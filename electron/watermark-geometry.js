/**
 * 导出/生成图使用的统一几何与锚点工具（与渲染端保持一致）。
 * - calcPosition: 九宫格定位 + 偏移 + 可选钳制
 * - getImageAnchorFactors: 图片水印的锚点系数（0~1）
 */

const MARGIN = 16

export function calcPosition(layout, W, H, clampInside = true) {
  const preset = layout?.preset || 'center'
  let x = Math.floor(W / 2), y = Math.floor(H / 2)
  switch (preset) {
    case 'tl': x = MARGIN; y = MARGIN; break
    case 'tc': x = Math.floor(W / 2); y = MARGIN; break
    case 'tr': x = Math.max(0, W - MARGIN); y = MARGIN; break
    case 'cl': x = MARGIN; y = Math.floor(H / 2); break
    case 'center': x = Math.floor(W / 2); y = Math.floor(H / 2); break
    case 'cr': x = Math.max(0, W - MARGIN); y = Math.floor(H / 2); break
    case 'bl': x = MARGIN; y = Math.max(0, H - MARGIN); break
    case 'bc': x = Math.floor(W / 2); y = Math.max(0, H - MARGIN); break
    case 'br': x = Math.max(0, W - MARGIN); y = Math.max(0, H - MARGIN); break
  }
  const rawLeft = Math.round(x + (layout?.offsetX || 0))
  const rawTop  = Math.round(y + (layout?.offsetY || 0))
  if (!clampInside) return { left: rawLeft, top: rawTop }
  const left = Math.max(0, Math.min(W - 1, rawLeft))
  const top  = Math.max(0, Math.min(H - 1, rawTop))
  return { left, top }
}

export function getImageAnchorFactors(_preset) {
  // 统一以“水印中心(0.5,0.5)”作为锚点，无论九宫格预设为何
  return { ax: 0.5, ay: 0.5 }
}
