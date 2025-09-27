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
  image?: { path: string; opacity?: number; scale?: number }
  layout: { preset: string; offsetX?: number; offsetY?: number }
}

export type ResizeConfig = { mode: 'original'|'percent'|'custom'; width?: number; height?: number; percent?: number }
