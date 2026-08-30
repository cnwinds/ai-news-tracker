import type { ReactNode } from 'react';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';

export type MobileNavKey = 'articles' | 'summary' | 'industry-graph' | 'more';

interface MobileBottomNavProps {
  activeKey: MobileNavKey;
  onChange: (key: MobileNavKey) => void;
}

interface NavItem {
  key: MobileNavKey;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'articles', label: '资讯', icon: <FileTextOutlined /> },
  { key: 'summary', label: '总结', icon: <ReadOutlined /> },
  { key: 'industry-graph', label: '趋势', icon: <ApartmentOutlined /> },
  { key: 'more', label: '更多', icon: <AppstoreOutlined /> },
];

export default function MobileBottomNav({ activeKey, onChange }: MobileBottomNavProps) {
  const { theme } = useTheme();
  const inactiveColor = getThemeColor(theme, 'textSecondary');
  const activeColor = getThemeColor(theme, 'primary');

  return (
    <nav className="mobile-bottom-nav" aria-label="主导航">
      <div
        className="mobile-bottom-nav__pill"
        style={{
          border: `1px solid ${getThemeColor(theme, 'borderSecondary')}`,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`mobile-bottom-nav__item${active ? ' mobile-bottom-nav__item--active' : ''}`}
              onClick={() => onChange(item.key)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              style={{
                color: active ? activeColor : inactiveColor,
              }}
            >
              <span className="mobile-bottom-nav__icon">{item.icon}</span>
              <span className="mobile-bottom-nav__label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
