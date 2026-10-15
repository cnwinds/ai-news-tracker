import { useCallback, useEffect, useState } from 'react';
import { Drawer } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SystemSettings from '@/components/SystemSettings';
import AIConversationModal from '@/components/AIConversationModal';
import SocialMediaReport from '@/components/SocialMediaReport';
import ModelExplorer from '@/components/ModelExplorer';
import TechnologyEvolutionPage from '@/features/industryGraph/TechnologyEvolutionPage';
import AppSidebar from '@/components/layout/AppSidebar';
import CommandSearch from '@/components/layout/CommandSearch';
import { PAGES, PAGE_MAP, isPageKey, type PageKey } from '@/components/layout/navigation';
import MobileHeader from '@/components/mobile/MobileHeader';
import MobileBottomNav, { type MobileNavKey } from '@/components/mobile/MobileBottomNav';
import MobileMoreSheet, { type MobileMoreTabKey } from '@/components/mobile/MobileMoreSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const SIDEBAR_STORAGE_KEY = 'ai-news-sidebar-collapsed';

/** 需要占满内容区高度、自行管理滚动的页面 */
const FULL_BLEED_PAGES: PageKey[] = ['articles', 'summary'];

function renderPage(page: PageKey) {
  switch (page) {
    case 'articles':
      return <ArticleList />;
    case 'summary':
      return <DailySummary />;
    case 'industry-graph':
      return <TechnologyEvolutionPage />;
    case 'exploration':
      return <ModelExplorer />;
    case 'social-media':
      return <SocialMediaReport />;
    case 'statistics':
      return <Statistics />;
    default:
      return <ArticleList />;
  }
}

function getMobileNavKey(page: PageKey): MobileNavKey {
  if (page === 'articles' || page === 'summary' || page === 'industry-graph') {
    return page;
  }
  return 'more';
}

function isMoreTab(page: PageKey): page is MobileMoreTabKey {
  return page === 'exploration' || page === 'social-media' || page === 'statistics';
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"], .ant-select, .ant-modal, .ant-drawer');
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const page: PageKey = isPageKey(tabParam) ? tabParam : 'articles';

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
  const { isMobile } = useBreakpoint();
  const queryClient = useQueryClient();

  const navigateTo = useCallback(
    (key: PageKey) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key === 'articles') {
            next.delete('tab');
          } else {
            next.set('tab', key);
          }
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, prev ? '0' : '1');
      return !prev;
    });
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
    queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    queryClient.invalidateQueries({ queryKey: ['industry-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['industry-graph-suggested-questions'] });
  }, [queryClient, settingsOpen]);

  // 桌面快捷键：1-6 切换页面，[ 折叠侧栏
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const index = Number(e.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < PAGES.length) {
        navigateTo(PAGES[index].key);
      } else if (e.key === '[') {
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobile, navigateTo, toggleCollapsed]);

  const settingsDrawer = (
    <Drawer
      title="系统设置"
      placement="right"
      width={isMobile ? '100%' : 860}
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      className="settings-drawer"
      styles={{ body: { padding: isMobile ? 12 : 24 } }}
      destroyOnHidden
    >
      <SystemSettings />
    </Drawer>
  );

  const current = PAGE_MAP[page];

  if (isMobile) {
    return (
      <div className="m-shell">
        <MobileHeader
          title={current.label}
          showMore={isMoreTab(page)}
          onMore={() => setMoreSheetOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="m-main" key={page}>
          {renderPage(page)}
        </main>

        <MobileBottomNav
          activeKey={getMobileNavKey(page)}
          onChange={(key) => (key === 'more' ? setMoreSheetOpen(true) : navigateTo(key))}
        />
        <MobileMoreSheet
          open={moreSheetOpen}
          activeTab={isMoreTab(page) ? page : null}
          onClose={() => setMoreSheetOpen(false)}
          onSelect={navigateTo}
        />

        <AIConversationModal />
        {settingsDrawer}
      </div>
    );
  }

  const fullBleed = FULL_BLEED_PAGES.includes(page);

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <AppSidebar
        active={page}
        collapsed={collapsed}
        onNavigate={navigateTo}
        onToggleCollapsed={toggleCollapsed}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar__title">
            <h1>{current.label}</h1>
            <span className="app-topbar__desc">{current.description}</span>
          </div>
          <div className="app-topbar__search">
            <CommandSearch />
          </div>
        </header>

        <main className="app-content">
          <div className={`app-page${fullBleed ? ' app-page--full' : ''}`} key={page}>
            {renderPage(page)}
          </div>
        </main>
      </div>

      <AIConversationModal />
      {settingsDrawer}
    </div>
  );
}
