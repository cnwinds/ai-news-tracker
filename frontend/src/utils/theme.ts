/**
 * 主题工具函数和颜色常量
 * 统一管理主题相关的颜色和样式，避免硬编码和重复代码
 */
import type { ThemeMode } from '@/contexts/ThemeContext';

// 颜色常量 - 统一管理所有颜色值
export const colors = {
  light: {
    // 背景色
    bgBase: '#ffffff',
    bgContainer: '#f0f2f5',
    bgElevated: '#ffffff',
    bgSecondary: '#fafafa',
    // 文字颜色
    text: '#000000',
    textSecondary: 'rgba(0, 0, 0, 0.65)',
    textTertiary: 'rgba(0, 0, 0, 0.45)',
    textHeading: '#000000',
    // 边框颜色
    border: '#d9d9d9',
    borderSecondary: '#e8e8e8',
    // 代码块
    codeBg: '#f5f5f5',
    codeText: '#000000',
    // 消息气泡
    userMessageBg: '#1890ff',
    userMessageText: '#ffffff',
    assistantMessageBg: '#f0f0f0',
    assistantMessageText: '#000000',
    // 引用来源
    referenceBg: '#fafafa',
    referenceBorder: '#e8e8e8',
    // 选中状态
    selectedBg: '#e6f7ff',
    selectedBorder: '#1890ff',
    // 品牌色
    primary: '#1890ff',
    primaryHover: '#91d5ff',
    // 头像背景
    userAvatarBg: '#1890ff',
    assistantAvatarBg: '#52c41a',
    // 日历悬停背景
    calendarHoverBg: '#f0f9ff',
  },
  dark: {
    // 背景色
    bgBase: '#1a1a1a',
    bgContainer: '#1a1a1a',
    bgElevated: '#1f1f1f',
    bgSecondary: '#262626',
    // 文字颜色
    text: '#ffffff',
    textSecondary: '#e0e0e0',
    textTertiary: '#b3b3b3',
    textHeading: '#ffffff',
    // 边框颜色
    border: '#434343',
    borderSecondary: '#303030',
    // 代码块
    codeBg: '#1a1a1a',
    codeText: '#ffffff',
    // 消息气泡
    userMessageBg: '#4096ff',
    userMessageText: '#ffffff',
    assistantMessageBg: '#262626',
    assistantMessageText: '#ffffff',
    // 引用来源
    referenceBg: '#1f1f1f',
    referenceBorder: '#434343',
    // 选中状态
    selectedBg: '#111a2c',
    selectedBorder: '#4096ff',
    // 品牌色
    primary: '#4096ff',
    primaryHover: '#69b7ff',
    // 头像背景
    userAvatarBg: '#4096ff',
    assistantAvatarBg: '#52c41a',
    // 日历悬停背景
    calendarHoverBg: '#1a1f2e',
  },
} as const;

/**
 * 根据主题获取颜色值
 */
export function getThemeColor(
  theme: ThemeMode,
  colorKey: keyof typeof colors.light
): string {
  return colors[theme][colorKey];
}

/**
 * 根据主题获取样式对象
 */
export function getThemeStyles(theme: ThemeMode) {
  return {
    // 文字颜色
    text: { color: getThemeColor(theme, 'text') },
    textSecondary: { color: getThemeColor(theme, 'textSecondary') },
    textTertiary: { color: getThemeColor(theme, 'textTertiary') },
    textHeading: { color: getThemeColor(theme, 'textHeading') },
    // 背景色
    bgContainer: { backgroundColor: getThemeColor(theme, 'bgContainer') },
    bgElevated: { backgroundColor: getThemeColor(theme, 'bgElevated') },
    bgSecondary: { backgroundColor: getThemeColor(theme, 'bgSecondary') },
    // 边框
    border: { borderColor: getThemeColor(theme, 'border') },
    borderSecondary: { borderColor: getThemeColor(theme, 'borderSecondary') },
    // 代码块
    code: {
      backgroundColor: getThemeColor(theme, 'codeBg'),
      color: getThemeColor(theme, 'codeText'),
    },
  };
}

/**
 * 创建消息气泡样式
 */
export function getMessageBubbleStyle(
  theme: ThemeMode,
  type: 'user' | 'assistant'
) {
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

/**
 * 创建引用来源样式
 */
export function getReferenceStyle(theme: ThemeMode) {
  return {
    backgroundColor: getThemeColor(theme, 'referenceBg'),
    border: `1px solid ${getThemeColor(theme, 'referenceBorder')}`,
  };
}

/**
 * 创建选中状态样式
 */
export function getSelectedStyle(theme: ThemeMode) {
  return {
    backgroundColor: getThemeColor(theme, 'selectedBg'),
    borderLeft: `3px solid ${getThemeColor(theme, 'selectedBorder')}`,
  };
}
