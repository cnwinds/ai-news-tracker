/**
 * 设计令牌（Design Tokens）—— 全站颜色/字体/圆角的唯一来源。
 *
 * - CSS 侧：ThemeProvider 在 <html> 上写入 `--c-*` 变量（以及兼容旧代码的 `--color-*`）。
 * - antd 侧：buildAntdTheme() 由同一份令牌生成 ThemeConfig。
 * - 组件内联样式：通过 getThemeColor() 拿到 `var(--c-*)` 引用，主题切换无需重渲染。
 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark';

export interface Palette {
  /** 应用最底层背景 */
  bg: string;
  /** 侧边栏 / 次级区域背景 */
  bgSubtle: string;
  /** 面板、卡片 */
  surface: string;
  /** 浮层：下拉、弹窗 */
  elevated: string;
  /** 悬停态背景 */
  hover: string;
  /** 激活/选中态背景 */
  active: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  /** 强调色上的文字 */
  accentContrast: string;
  accentSoft: string;
  accentBorder: string;
  /** 强调色作为文字时（保证对比度） */
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
  infoSoft: string;
  codeBg: string;
  overlay: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  /** 图表序列色 */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    bg: '#0a0c0f',
    bgSubtle: '#0e1115',
    surface: '#12161b',
    elevated: '#181d24',
    hover: '#1a2029',
    active: '#1f2731',
    border: '#212831',
    borderStrong: '#2e3743',
    text: '#e7ebf0',
    textSecondary: '#a4aebb',
    textTertiary: '#6f7a88',
    textDisabled: '#4a5360',
    accent: '#2dd4bf',
    accentHover: '#5eead4',
    accentActive: '#14b8a6',
    accentContrast: '#04211d',
    accentSoft: 'rgba(45, 212, 191, 0.12)',
    accentBorder: 'rgba(45, 212, 191, 0.35)',
    accentText: '#5eead4',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#fb7185',
    info: '#60a5fa',
    successSoft: 'rgba(74, 222, 128, 0.12)',
    warningSoft: 'rgba(251, 191, 36, 0.12)',
    dangerSoft: 'rgba(251, 113, 133, 0.12)',
    infoSoft: 'rgba(96, 165, 250, 0.12)',
    codeBg: '#0e1217',
    overlay: 'rgba(3, 5, 8, 0.66)',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    shadowMd: '0 8px 24px -6px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
    shadowLg: '0 24px 64px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
    chart1: '#2dd4bf',
    chart2: '#60a5fa',
    chart3: '#fbbf24',
    chart4: '#f472b6',
    chart5: '#a78bfa',
  },
  light: {
    bg: '#f4f5f7',
    bgSubtle: '#eceef2',
    surface: '#ffffff',
    elevated: '#ffffff',
    hover: '#f1f3f6',
    active: '#e8ebf0',
    border: '#e3e6eb',
    borderStrong: '#cfd4dc',
    text: '#0f1419',
    textSecondary: '#4b5563',
    textTertiary: '#7b8594',
    textDisabled: '#aab1bc',
    accent: '#0d9488',
    accentHover: '#0f766e',
    accentActive: '#115e59',
    accentContrast: '#ffffff',
    accentSoft: 'rgba(13, 148, 136, 0.09)',
    accentBorder: 'rgba(13, 148, 136, 0.32)',
    accentText: '#0f766e',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#e11d48',
    info: '#2563eb',
    successSoft: 'rgba(22, 163, 74, 0.09)',
    warningSoft: 'rgba(217, 119, 6, 0.1)',
    dangerSoft: 'rgba(225, 29, 72, 0.08)',
    infoSoft: 'rgba(37, 99, 235, 0.08)',
    codeBg: '#f3f4f6',
    overlay: 'rgba(15, 20, 25, 0.38)',
    shadowSm: '0 1px 2px rgba(16, 24, 40, 0.06)',
    shadowMd: '0 8px 24px -8px rgba(16, 24, 40, 0.14), 0 0 0 1px rgba(16, 24, 40, 0.04)',
    shadowLg: '0 24px 56px -16px rgba(16, 24, 40, 0.22), 0 0 0 1px rgba(16, 24, 40, 0.05)',
    chart1: '#0d9488',
    chart2: '#2563eb',
    chart3: '#d97706',
    chart4: '#db2777',
    chart5: '#7c3aed',
  },
};

