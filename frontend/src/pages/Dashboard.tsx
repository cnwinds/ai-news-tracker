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
import KnowledgeGraphPanel from '@/components/KnowledgeGraphPanel';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useMessage } from '@/hooks/useMessage';

const { Content } = Layout;

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('articles');
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme } = useTheme();
  const { isAuthenticated, username, logout } = useAuth();
  const { graphCommand } = useKnowledgeGraphView();
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
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-settings'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-stats'] });
  }, [queryClient, settingsDrawerOpen]);

  useEffect(() => {
    if (!graphCommand?.id) {
      return;
    }
    setSelectedTab('knowledge-graph');
  }, [graphCommand?.id]);

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
      key: 'knowledge-graph',
      label: (
        <span>
          <ApartmentOutlined />
          知识图谱
        </span>
      ),
      children: <KnowledgeGraphPanel />,
    },
    {
      key: 'exploration',
      label: (
        <span>
          <RocketOutlined />
          模型先知
        </span>
      ),
      children: <ModelExplorer />,
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
