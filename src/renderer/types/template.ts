export type Template = {
  type: 'text' | 'image'
  text?: {
    content: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number | 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    // 当字体不存在原生 italic 变体时，使用仿斜（skewX）来模拟
    italicSynthetic?: boolean;
    // 仿斜角度（度），通常 10-15° 视觉最接近
    italicSkewDeg?: number;
    opacity?: number;
    color?: string;
    baselineAdjust?: number;
    outline?: { enabled?: boolean; color?: string; width?: number; opacity?: number };
    shadow?: { enabled?: boolean; color?: string; offsetX?: number; offsetY?: number; blur?: number; opacity?: number };
  }
  image?: {
    path: string;
    // 0-1 之间
    opacity?: number;
    // 按比例缩放：单一 scale（默认 1.0）
    scale?: number;
    // 缩放模式：proportional（等比）或 free（宽高分别缩放）
    scaleMode?: 'proportional' | 'free';
    // 自由缩放：分别的缩放因子（默认 1.0）
    scaleX?: number;
    scaleY?: number;
  }
  layout: { preset: string; offsetX?: number; offsetY?: number; allowOverflow?: boolean }
}

export type ResizeConfig = { mode: 'original'|'percent'|'custom'; width?: number; height?: number; percent?: number }
