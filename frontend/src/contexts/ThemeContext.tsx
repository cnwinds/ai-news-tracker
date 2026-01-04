/**
 * 主题上下文 - 管理明暗主题切换
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeConfig, theme } from 'antd';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  themeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'ai-news-tracker-theme';

// 获取初始主题（从 localStorage 或系统偏好）
const getInitialTheme = (): ThemeMode => {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode;
  if (savedTheme) {
    return savedTheme;
  }
  // 检查系统偏好
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

// 主题配置
const lightThemeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#1890ff',
    colorBgBase: '#ffffff',
    colorTextBase: '#000000',
    borderRadius: 6,
  },
};

const darkThemeConfig: ThemeConfig = {
  token: {
    // 主色调 - 使用更柔和的蓝色
    colorPrimary: '#4096ff',
    // 基础背景色 - 使用统一的深灰色，避免纯黑色
    colorBgBase: '#1a1a1a',
    // 容器背景色 - 稍浅的深灰色，形成层次
    colorBgContainer: '#262626',
    // 文本颜色 - 提高对比度，确保可读性
    colorTextBase: '#ffffff',
    colorText: '#ffffff',
    colorTextSecondary: '#e0e0e0', // 从 #bfbfbf 提高到 #e0e0e0，提高对比度
    colorTextTertiary: '#b3b3b3', // 从 #8c8c8c 提高到 #b3b3b3，提高对比度
    colorTextHeading: '#ffffff', // 标题文字颜色
    // 边框颜色
    colorBorder: '#434343',
    colorBorderSecondary: '#303030',
    // 选项卡相关
    colorBgElevated: '#1f1f1f',
    // 圆角
    borderRadius: 6,
  },
  algorithm: theme.darkAlgorithm, // 使用暗色算法
  components: {
    // 优化 Tabs 组件在深色模式下的样式
    Tabs: {
      itemSelectedColor: '#4096ff', // 选中项文字颜色
      itemHoverColor: '#69b7ff', // 悬停文字颜色
      itemActiveColor: '#4096ff', // 激活文字颜色
      inkBarColor: '#4096ff', // 指示条颜色
    },
    // 优化 Card 组件
    Card: {
      colorBgContainer: '#1f1f1f',
      colorBorderSecondary: '#303030',
      colorTextHeading: '#ffffff', // 卡片标题文字颜色
      colorText: '#ffffff', // 卡片正文文字颜色
      colorTextDescription: '#e0e0e0', // 卡片描述文字颜色
    },
    // 优化 Typography 组件
    Typography: {
      colorText: '#ffffff', // 主要文字颜色
      colorTextSecondary: '#e0e0e0', // 次要文字颜色
      colorTextTertiary: '#b3b3b3', // 辅助文字颜色
      colorTextHeading: '#ffffff', // 标题文字颜色
    },
    // 优化 Button 组件
    Button: {
      colorPrimary: '#4096ff',
      colorPrimaryHover: '#69b7ff',
      colorPrimaryActive: '#0958d9',
    },
  },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  // 应用主题到 body
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark-theme');
      root.classList.remove('light-theme');
    } else {
      root.classList.add('light-theme');
      root.classList.remove('dark-theme');
    }
    // 保存到 localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const themeConfig = theme === 'dark' ? darkThemeConfig : lightThemeConfig;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeConfig }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
