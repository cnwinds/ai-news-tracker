/**
 * Dashboard 主页面
 */
import { useState } from 'react';
import { Layout, Tabs, Badge, Button, Space } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ReadOutlined,
  SearchOutlined,
  ToolOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import RAG from '@/components/RAG';
import SystemSettings from '@/components/SystemSettings';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTheme } from '@/contexts/ThemeContext';

const { Header, Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const { connected } = useWebSocket();
  const { theme, toggleTheme } = useTheme();

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
      key: 'rag',
      label: (
        <span>
          <SearchOutlined />
          智能搜索
        </span>
      ),
      children: <RAG />,
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

  // 根据主题设置 Header 背景色 - 统一使用深灰色，避免割裂感
  const headerStyle = {
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    background: theme === 'dark' ? '#1a1a1a' : '#001529',
    borderBottom: theme === 'dark' ? '1px solid #303030' : 'none',
  };

  // 根据主题设置 Content 背景色 - 使用统一的深灰色，与头部协调
  const contentStyle = {
    padding: '24px',
    background: theme === 'dark' ? '#1a1a1a' : '#f0f2f5',
    minHeight: 'calc(100vh - 64px)',
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={headerStyle}>
        <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>
          🤖 AI News Tracker
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Space>
            <Button
              type="text"
              icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{ color: '#fff' }}
              title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            >
              {theme === 'dark' ? '浅色' : '深色'}
            </Button>
            <Badge 
              status={connected ? 'success' : 'error'} 
              text={<span style={{ color: '#fff' }}>{connected ? '已连接' : '未连接'}</span>} 
            />
          </Space>
        </div>
      </Header>
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
    </Layout>
  );
}

