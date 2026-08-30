import {
  BarChartOutlined,
  RightOutlined,
  RocketOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { Drawer } from 'antd';
import type { ReactNode } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';

export type MobileMoreTabKey = 'exploration' | 'social-media' | 'statistics';

interface MobileMoreSheetProps {
  open: boolean;
  activeTab?: MobileMoreTabKey | null;
  onClose: () => void;
  onSelect: (key: MobileMoreTabKey) => void;
}

interface MoreItem {
  key: MobileMoreTabKey;
  label: string;
  description: string;
  icon: ReactNode;
}

const MORE_ITEMS: MoreItem[] = [
  {
    key: 'exploration',
    label: '模型先知',
    description: '追踪预发布模型与更新信号',
    icon: <RocketOutlined />,
  },
  {
    key: 'social-media',
    label: '社交平台',
    description: 'AI 热点小报与社媒趋势',
    icon: <ShareAltOutlined />,
  },
  {
    key: 'statistics',
    label: '数据统计',
    description: '采集量与文章分布概览',
    icon: <BarChartOutlined />,
  },
];

export default function MobileMoreSheet({
  open,
  activeTab,
  onClose,
  onSelect,
}: MobileMoreSheetProps) {
  const { theme } = useTheme();

  return (
    <Drawer
      title="探索工具"
      placement="bottom"
      height="auto"
      open={open}
      onClose={onClose}
      className="mobile-more-sheet"
      styles={{
        header: {
          borderBottom: 'none',
        },
      }}
    >
      <p
        className="mobile-more-sheet__hint"
        style={{ color: getThemeColor(theme, 'textTertiary') }}
      >
        扩展模块
      </p>
      <div className="mobile-more-sheet__list">
        {MORE_ITEMS.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`mobile-more-sheet__item${active ? ' mobile-more-sheet__item--active' : ''}`}
              onClick={() => {
                onSelect(item.key);
                onClose();
              }}
              style={{
                background: getThemeColor(theme, 'bgContainer'),
              }}
            >
              <span className="mobile-more-sheet__icon">{item.icon}</span>
              <span className="mobile-more-sheet__text">
                <span
                  className="mobile-more-sheet__title"
                  style={{ color: getThemeColor(theme, 'text') }}
                >
                  {item.label}
                </span>
                <span
                  className="mobile-more-sheet__desc"
                  style={{ color: getThemeColor(theme, 'textSecondary') }}
                >
                  {item.description}
                </span>
              </span>
              <RightOutlined className="mobile-more-sheet__arrow" />
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
