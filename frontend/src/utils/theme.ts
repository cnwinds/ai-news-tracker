/**
 * 主题工具函数
 * 颜色统一来自 `@/theme/tokens`；这里返回 CSS 变量引用，主题切换时由浏览器直接生效。
 */
import type { ThemeMode } from '@/contexts/ThemeContext';
import { palettes, type Palette } from '@/theme/tokens';

/** 语义色名 → 令牌名 */
const colorKeyMap = {
  bgBase: 'bg',
  bgContainer: 'bg',
  bgElevated: 'surface',
  bgSecondary: 'hover',
  text: 'text',
  textSecondary: 'textSecondary',
  textTertiary: 'textTertiary',
  textHeading: 'text',
  border: 'borderStrong',
  borderSecondary: 'border',
  codeBg: 'codeBg',
  codeText: 'text',
  userMessageBg: 'accent',
  userMessageText: 'accentContrast',
  assistantMessageBg: 'hover',
  assistantMessageText: 'text',
  referenceBg: 'bgSubtle',
  referenceBorder: 'border',
  selectedBg: 'accentSoft',
  selectedBorder: 'accent',
  primary: 'accent',
  primaryHover: 'accentHover',
  userAvatarBg: 'accent',
  assistantAvatarBg: 'active',
  calendarHoverBg: 'hover',
} as const satisfies Record<string, keyof Palette>;

export type ThemeColorKey = keyof typeof colorKeyMap;

function cssVar(token: keyof Palette): string {
  return `var(--c-${token.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`)})`;
}

/**
 * 获取主题颜色（CSS 变量引用，可直接用于 style / SVG 属性）
 * `theme` 参数保留以兼容旧调用；颜色值由当前 <html> 上的变量决定。
 */
export function getThemeColor(_theme: ThemeMode, colorKey: ThemeColorKey): string {
  return cssVar(colorKeyMap[colorKey]);
}

/** 获取实际色值（用于 canvas、颜色计算等无法使用 CSS 变量的场景） */
export function getThemeHex(theme: ThemeMode, colorKey: ThemeColorKey): string {
  return palettes[theme][colorKeyMap[colorKey]];
}

/** 直接按令牌名取 CSS 变量 */
export function token(name: keyof Palette): string {
  return cssVar(name);
}

export function getThemeStyles(theme: ThemeMode) {
  return {
    text: { color: getThemeColor(theme, 'text') },
    textSecondary: { color: getThemeColor(theme, 'textSecondary') },
    textTertiary: { color: getThemeColor(theme, 'textTertiary') },
    textHeading: { color: getThemeColor(theme, 'textHeading') },
    bgContainer: { backgroundColor: getThemeColor(theme, 'bgContainer') },
    bgElevated: { backgroundColor: getThemeColor(theme, 'bgElevated') },
    bgSecondary: { backgroundColor: getThemeColor(theme, 'bgSecondary') },
    border: { borderColor: getThemeColor(theme, 'border') },
    borderSecondary: { borderColor: getThemeColor(theme, 'borderSecondary') },
    code: {
      backgroundColor: getThemeColor(theme, 'codeBg'),
      color: getThemeColor(theme, 'codeText'),
    },
  };
}

export function getMessageBubbleStyle(theme: ThemeMode, type: 'user' | 'assistant') {
  if (type === 'user') {
    return {
      backgroundColor: getThemeColor(theme, 'userMessageBg'),
      color: getThemeColor(theme, 'userMessageText'),
    };
  }
  return {
    backgroundColor: getThemeColor(theme, 'assistantMessageBg'),
    color: getThemeColor(theme, 'assistantMessageText'),
  };
}

export function getReferenceStyle(theme: ThemeMode) {
  return {
    backgroundColor: getThemeColor(theme, 'referenceBg'),
    border: `1px solid ${getThemeColor(theme, 'referenceBorder')}`,
  };
}

export function getSelectedStyle(theme: ThemeMode) {
  return {
    backgroundColor: getThemeColor(theme, 'selectedBg'),
    borderLeft: `3px solid ${getThemeColor(theme, 'selectedBorder')}`,
  };
}
