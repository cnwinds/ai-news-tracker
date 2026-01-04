/**
 * Dashboard 主页面
 */
import { useState } from 'react';
import { Layout, Tabs, Badge } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ReadOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import ArticleList from '@/components/ArticleList';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import RAG from '@/components/RAG';
import SystemSettings from '@/components/SystemSettings';
import { useWebSocket } from '@/hooks/useWebSocket';

const { Header, Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const { connected } = useWebSocket();

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
        <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>
          🤖 AI News Tracker
        </div>
        <div style={{ marginLeft: 'auto', color: '#fff' }}>
          <Badge status={connected ? 'success' : 'error'} text={connected ? '已连接' : '未连接'} />
        </div>
      </Header>
      <Layout>
        <Content style={{ padding: '24px', background: '#f0f2f5' }}>
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

