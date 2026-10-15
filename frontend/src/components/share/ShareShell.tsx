/**
 * 公开分享页外壳：顶栏（品牌 + 主题切换 + 首页）与页脚
 */
import type { ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import { HomeOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import '@/styles/pages/share.css';

interface ShareShellProps {
  /** 顶栏品牌旁的分类标签 */
  label: string;
  children: ReactNode;
}

export default function ShareShell({ label, children }: ShareShellProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { isMobile } = useBreakpoint();

  return (
    <div className="share">
      <header className="share-bar">
        <div className="share-bar__inner">
          <Link to="/" className="share-brand" aria-label="AI News 首页">
            <img className="share-brand__logo" src="/favicon.svg" alt="" width={26} height={26} />
            <span className="share-brand__name">AI News</span>
            <span className="eyebrow">{label}</span>
          </Link>
          <div className="share-bar__actions">
            <Tooltip title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
              <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="切换主题">
                {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              </button>
            </Tooltip>
            {isMobile ? (
              <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="返回首页">
                <HomeOutlined />
              </button>
            ) : (
              <Button size="small" icon={<HomeOutlined />} onClick={() => navigate('/')}>
                返回首页
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="share-main">
        <div className="share-sheet">{children}</div>
      </main>

      <footer className="share-footer">
        由 <Link to="/">AI News Tracker</Link> 生成 · AI 驱动的资讯情报
      </footer>
    </div>
  );
}
