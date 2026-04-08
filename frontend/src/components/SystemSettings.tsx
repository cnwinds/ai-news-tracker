import { Alert, Tabs } from 'antd';

import { useAuth } from '@/contexts/AuthContext';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import CollectionHistory from '@/components/CollectionHistory';
import AccessAnalytics from '@/components/AccessAnalytics';
import {
  DatabaseSettingsTab,
  ImageSettingsTab,
  KnowledgeGraphSettingsTab,
  LLMSettingsTab,
  NotificationSettingsTab,
  PasswordSettingsTab,
  RAGSettingsTab,
  SocialMediaSettingsTab,
  SummarySettingsTab,
} from './settings';

export default function SystemSettings() {
  const { isAuthenticated } = useAuth();

  const tabItems = [
    {
      key: 'llm',
      label: 'LLM 配置',
      children: <LLMSettingsTab />,
    },
    {
      key: 'image',
      label: '文生图配置',
      children: <ImageSettingsTab />,
    },
    {
      key: 'notification',
      label: '通知配置',
      children: <NotificationSettingsTab />,
    },
    {
      key: 'summary',
      label: '自动总结',
      children: <SummarySettingsTab />,
    },
    {
      key: 'collection',
      label: '采集日志',
      children: <CollectionHistory />,
    },
    {
      key: 'sources',
      label: '订阅管理',
      children: <SourceManagement />,
    },
    {
      key: 'cleanup',
      label: '数据维护',
      children: <DataCleanup />,
    },
    {
      key: 'access-analytics',
      label: '访问统计',
      children: <AccessAnalytics />,
    },
    {
      key: 'rag-index',
      label: 'RAG 索引管理',
      children: <RAGSettingsTab />,
    },
    {
      key: 'knowledge-graph',
      label: '知识图谱',
      children: <KnowledgeGraphSettingsTab />,
    },
    {
      key: 'password',
      label: '修改密码',
      children: <PasswordSettingsTab />,
    },
    {
      key: 'social-media',
      label: '社交平台设置',
      children: <SocialMediaSettingsTab />,
    },
    {
      key: 'database',
      label: '数据库管理',
      children: <DatabaseSettingsTab />,
    },
  ];

  return (
    <div>
      {!isAuthenticated && (
        <Alert
          message="只读模式"
          description="当前未登录，只能查看配置，无法保存修改。请先登录后再进行系统设置。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs items={tabItems} />
    </div>
  );
}
