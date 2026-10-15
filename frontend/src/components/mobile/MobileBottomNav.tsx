import type { ReactNode } from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import { PAGE_MAP } from '@/components/layout/navigation';

export type MobileNavKey = 'articles' | 'summary' | 'industry-graph' | 'more';

interface MobileBottomNavProps {
  activeKey: MobileNavKey;
  onChange: (key: MobileNavKey) => void;
}

const NAV_ITEMS: { key: MobileNavKey; label: string; icon: ReactNode }[] = [
  { key: 'articles', label: PAGE_MAP.articles.shortLabel, icon: PAGE_MAP.articles.icon },
  { key: 'summary', label: PAGE_MAP.summary.shortLabel, icon: PAGE_MAP.summary.icon },
  { key: 'industry-graph', label: PAGE_MAP['industry-graph'].shortLabel, icon: PAGE_MAP['industry-graph'].icon },
  { key: 'more', label: '更多', icon: <AppstoreOutlined /> },
];

export default function MobileBottomNav({ activeKey, onChange }: MobileBottomNavProps) {
  return (
    <nav className="m-tabbar" aria-label="主导航">
      {NAV_ITEMS.map((item) => {
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`m-tabbar__item${active ? ' m-tabbar__item--active' : ''}`}
            onClick={() => onChange(item.key)}
            aria-current={active ? 'page' : undefined}
          >
            <span className="m-tabbar__icon">{item.icon}</span>
            <span className="m-tabbar__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
