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
  // 新增：仅影响导出/压缩预览的文字“水平微调”（单位：预览像素；会按比例换算至原图像素）
  baselineAdjustX?: number;
    outline?: { enabled?: boolean; color?: string; width?: number; opacity?: number };
    shadow?: { enabled?: boolean; color?: string; offsetX?: number; offsetY?: number; blur?: number; opacity?: number };
    rotation?: number; // 新增：水印旋转角度（度）
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
    rotation?: number; // 新增：水印旋转角度（度）
  }
  layout: { preset: string; offsetX?: number; offsetY?: number; allowOverflow?: boolean }
}

export type ResizeConfig = { mode: 'original'|'percent'|'custom'; width?: number; height?: number; percent?: number }

// 命名规则（文件前后缀）
export type NamingRule = { prefix?: string; suffix?: string }

// 可随模板一起保存的导出相关设置
export type ExportSettings = {
  format: 'png' | 'jpeg'
  naming?: NamingRule
  jpegQuality?: number
  resize?: ResizeConfig
  // UI 辅助项：压缩预览（不影响导出结果，但可作为模板的偏好保存）
  enableCompressedPreview?: boolean
}

// 模板文件保存格式（向后兼容旧版只保存 Template 的情况）
export type SavedTemplateFile = Template | {
  version?: 1
  template: Template
  export?: ExportSettings
}
