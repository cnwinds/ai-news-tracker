import { LoginOutlined, MoonOutlined, SettingOutlined, SunOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import CommandSearch from '@/components/layout/CommandSearch';

interface MobileHeaderProps {
  title: string;
  showMore?: boolean;
  onMore: () => void;
  onOpenSettings: () => void;
}

export default function MobileHeader({ title, showMore, onMore, onOpenSettings }: MobileHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="m-header">
      <div className="m-header__top">
        <div className="m-header__brand">
          <img src="/favicon.svg" alt="" className="m-header__logo" />
          {showMore ? (
            <button type="button" className="m-header__title m-header__title--link" onClick={onMore}>
              {title}
              <span className="m-header__caret" aria-hidden>
                ▾
              </span>
            </button>
          ) : (
            <h1 className="m-header__title">{title}</h1>
          )}
        </div>
        <div className="m-header__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          </button>
          {isAuthenticated ? (
            <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="设置">
              <SettingOutlined />
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={() => navigate('/login')} aria-label="登录">
              <LoginOutlined />
            </button>
          )}
        </div>
      </div>
      <CommandSearch compact />
    </header>
  );
}
