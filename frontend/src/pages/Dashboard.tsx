/**
 * Dashboard 主页面
 */
import { useState, useEffect } from 'react';
import { Layout, Menu, Tabs, Badge } from 'antd';
import {
  FileTextOutlined,
  HistoryOutlined,
  BarChartOutlined,
  SettingOutlined,
  DeleteOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import ArticleList from '@/components/ArticleList';
import CollectionHistory from '@/components/CollectionHistory';
import DailySummary from '@/components/DailySummary';
import Statistics from '@/components/Statistics';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import { useWebSocket } from '@/hooks/useWebSocket';

const { Header, Content, Sider } = Layout;

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
      key: 'collection',
      label: (
        <span>
          <HistoryOutlined />
          采集历史
        </span>
      ),
      children: <CollectionHistory />,
    },
    {
      key: 'sources',
      label: (
        <span>
          <SettingOutlined />
          订阅源管理
        </span>
      ),
      children: <SourceManagement />,
    },
    {
      key: 'cleanup',
      label: (
        <span>
          <DeleteOutlined />
          数据清理
        </span>
      ),
      children: <DataCleanup />,
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

