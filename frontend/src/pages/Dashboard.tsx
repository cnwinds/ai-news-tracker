/**
 * Dashboard 主页面
 */
import { useState, useEffect } from 'react';
import { Layout, Tabs, Drawer } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SystemSettings from '@/components/SystemSettings';
import GlobalNavigation from '@/components/GlobalNavigation';
import AIConversationModal from '@/components/AIConversationModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useQueryClient } from '@tanstack/react-query';

const { Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme } = useTheme();
  const queryClient = useQueryClient();

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
  const contentStyle = {
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
        title="系统设置"
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