export const fonts = {
  sans: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`,
  mono: `'JetBrains Mono', 'SFMono-Regular', 'Cascadia Code', Consolas, 'Liberation Mono', monospace`,
} as const;

export const radii = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

function toKebab(key: string): string {
  return key.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);
}

/** 生成某主题下的全部 CSS 变量 */
export function buildCssVariables(mode: ThemeMode): Record<string, string> {
  const p = palettes[mode];
  const vars: Record<string, string> = {};
  (Object.keys(p) as (keyof Palette)[]).forEach((key) => {
    vars[`--c-${toKebab(key)}`] = p[key];
  });

  vars['--font-sans'] = fonts.sans;
  vars['--font-mono'] = fonts.mono;
  vars['--radius-sm'] = `${radii.sm}px`;
  vars['--radius-md'] = `${radii.md}px`;
  vars['--radius-lg'] = `${radii.lg}px`;
  vars['--radius-xl'] = `${radii.xl}px`;

  // 兼容旧样式中使用的变量名
  vars['--color-bg-base'] = p.bg;
  vars['--color-bg-container'] = p.surface;
  vars['--color-bg-elevated'] = p.elevated;
  vars['--color-bg-secondary'] = p.hover;
  vars['--color-bg-spotlight'] = p.active;
  vars['--color-text'] = p.text;
  vars['--color-text-secondary'] = p.textSecondary;
  vars['--color-text-tertiary'] = p.textTertiary;
  vars['--color-border'] = p.borderStrong;
  vars['--color-border-secondary'] = p.border;
  vars['--color-primary'] = p.accent;
  vars['--color-primary-hover'] = p.accentHover;
  vars['--color-success'] = p.success;
  vars['--color-warning'] = p.warning;
  vars['--color-error'] = p.danger;
  vars['--color-error-hover'] = p.danger;
  vars['--color-info'] = p.info;
  vars['--color-disabled'] = p.textDisabled;
  return vars;
}

export function applyCssVariables(mode: ThemeMode): void {
  const root = document.documentElement;
  const vars = buildCssVariables(mode);
  Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
  root.style.colorScheme = mode;
  root.dataset.theme = mode;
  root.classList.toggle('dark-theme', mode === 'dark');
  root.classList.toggle('light-theme', mode === 'light');

  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) {
    meta.setAttribute('content', palettes[mode].bg);
  }
}

export function buildAntdTheme(mode: ThemeMode): ThemeConfig {
  const p = palettes[mode];
  const isDark = mode === 'dark';

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    cssVar: true,
    hashed: false,
    token: {
      colorPrimary: p.accent,
      colorInfo: p.info,
      colorSuccess: p.success,
      colorWarning: p.warning,
      colorError: p.danger,
      colorLink: p.accentText,
      colorLinkHover: p.accentHover,
      colorTextLightSolid: p.accentContrast,

      colorBgBase: p.bg,
      colorBgLayout: p.bg,
      colorBgContainer: p.surface,
      colorBgElevated: p.elevated,
      colorBgSpotlight: isDark ? p.active : '#1f2933',
      colorBgMask: p.overlay,
      colorFillAlter: p.bgSubtle,
      colorFillSecondary: p.hover,
      colorFillTertiary: p.hover,
      colorFillQuaternary: p.bgSubtle,

      colorTextBase: p.text,
      colorText: p.text,
      colorTextSecondary: p.textSecondary,
      colorTextTertiary: p.textTertiary,
      colorTextQuaternary: p.textDisabled,
      colorTextHeading: p.text,
      colorTextDescription: p.textTertiary,
      colorTextPlaceholder: p.textTertiary,

      colorBorder: p.borderStrong,
      colorBorderSecondary: p.border,
      colorSplit: p.border,

      controlItemBgHover: p.hover,
      controlItemBgActive: p.accentSoft,
      controlItemBgActiveHover: p.accentSoft,
      controlOutline: p.accentSoft,
      controlOutlineWidth: 3,

      fontFamily: fonts.sans,
      fontFamilyCode: fonts.mono,
      fontSize: 14,
      lineHeight: 1.6,

      borderRadius: radii.md,
      borderRadiusSM: radii.sm,
      borderRadiusLG: radii.lg,
      borderRadiusXS: 4,

      controlHeight: 34,
      controlHeightLG: 40,
      controlHeightSM: 26,

      boxShadow: p.shadowMd,
      boxShadowSecondary: p.shadowMd,
      boxShadowTertiary: p.shadowSm,

      motionDurationFast: '0.12s',
      motionDurationMid: '0.18s',
      motionDurationSlow: '0.26s',
      wireframe: false,
    },
    components: {
      Layout: {
        bodyBg: p.bg,
        headerBg: p.surface,
        siderBg: p.bgSubtle,
      },
      Card: {
        headerFontSize: 15,
        headerHeight: 52,
        paddingLG: 20,
        colorBorderSecondary: p.border,
      },
      Button: {
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBg: p.surface,
        defaultBorderColor: p.borderStrong,
      },
      Tabs: {
        itemColor: p.textTertiary,
        itemHoverColor: p.text,
        itemSelectedColor: p.text,
        itemActiveColor: p.text,
        inkBarColor: p.accent,
        titleFontSize: 14,
        horizontalItemGutter: 24,
      },
      Segmented: {
        itemSelectedBg: p.surface,
        trackBg: p.hover,
        itemColor: p.textSecondary,
        itemHoverColor: p.text,
        itemSelectedColor: p.text,
      },
      Tag: {
        defaultBg: p.hover,
        defaultColor: p.textSecondary,
      },
      Table: {
        headerBg: p.bgSubtle,
        headerColor: p.textSecondary,
        rowHoverBg: p.hover,
        borderColor: p.border,
        headerSplitColor: 'transparent',
      },
      Modal: {
        contentBg: p.elevated,
        headerBg: p.elevated,
        footerBg: p.elevated,
      },
      Drawer: {
        colorBgElevated: p.elevated,
      },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemSelectedBg: p.active,
        itemSelectedColor: p.text,
        itemHoverBg: p.hover,
        itemColor: p.textSecondary,
        itemBorderRadius: radii.md,
        activeBarBorderWidth: 0,
      },
      Input: {
        activeShadow: `0 0 0 3px ${p.accentSoft}`,
      },
      Select: {
        optionSelectedBg: p.accentSoft,
      },
      Radio: {
        buttonSolidCheckedBg: p.accent,
        buttonSolidCheckedHoverBg: p.accentHover,
        buttonSolidCheckedActiveBg: p.accentActive,
        buttonSolidCheckedColor: p.accentContrast,
      },
      Tooltip: {
        colorBgSpotlight: isDark ? '#232a34' : '#1f2933',
        colorTextLightSolid: '#f5f7fa',
      },
      Statistic: {
        contentFontSize: 26,
      },
      Pagination: {
        itemActiveBg: p.accentSoft,
      },
      Badge: {
        colorBgContainer: p.surface,
      },
      Message: {
        contentBg: p.elevated,
      },
    },
  };
}
