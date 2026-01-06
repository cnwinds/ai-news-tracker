/**
 * Dashboard 主页面
 */
import { useState } from 'react';
import { Layout, Tabs } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ReadOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SystemSettings from '@/components/SystemSettings';
import GlobalNavigation from '@/components/GlobalNavigation';
import AIConversationModal from '@/components/AIConversationModal';
import { useTheme } from '@/contexts/ThemeContext';

const { Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const { theme } = useTheme();

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
    {
      key: 'system',
      label: (
        <span>
          <ToolOutlined />
          系统功能
        </span>
      ),
      children: <SystemSettings />,
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
      <GlobalNavigation />
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
    </Layout>
  );
}