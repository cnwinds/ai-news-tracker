import { useEffect, useState, type CSSProperties } from 'react';
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
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const { Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
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

  const tabs = [
    {
      key: 'articles',
      label: (
        <span>
          <FileTextOutlined />
          {isMobile ? ' 文章' : ' 文章列表'}
        </span>
      ),
      children: <ArticleList />,
    },
    {
      key: 'summary',
      label: (
        <span>
          <ReadOutlined />
          {isMobile ? ' 总结' : ' 内容总结'}
        </span>
      ),
      children: <DailySummary />,
    },
    {
      key: 'industry-graph',
      label: (
        <span>
          <ApartmentOutlined />
          {isMobile ? ' 趋势' : ' 行业趋势图谱'}
        </span>
      ),
      children: <TechnologyEvolutionPage />,
    },
    {
      key: 'exploration',
      label: (
        <span>
          <RocketOutlined />
          {isMobile ? ' 模型' : ' 模型先知'}
        </span>
      ),
      children: <ModelExplorer />,
    },
    {
      key: 'social-media',
      label: (
        <span>
          <ShareAltOutlined />
          {isMobile ? ' 社交' : ' 社交平台'}
        </span>
      ),
      children: <SocialMediaReport />,
    },
    {
      key: 'statistics',
      label: (
        <span>
          <BarChartOutlined />
          {isMobile ? ' 统计' : ' 数据统计'}
        </span>
      ),
      children: <Statistics />,
    },
  ];

  const contentStyle: CSSProperties = {
    padding: isMobile ? '12px' : '24px',
    background: theme === 'dark' ? '#1a1a1a' : '#f0f2f5',
    minHeight: isMobile ? 'calc(100vh - 120px)' : 'calc(100vh - 64px)',
  };

  return (
    <Layout style={{ minHeight: '100vh' }} className={isMobile ? 'mobile-safe-bottom' : undefined}>
      <GlobalNavigation onSettingsClick={() => setSettingsDrawerOpen(true)} />
      <Layout>
        <Content style={contentStyle}>
          <Tabs
            activeKey={selectedTab}
            onChange={setSelectedTab}
            items={tabs}
            size={isMobile ? 'small' : 'large'}
            className={isMobile ? 'mobile-tab-bar' : undefined}
          />
        </Content>
      </Layout>

      <AIConversationModal />

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>系统设置</span>
            <Space>
              {isAuthenticated ? (
                <>
                  <span style={{ marginRight: 8 }}>{username}</span>
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
        styles={{
          body: {
            padding: 0,
          },
        }}
      >
        <div style={{ padding: isMobile ? '12px' : '24px' }}>
          <SystemSettings />
        </div>
      </Drawer>
    </Layout>
  );
}
