/**
 * Dashboard 主页面
 */
import { useState, useEffect, type CSSProperties } from 'react';
import { Layout, Tabs, Drawer, Button, Space } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ReadOutlined,
  LoginOutlined,
  LogoutOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SystemSettings from '@/components/SystemSettings';
import GlobalNavigation from '@/components/GlobalNavigation';
import AIConversationModal from '@/components/AIConversationModal';
import SocialMediaReport from '@/components/SocialMediaReport';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { useMessage } from '@/hooks/useMessage';

const { Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme } = useTheme();
  const { isAuthenticated, username, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useMessage();

  // 当打开设置页面时，自动刷新数据
  useEffect(() => {
    if (settingsDrawerOpen) {
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    }
  }, [settingsDrawerOpen, queryClient]);

  const tabs = [
    {
      key: 'articles',
      label: (
        <span>
          <FileTextOutlined />
          文章列表
        </span>
      ),
      children: <ArticleList />,
    },
    {
      key: 'summary',
      label: (
        <span>
          <ReadOutlined />
          内容总结
        </span>
      ),
      children: <DailySummary />,
    },
    {
      key: 'social-media',
      label: (
        <span>
          <ShareAltOutlined />
          社交平台
        </span>
      ),
      children: <SocialMediaReport />,
    },
    {
      key: 'statistics',
      label: (
        <span>
          <BarChartOutlined />
          数据统计
        </span>
      ),
      children: <Statistics />,
    },
  ];

  // 根据主题设置 Content 背景色
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
            onChange={setSelectedTab}
            items={tabs}
            size="large"
          />
        </Content>
      </Layout>
      <AIConversationModal />
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                      message.success('已登出');
                      navigate('/');
                    }}
                  >
                    登出
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
        width={800}
        open={settingsDrawerOpen}
        onClose={() => setSettingsDrawerOpen(false)}
        styles={{
          body: {
            padding: 0,
          },
        }}
      >
        <div style={{ padding: '24px' }}>
          <SystemSettings />
        </div>
      </Drawer>
    </Layout>
  );
}
