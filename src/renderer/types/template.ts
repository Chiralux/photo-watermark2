export type Template = {
  type: 'text' | 'image'
  text?: {
    content: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number | 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
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
