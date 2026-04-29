import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Drawer,
  List,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { HistoryOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { apiService } from '@/services/api';
import type {
  KnowledgeGraphBuildSummary,
  KnowledgeGraphIntegrityRepairResponse,
  KnowledgeGraphIntegrityReport,
} from '@/types';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

const { Text, Title } = Typography;

type SyncRunMode = 'auto' | 'agent' | 'deterministic';

type IntegrityStatusFeedback = {
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
  description: ReactNode;
};

function formatBuildStatus(status: KnowledgeGraphBuildSummary['status']) {
  if (status === 'completed') return { color: 'success', text: '已完成' };
  if (status === 'running') return { color: 'processing', text: '运行中' };
  if (status === 'failed') return { color: 'error', text: '失败' };
  return { color: 'default', text: '等待中' };
}

function truncateMiddle(text: string, head = 140, tail = 80) {
  if (!text) return text;
  const minLength = head + tail + 3;
  if (text.length <= minLength) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function formatIntegrityStatus(report?: KnowledgeGraphIntegrityReport | null): IntegrityStatusFeedback {
  if (!report) {
    return {
      type: 'info',
      message: '尚未运行图谱完整性诊断',
      description: '诊断修复会优先清理结构问题并重建快照，不会默认逐篇重建图谱。',
    };
  }
  const errorCount = report.issues.filter((i) => i.severity === 'error').length;
  const warningCount = report.issues.filter((i) => i.severity === 'warning').length;
  if (errorCount > 0) {
    return {
      type: 'error',
      message: `仍有 ${errorCount} 个严重问题`,
      description: report.recommendations.join(' '),
    };
  }
  if (warningCount > 0) {
    return {
      type: 'warning',
      message: `发现 ${warningCount} 个待关注问题`,
      description: report.recommendations.join(' '),
    };
  }
  return {
    type: 'success',
    message: '图谱完整性正常',
    description: report.recommendations.join(' '),
  };
}

function formatIntegrityRepairStatus(response: KnowledgeGraphIntegrityRepairResponse): IntegrityStatusFeedback {
  const latestReport = response.after || response.before;
  const baseStatus = formatIntegrityStatus(latestReport);
  const repairDetails = [
    response.actions.length ? `执行动作：${response.actions.join('、')}。` : '',
    response.deleted_dangling_edges ? `清理悬空边 ${response.deleted_dangling_edges} 条。` : '',
    response.deleted_orphan_nodes ? `清理孤立节点 ${response.deleted_orphan_nodes} 个。` : '',
    response.deleted_missing_article_states ? `清理无原文状态 ${response.deleted_missing_article_states} 条。` : '',
    response.resynced_article_ids.length ? `已重同步 ${response.resynced_article_ids.length} 篇可疑文章。` : '',
  ].filter(Boolean);
  const description = [baseStatus.description, ...repairDetails].filter(Boolean).join(' ');

  if (!latestReport.issues.length && !latestReport.suspect_article_ids.length) {
    return {
      type: 'success',
      message: '诊断修复完成，未发现需要继续处理的问题',
      description: description || '图谱完整性检查通过，快照已更新。',
    };
  }
  if (latestReport.suspect_article_ids.length) {
    return {
      type: 'warning',
      message: `诊断修复完成，仍有 ${latestReport.suspect_article_ids.length} 篇文章建议重同步`,
      description,
    };
  }
  return { ...baseStatus, message: `诊断修复完成：${baseStatus.message}`, description };
}

interface KnowledgeGraphMaintenanceDrawerProps {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
  snapshotUpdatedAt?: string | null;
  onRefresh: () => void;
}

export default function KnowledgeGraphMaintenanceDrawer({
  open,
  onClose,
  enabled,
  snapshotUpdatedAt,
  onRefresh,
}: KnowledgeGraphMaintenanceDrawerProps) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showInfo, showWarning } = useErrorHandler();

  const [syncMode, setSyncMode] = useState<SyncRunMode>('auto');
  const [maxArticles, setMaxArticles] = useState<number>(100);
  const [integrityReport, setIntegrityReport] = useState<KnowledgeGraphIntegrityReport | null>(null);
  const [integrityFeedback, setIntegrityFeedback] = useState<IntegrityStatusFeedback | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['knowledge-graph-settings'],
    queryFn: () => apiService.getKnowledgeGraphSettings(),
  });

  const { data: builds = [], isLoading: buildsLoading } = useQuery({
    queryKey: ['knowledge-graph-builds'],
    queryFn: () => apiService.getKnowledgeGraphBuilds(10),
    enabled: open,
  });

  useEffect(() => {
    if (!settings) return;
    setSyncMode(settings.run_mode);
    setMaxArticles(settings.max_articles_per_sync);
  }, [settings]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-settings'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-builds'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-communities'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-nodes'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-snapshot'] });
    onRefresh();
  };

  const syncMutation = useMutation({
    mutationFn: () =>
      apiService.syncKnowledgeGraph({
        force_rebuild: false,
        sync_mode: syncMode,
        max_articles: maxArticles,
        trigger_source: 'dashboard',
      }),
    onSuccess: (response) => {
      showSuccess(`知识图谱同步完成，处理 ${response.build.processed_articles} 篇文章`);
      refreshAll();
    },
    onError: createErrorHandler({
      operationName: '执行知识图谱同步',
      customMessages: { auth: '需要登录后才能执行知识图谱同步' },
    }),
  });

  const integrityRepairMutation = useMutation({
    mutationFn: ({ resyncSuspects }: { resyncSuspects: boolean }) =>
      apiService.repairKnowledgeGraphIntegrity({
        dry_run: false,
        cleanup_orphans: true,
        rebuild_snapshot: true,
        resync_suspects: resyncSuspects,
        limit: maxArticles,
        sync_mode: syncMode,
      }),
    onMutate: ({ resyncSuspects }: { resyncSuspects: boolean }) => {
      if (!resyncSuspects) setIntegrityReport(null);
      setIntegrityFeedback({
        type: 'info',
        message: resyncSuspects ? '正在重同步可疑文章' : '正在执行图谱诊断修复',
        description: resyncSuspects
          ? '正在对诊断发现的可疑文章做精准重同步，请稍候。'
          : '正在清理结构问题并重建图谱快照，请稍候。',
      });
    },
    onSuccess: (response) => {
      const latestReport = response.after || response.before;
      setIntegrityReport(latestReport);
      setIntegrityFeedback(formatIntegrityRepairStatus(response));
      if (response.resynced_article_ids.length) {
        showSuccess(`诊断修复完成，已重同步 ${response.resynced_article_ids.length} 篇可疑文章`);
      } else if (latestReport.suspect_article_ids.length) {
        showInfo(`诊断修复完成，仍有 ${latestReport.suspect_article_ids.length} 篇文章建议精准重同步`);
      } else {
        showSuccess('诊断修复完成，图谱快照已更新');
      }
      refreshAll();
    },
    onError: (error) => {
      setIntegrityFeedback({
        type: 'error',
        message: '诊断修复失败',
        description: getFriendlyErrorMessage(error, '请检查后端服务是否正常'),
      });
      createErrorHandler({
        operationName: '执行图谱诊断修复',
        customMessages: { auth: '需要登录后才能执行图谱诊断修复' },
      })(error);
    },
  });

  const handleSync = () => {
    if (!isAuthenticated) { showWarning('需要登录后才能执行知识图谱同步'); return; }
    syncMutation.mutate();
  };

  const handleRepair = (resyncSuspects: boolean) => {
    if (!isAuthenticated) { showWarning('需要登录后才能执行图谱诊断修复'); return; }
    integrityRepairMutation.mutate({ resyncSuspects });
  };

  const integrityStatus = integrityFeedback ?? formatIntegrityStatus(integrityReport);
  const canResyncSuspects = Boolean(integrityReport?.suspect_article_ids.length);
  const isRepairingWithResync = integrityRepairMutation.isPending && Boolean(integrityRepairMutation.variables?.resyncSuspects);
  const isRepairingStructure = integrityRepairMutation.isPending && !isRepairingWithResync;

  const syncModeLabel = syncMode === 'agent' ? 'Agent' : syncMode === 'deterministic' ? '确定性' : '自动';

  return (
    <Drawer
      title={
        <Space>
          <HistoryOutlined />
          <span>运维管理</span>
        </Space>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>同步与修复</Title>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Select<SyncRunMode>
                value={syncMode}
                onChange={setSyncMode}
                style={{ minWidth: 150 }}
                options={[
                  { label: '自动', value: 'auto' },
                  { label: 'Agent', value: 'agent' },
                  { label: '确定性', value: 'deterministic' },
                ]}
              />
              <Select<number>
                value={maxArticles}
                onChange={setMaxArticles}
                style={{ minWidth: 150 }}
                options={[50, 100, 200, 500].map((v) => ({ label: `最多 ${v} 篇`, value: v }))}
              />
            </Space>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={refreshAll}>
                刷新数据
              </Button>
              <Button
                type="primary"
                icon={<SyncOutlined />}
                loading={syncMutation.isPending}
                disabled={!enabled || integrityRepairMutation.isPending}
                onClick={handleSync}
              >
                增量同步
              </Button>
              <Button
                loading={isRepairingStructure}
                disabled={!enabled || syncMutation.isPending}
                onClick={() => handleRepair(false)}
              >
                诊断修复
              </Button>
              {canResyncSuspects && (
                <Button
                  danger
                  loading={isRepairingWithResync}
                  disabled={!enabled || syncMutation.isPending}
                  onClick={() => handleRepair(true)}
                >
                  重同步可疑文章
                </Button>
              )}
            </Space>
            <Alert
              type={integrityStatus.type}
              showIcon
              message={integrityStatus.message}
              description={integrityStatus.description}
            />
            {integrityReport?.issues.length ? (
              <List
                size="small"
                dataSource={integrityReport.issues.slice(0, 5)}
                renderItem={(issue) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={issue.severity === 'error' ? 'red' : 'orange'}>{issue.code}</Tag>
                        <Text>{issue.message}</Text>
                      </Space>
                      <Text type="secondary">
                        数量 {issue.count}
                        {issue.samples.length ? ` · 样例 ${issue.samples.slice(0, 3).join(', ')}` : ''}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : null}
          </Space>
        </div>

        <div>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>运行状态</Title>
          <Space wrap size={[8, 8]}>
            <Tag color={settings?.enabled ? 'success' : 'warning'}>
              {settings?.enabled ? '图谱已启用' : '图谱未启用'}
            </Tag>
            <Tag>自动同步 {settings?.auto_sync_enabled ? '开启' : '关闭'}</Tag>
            <Tag>运行模式 {syncModeLabel}</Tag>
            <Tag>查询深度 {settings?.query_depth ?? '-'}</Tag>
            {snapshotUpdatedAt && (
              <Tag>快照更新 {dayjs(snapshotUpdatedAt).format('MM-DD HH:mm')}</Tag>
            )}
          </Space>
        </div>

        <div>
          <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>构建历史</Title>
          <List
            size="small"
            loading={buildsLoading}
            dataSource={builds}
            locale={{ emptyText: '暂无构建记录' }}
            renderItem={(build) => {
              const status = formatBuildStatus(build.status);
              return (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap>
                      <Text strong>{build.build_id.slice(0, 12)}</Text>
                      <Tag color={status.color}>{status.text}</Tag>
                      <Tag>{dayjs(build.started_at).format('MM-DD HH:mm')}</Tag>
                    </Space>
                    <Text type="secondary">
                      {build.trigger_source} · {build.sync_mode} · 处理{' '}
                      {build.processed_articles}/{build.total_articles}
                    </Text>
                    <Text type="secondary">
                      跳过 {build.skipped_articles} · 失败 {build.failed_articles} · 节点{' '}
                      {build.nodes_upserted} · 边 {build.edges_upserted}
                    </Text>
                    {build.error_message && (
                      <Tooltip title={build.error_message}>
                        <Text type="danger">{truncateMiddle(build.error_message)}</Text>
                      </Tooltip>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        </div>
      </Space>
    </Drawer>
  );
}
