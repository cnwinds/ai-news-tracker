import { Tooltip } from 'antd';
import {
  LoginOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { PAGES, type PageDef, type PageKey } from './navigation';

interface AppSidebarProps {
  active: PageKey;
  collapsed: boolean;
  onNavigate: (key: PageKey) => void;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
}

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  active?: boolean;
  hint?: string;
  onClick: () => void;
}

function SidebarButton({ icon, label, collapsed, active, hint, onClick }: SidebarButtonProps) {
  const button = (
    <button
      type="button"
      className={`app-nav-item${active ? ' app-nav-item--active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
    >
      <span className="app-nav-item__icon">{icon}</span>
      <span className="app-nav-item__label">{label}</span>
      {hint && <span className="app-nav-item__hint">{hint}</span>}
    </button>
  );

  return collapsed ? (
    <Tooltip title={label} placement="right" mouseEnterDelay={0.2}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export default function AppSidebar({
  active,
  collapsed,
  onNavigate,
  onToggleCollapsed,
  onOpenSettings,
}: AppSidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated, username, logout } = useAuth();
  const navigate = useNavigate();
  const message = useMessage();

  const renderGroup = (label: string, pages: PageDef[], offset: number) => (
    <div className="app-sidebar__section">
      <div className="app-sidebar__section-label eyebrow">{label}</div>
      {pages.map((page, index) => (
        <SidebarButton
          key={page.key}
          icon={page.icon}
          label={page.label}
          hint={`${offset + index + 1}`}
          collapsed={collapsed}
          active={active === page.key}
          onClick={() => onNavigate(page.key)}
        />
      ))}
    </div>
  );

  const corePages = PAGES.filter((p) => p.group === 'core');
  const explorePages = PAGES.filter((p) => p.group === 'explore');

  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar__brand">
        <img src="/favicon.svg" alt="" className="app-sidebar__logo" />
        <div className="app-sidebar__brand-text">
          <span className="app-sidebar__brand-name">AI News</span>
          <span className="app-sidebar__brand-sub">Intelligence</span>
        </div>
      </div>

      {renderGroup('工作台', corePages, 0)}
      {renderGroup('探索', explorePages, corePages.length)}

      <div className="app-sidebar__spacer" />

      <div className="app-sidebar__footer">
        <SidebarButton
          icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          label={theme === 'dark' ? '浅色模式' : '深色模式'}
          collapsed={collapsed}
          onClick={toggleTheme}
        />
        {isAuthenticated && (
          <SidebarButton
            icon={<SettingOutlined />}
            label="系统设置"
            collapsed={collapsed}
            onClick={onOpenSettings}
          />
        )}
        <SidebarButton
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          label={collapsed ? '展开侧栏' : '收起侧栏'}
          hint={collapsed ? undefined : '['}
          collapsed={collapsed}
          onClick={onToggleCollapsed}
        />

        {isAuthenticated ? (
          <div className="app-sidebar__user">
            <span className="app-sidebar__avatar">{(username || 'U').slice(0, 1)}</span>
            <span className="app-sidebar__user-name">{username}</span>
            <Tooltip title="退出登录">
              <button
                type="button"
                className="icon-btn app-sidebar__user-action"
                aria-label="退出登录"
                onClick={() => {
                  logout();
                  message.success('已退出登录');
                }}
              >
                <LogoutOutlined />
              </button>
            </Tooltip>
          </div>
        ) : (
          <SidebarButton
            icon={<LoginOutlined />}
            label="登录"
            collapsed={collapsed}
            onClick={() => navigate('/login')}
          />
        )}
      </div>
    </aside>
  );
}
