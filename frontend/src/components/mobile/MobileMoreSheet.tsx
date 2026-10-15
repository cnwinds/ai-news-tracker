import { RightOutlined } from '@ant-design/icons';
import { Drawer } from 'antd';
import { PAGES } from '@/components/layout/navigation';

export type MobileMoreTabKey = 'exploration' | 'social-media' | 'statistics';

interface MobileMoreSheetProps {
  open: boolean;
  activeTab?: MobileMoreTabKey | null;
  onClose: () => void;
  onSelect: (key: MobileMoreTabKey) => void;
}

const MORE_PAGES = PAGES.filter((p) => p.group === 'explore');

export default function MobileMoreSheet({ open, activeTab, onClose, onSelect }: MobileMoreSheetProps) {
  return (
    <Drawer title="探索" placement="bottom" height="auto" open={open} onClose={onClose} className="m-sheet">
      <div className="m-more">
        {MORE_PAGES.map((page) => {
          const active = activeTab === page.key;
          return (
            <button
              key={page.key}
              type="button"
              className={`m-more__item${active ? ' m-more__item--active' : ''}`}
              onClick={() => {
                onSelect(page.key as MobileMoreTabKey);
                onClose();
              }}
            >
              <span className="m-more__icon">{page.icon}</span>
              <span className="m-more__text">
                <span className="m-more__title">{page.label}</span>
                <span className="m-more__desc">{page.description}</span>
              </span>
              <RightOutlined className="m-more__arrow" />
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
