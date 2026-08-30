import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Layout, Tabs, Drawer, Button, Space } from 'antd';
import {
  ApartmentOutlined,
  BarChartOutlined,
  FileTextOutlined,
  LoginOutlined,
  LogoutOutlined,
  ReadOutlined,
  RocketOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SystemSettings from '@/components/SystemSettings';
import GlobalNavigation from '@/components/GlobalNavigation';
import AIConversationModal from '@/components/AIConversationModal';
import SocialMediaReport from '@/components/SocialMediaReport';
import ModelExplorer from '@/components/ModelExplorer';
import TechnologyEvolutionPage from '@/features/industryGraph/TechnologyEvolutionPage';
import MobileBottomNav, { type MobileNavKey } from '@/components/mobile/MobileBottomNav';
import MobileMoreSheet, { type MobileMoreTabKey } from '@/components/mobile/MobileMoreSheet';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { getThemeColor } from '@/utils/theme';

const { Content } = Layout;

type TabKey = 'articles' | 'summary' | 'industry-graph' | MobileMoreTabKey;

const MOBILE_PAGE_TITLES: Record<TabKey, string> = {
  articles: '最新资讯',
  summary: '内容总结',
  'industry-graph': '行业趋势',
  exploration: '模型先知',
  'social-media': '社交平台',
  statistics: '数据统计',
};

const MOBILE_PAGE_EYEBROWS: Record<TabKey, string> = {
  articles: '资讯',
  summary: '总结',
  'industry-graph': '趋势',
  exploration: '探索',
  'social-media': '社媒',
  statistics: '统计',
};

function getMobileNavKey(tab: TabKey): MobileNavKey {
  if (tab === 'articles' || tab === 'summary' || tab === 'industry-graph') {
    return tab;
  }
  return 'more';
}

function isMoreTab(tab: TabKey): tab is MobileMoreTabKey {
  return tab === 'exploration' || tab === 'social-media' || tab === 'statistics';
}

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState<TabKey>('articles');
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const { theme } = useTheme();
  const { isAuthenticated, username, logout } = useAuth();
  const { isMobile } = useBreakpoint();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useMessage();

  useEffect(() => {
    if (!settingsDrawerOpen) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
    queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    queryClient.invalidateQueries({ queryKey: ['industry-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['industry-graph-suggested-questions'] });
  }, [queryClient, settingsDrawerOpen]);

  const tabContent = useMemo(() => {
    switch (selectedTab) {
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
  }, [selectedTab]);

  const handleMobileNavChange = (key: MobileNavKey) => {
    if (key === 'more') {
      setMoreSheetOpen(true);
      return;
    }
    setSelectedTab(key);
  };

  const settingsDrawer = (
    <Drawer
      title={
        <div className="mobile-settings-drawer__title">
          <span>系统设置</span>
          <Space wrap>
            {isAuthenticated ? (
              <>
                <span>{username}</span>
                <Button
                  type="text"
                  icon={<LogoutOutlined />}
                  onClick={() => {
                    logout();
                    message.success('已退出登录');
                    navigate('/');
                  }}
                >
                  退出
                </Button>
              </>
            ) : (
              <Button
                type="primary"
                icon={<LoginOutlined />}
                onClick={() => navigate('/login')}
              >
                登录
              </Button>
            )}
          </Space>
        </div>
      }
      placement="right"
      width={isMobile ? '100%' : 800}
      open={settingsDrawerOpen}
      onClose={() => setSettingsDrawerOpen(false)}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: isMobile ? '12px' : '24px' }}>
        <SystemSettings />
      </div>
    </Drawer>
  );

  if (isMobile) {
    const showMoreBack = isMoreTab(selectedTab);

    return (
      <div className={`mobile-app-shell ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`}>
        <GlobalNavigation onSettingsClick={() => setSettingsDrawerOpen(true)} />
        <main className="mobile-app-main">
          <div className="mobile-page-header">
            <div className="mobile-page-header__channel">
              <span className="mobile-page-header__eyebrow">
                {MOBILE_PAGE_EYEBROWS[selectedTab]}
              </span>
              <h1
                className="mobile-page-header__title"
                style={{ color: getThemeColor(theme, 'text') }}
              >
                {MOBILE_PAGE_TITLES[selectedTab]}
              </h1>
            </div>
            {showMoreBack && (
              <button
                type="button"
                className="mobile-page-header__back"
                onClick={() => setMoreSheetOpen(true)}
                style={{
                  color: getThemeColor(theme, 'text'),
                  borderColor: getThemeColor(theme, 'borderSecondary'),
                }}
              >
                更多
              </button>
            )}
          </div>
          <div className="mobile-page-content">{tabContent}</div>
        </main>

        <MobileBottomNav
          activeKey={getMobileNavKey(selectedTab)}
          onChange={handleMobileNavChange}
        />

        <MobileMoreSheet
          open={moreSheetOpen}
          activeTab={isMoreTab(selectedTab) ? selectedTab : null}
          onClose={() => setMoreSheetOpen(false)}
          onSelect={setSelectedTab}
        />

        <AIConversationModal />
        {settingsDrawer}
      </div>
    );
  }

  const desktopTabs = [
    {
      key: 'articles',
      label: (
        <span>
          <FileTextOutlined />
          {' '}文章列表
        </span>
      ),
      children: <ArticleList />,
    },
    {
      key: 'summary',
      label: (
        <span>
          <ReadOutlined />
          {' '}内容总结
        </span>
      ),
      children: <DailySummary />,
    },
    {
      key: 'industry-graph',
      label: (
        <span>
          <ApartmentOutlined />
          {' '}行业趋势图谱
        </span>
      ),
      children: <TechnologyEvolutionPage />,
    },
    {
      key: 'exploration',
      label: (
        <span>
          <RocketOutlined />
          {' '}模型先知
        </span>
      ),
      children: <ModelExplorer />,
    },
    {
      key: 'social-media',
      label: (
        <span>
          <ShareAltOutlined />
          {' '}社交平台
        </span>
      ),
      children: <SocialMediaReport />,
    },
    {
      key: 'statistics',
      label: (
        <span>
          <BarChartOutlined />
          {' '}数据统计
        </span>
      ),
      children: <Statistics />,
    },
  ];

  const contentStyle: CSSProperties = {
    padding: '24px',
    background: theme === 'dark' ? '#1a1a1a' : '#f0f2f5',
    minHeight: 'calc(100vh - 64px)',
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <GlobalNavigation onSettingsClick={() => setSettingsDrawerOpen(true)} />
      <Layout>
        <Content style={contentStyle}>
          <Tabs
            activeKey={selectedTab}
            onChange={(key) => setSelectedTab(key as TabKey)}
            items={desktopTabs}
            size="large"
          />
        </Content>
      </Layout>

      <AIConversationModal />
      {settingsDrawer}
    </Layout>
  );
}
