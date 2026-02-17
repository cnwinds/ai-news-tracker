/**
 * 模型先知组件
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  FileTextOutlined,
  GithubOutlined,
  RocketOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';

import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import type {
  DiscoveredModel,
  DiscoveredModelListResponse,
  ExplorationReport,
  ExplorationConfig,
  ExplorationTask,
  ExplorationTaskCreateRequest,
} from '@/types';

const { Text } = Typography;
const { Search } = Input;

const PAGE_SIZE = 20;
const LIST_FETCH_LIMIT = 100;
const DEFAULT_MIN_SCORE = 40;
const MONITOR_SOURCES: ExplorationTaskCreateRequest['sources'] = [
  'github',
  'huggingface',
  'modelscope',
  'arxiv',
];
const DEFAULT_WATCH_ORGS = [
  'openai',
  'anthropic',
  'google-deepmind',
  'meta-llama',
  'mistralai',
  'deepseek-ai',
  'qwen',
  'zhipuai',
  'THUDM',
  'internlm',
];
const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  monitor_sources: MONITOR_SOURCES,
  watch_organizations: DEFAULT_WATCH_ORGS,
  min_score: 40,  // 降低默认阈值以捕获更多模型
  days_back: 2,
  max_results_per_source: 30,
  run_mode: 'auto',
  auto_monitor_enabled: false,
  auto_monitor_interval_hours: 24,
};

function formatDate(date?: string): string {
  if (!date) return '-';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function getScoreColor(score?: number): string {
  if (!score) return '#8c8c8c';
  if (score >= 80) return '#52c41a';
  if (score >= 70) return '#1890ff';
  return '#faad14';
}

function sourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized === 'huggingface') return 'Hugging Face';
  if (normalized === 'modelscope') return 'ModelScope';
  if (normalized === 'github') return 'GitHub';
  if (normalized === 'arxiv') return 'arXiv';
  return source;
}

function stageLabel(stage: string): string {
  const normalized = (stage || '').toLowerCase();
  if (normalized === 'queued') return '排队中';
  if (normalized === 'discovery') return '更新监测';
  if (normalized === 'evaluation') return '质量评估';
  if (normalized === 'analysis') return '候选研判';
  if (normalized === 'report_generation') return '报告生成';
  if (normalized === 'completed') return '已完成';
  if (normalized === 'failed') return '失败';
  return stage || '未知阶段';
}

function getExtraData(model: DiscoveredModel): Record<string, unknown> {
  if (model.extra_data && typeof model.extra_data === 'object' && !Array.isArray(model.extra_data)) {
    return model.extra_data;
  }
  return {};
}

function getExtraString(model: DiscoveredModel, key: string): string {
  const value = getExtraData(model)[key];
  return typeof value === 'string' ? value : '';
}

function getExtraNumber(model: DiscoveredModel, key: string): number | undefined {
  const value = getExtraData(model)[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeItem(value: string): string {
  return value.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '').trim();
}

function buildFullReportMarkdown(report: ExplorationReport): string {
  const full = (report.full_report || '').trim();
  if (full) return full;

  const lines: string[] = [report.title ? `# ${report.title}` : '# 模型先知报告', ''];
  if (report.summary) {
    lines.push('## 摘要', report.summary, '');
  }
  if (report.highlights && report.highlights.length > 0) {
    lines.push('## 关键发现', ...report.highlights.map((item) => `- ${normalizeItem(item)}`), '');
  }
  if (report.technical_analysis) {
    lines.push('## 技术分析', report.technical_analysis, '');
  }
  if (report.performance_analysis) {
    lines.push('## 性能与基准', report.performance_analysis, '');
  }
  if (report.code_analysis) {
    lines.push('## 工程实现', report.code_analysis, '');
  }
  return lines.join('\n').trim();
}

export default function ModelExplorer() {
  const { isAuthenticated } = useAuth();
  const { theme } = useTheme();

  const [modelType, setModelType] = useState<string | undefined>(undefined);
  const [sourcePlatform, setSourcePlatform] = useState<string | undefined>(undefined);
  const [minScore, setMinScore] = useState<number>(DEFAULT_MIN_SCORE);
  const [searchText, setSearchText] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [page, setPage] = useState(1);

  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [explorationConfigState, setExplorationConfigState] = useState<ExplorationConfig>(
    DEFAULT_EXPLORATION_CONFIG
  );

  const [latestTaskId, setLatestTaskId] = useState<string | null>(null);
  const [reportTaskId, setReportTaskId] = useState<string | null>(null);
  const [isTaskActive, setIsTaskActive] = useState(false);
  const [modelsWithoutReports, setModelsWithoutReports] = useState<Set<number>>(new Set());
  const [creatingReportModelId, setCreatingReportModelId] = useState<number | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ExplorationReport | null>(null);

  const queryClient = useQueryClient();
  const [configForm] = Form.useForm<ExplorationConfig>();
  const autoMonitorEnabledInForm = Form.useWatch('auto_monitor_enabled', configForm);
  const markdownComponents = useMemo(() => createMarkdownComponents(theme), [theme]);

  const { data: explorationConfig, isLoading: configLoading } = useQuery<ExplorationConfig>({
    queryKey: ['exploration-config'],
    queryFn: () => apiService.getExplorationConfig(),
  });

  const {
    data: reportedModelsData,
    isLoading: reportedLoading,
  } = useQuery({
    queryKey: ['discovered-models', modelType, sourcePlatform, minScore, searchValue],
    queryFn: () =>
      apiService.getDiscoveredModels({
        sort_by: 'final_score',
        order: 'desc',
        min_score: minScore,
        model_type: modelType,
        source_platform: sourcePlatform,
        has_report: true,
        q: searchValue || undefined,
        limit: LIST_FETCH_LIMIT,
        offset: 0,
      }),
  });

  const {
    data: candidateModelsData,
    isLoading: candidateLoading,
  } = useQuery({
    queryKey: ['exploration-candidates', modelType, sourcePlatform, minScore, searchValue],
    queryFn: () =>
      apiService.getDiscoveredModels({
        sort_by: 'final_score',
        order: 'desc',
        min_score: minScore,
        model_type: modelType,
        source_platform: sourcePlatform,
        has_report: false,
        min_release_confidence: 60,
        q: searchValue || undefined,
        limit: LIST_FETCH_LIMIT,
        offset: 0,
      }),
  });

  const { data: taskStatus } = useQuery<ExplorationTask>({
    queryKey: ['exploration-task-status', latestTaskId],
    queryFn: () => apiService.getExplorationTask(latestTaskId as string),
    enabled: Boolean(latestTaskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 3000;
      return status === 'running' || status === 'pending' ? 3000 : false;
    },
  });

  const { data: reportTaskStatus } = useQuery<ExplorationTask>({
    queryKey: ['exploration-report-task-status', reportTaskId],
    queryFn: () => apiService.getExplorationTask(reportTaskId as string),
    enabled: Boolean(reportTaskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 2000;
      return status === 'running' || status === 'pending' ? 2000 : false;
    },
  });

  const lastNotifiedTaskStatus = useRef<string | null>(null);
  const lastNotifiedReportTaskStatus = useRef<string | null>(null);

  useEffect(() => {
    lastNotifiedReportTaskStatus.current = null;
  }, [reportTaskId]);

  const mergedModels = useMemo(() => {
    const isReportAvailable = (model: DiscoveredModel): boolean =>
      model.status === 'reported' && !modelsWithoutReports.has(model.id);
    const map = new Map<number, DiscoveredModel>();
    const upsert = (model: DiscoveredModel): void => {
      const existing = map.get(model.id);
      if (!existing) {
        map.set(model.id, model);
        return;
      }
      if (!isReportAvailable(existing) && isReportAvailable(model)) {
        map.set(model.id, model);
      }
    };

    for (const model of reportedModelsData?.models || []) upsert(model);
    for (const model of candidateModelsData?.models || []) upsert(model);

    return Array.from(map.values()).sort((a, b) => {
      const aHasReport = isReportAvailable(a) ? 1 : 0;
      const bHasReport = isReportAvailable(b) ? 1 : 0;
      if (aHasReport !== bHasReport) return bHasReport - aHasReport;

      const aConfidence = getExtraNumber(a, 'release_confidence') ?? 0;
      const bConfidence = getExtraNumber(b, 'release_confidence') ?? 0;
      if (aConfidence !== bConfidence) return bConfidence - aConfidence;

      const aScore = a.final_score ?? 0;
      const bScore = b.final_score ?? 0;
      if (aScore !== bScore) return bScore - aScore;

      return a.model_name.localeCompare(b.model_name);
    });
  }, [candidateModelsData?.models, modelsWithoutReports, reportedModelsData?.models]);

  const pagedModels = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return mergedModels.slice(start, start + PAGE_SIZE);
  }, [mergedModels, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(mergedModels.length / PAGE_SIZE));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [mergedModels.length, page]);

  useEffect(() => {
    if (!explorationConfig) return;
    setExplorationConfigState(explorationConfig);
    configForm.setFieldsValue(explorationConfig);
  }, [configForm, explorationConfig]);

  useEffect(() => {
    if (!taskStatus?.status) return;
    if (lastNotifiedTaskStatus.current === taskStatus.status) return;

    lastNotifiedTaskStatus.current = taskStatus.status;
    if (taskStatus.status === 'completed') {
      setIsTaskActive(false);
      void queryClient.invalidateQueries({ queryKey: ['discovered-models'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
      message.success('模型先知任务已完成');
    } else if (taskStatus.status === 'failed') {
      setIsTaskActive(false);
      message.error(taskStatus.error_message || '模型先知任务执行失败');
    } else if (taskStatus.status === 'running' || taskStatus.status === 'pending') {
      setIsTaskActive(true);
    }
  }, [queryClient, taskStatus]);

  const startExplorationMutation = useMutation({
    mutationFn: () =>
      apiService.startExplorationTask({
        sources: explorationConfigState.monitor_sources,
        min_score: explorationConfigState.min_score,
        days_back: explorationConfigState.days_back,
        max_results_per_source: explorationConfigState.max_results_per_source,
        watch_organizations: explorationConfigState.watch_organizations.filter((item) => item.trim()),
        run_mode: explorationConfigState.run_mode,
      }),
    onSuccess: (data) => {
      setIsTaskActive(true);
      setLatestTaskId(data.task_id);
      message.success('模型先知任务已启动');
      void queryClient.invalidateQueries({ queryKey: ['exploration-task-list'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
    },
    onError: (error) => {
      setIsTaskActive(false);
      const msg = error instanceof Error ? error.message : '启动任务失败';
      message.error(msg);
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: (payload: ExplorationConfig) => apiService.updateExplorationConfig(payload),
    onSuccess: (data) => {
      setExplorationConfigState(data);
      configForm.setFieldsValue(data);
      setConfigModalVisible(false);
      message.success('模型先知配置已保存');
      void queryClient.invalidateQueries({ queryKey: ['exploration-config'] });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : '保存配置失败';
      message.error(msg);
    },
  });

  const markModelNoReport = (modelId: number): void => {
    setModelsWithoutReports((prev) => {
      if (prev.has(modelId)) return prev;
      const next = new Set(prev);
      next.add(modelId);
      return next;
    });

    queryClient.setQueriesData<DiscoveredModelListResponse>({ queryKey: ['discovered-models'] }, (oldData) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        models: oldData.models.map((model) =>
          model.id === modelId ? { ...model, status: 'evaluated' } : model
        ),
      };
    });
  };

  const removeModelFromListCache = (modelId: number): void => {
    queryClient.setQueriesData<DiscoveredModelListResponse>({ queryKey: ['discovered-models'] }, (oldData) => {
      if (!oldData) return oldData;
      if (!oldData.models.some((item) => item.id === modelId)) return oldData;
      return {
        ...oldData,
        models: oldData.models.filter((item) => item.id !== modelId),
        total: Math.max(0, oldData.total - 1),
      };
    });
  };

  const deleteReportMutation = useMutation({
    mutationFn: (reportId: string) => apiService.deleteExplorationReport(reportId),
    onSuccess: (data) => {
      const fallbackModelId = selectedReport?.model_id;
      const modelId = data.model_id ?? fallbackModelId;
      const remainingReports = data.remaining_reports;
      if (typeof modelId === 'number' && (remainingReports === undefined || remainingReports <= 0)) {
        removeModelFromListCache(modelId);
        markModelNoReport(modelId);
      }

      message.success('报告已删除');
      setReportModalVisible(false);
      setSelectedReport(null);
      void queryClient.invalidateQueries({ queryKey: ['discovered-models'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
    },
    onError: (error) => {
      const msg =
        typeof (error as { message?: unknown })?.message === 'string'
          ? (error as { message: string }).message
          : '删除报告失败';
      message.error(msg);
    },
  });

  const openReportById = async (reportId: string): Promise<void> => {
    const report = await apiService.getExplorationReport(reportId);
    setSelectedReport(report);
    setReportModalVisible(true);
  };

  const generateReportMutation = useMutation({
    mutationFn: (modelId: number) => apiService.generateExplorationReport(modelId, { run_mode: 'auto' }),
    onMutate: (modelId: number) => {
      setCreatingReportModelId(modelId);
    },
    onSuccess: (data) => {
      setReportTaskId(data.task_id);
      message.info('报告生成任务已提交，正在后台执行');
    },
    onError: (error) => {
      setCreatingReportModelId(null);
      setReportTaskId(null);
      const msg =
        typeof (error as { message?: unknown })?.message === 'string'
          ? (error as { message: string }).message
          : '生成报告失败';
      message.error(msg);
    },
  });

  const fetchLatestReport = async (modelId: number): Promise<void> => {
    try {
      const detail = await apiService.getExplorationModel(modelId);
      if (!detail.reports.length) {
        markModelNoReport(modelId);
        void queryClient.invalidateQueries({ queryKey: ['discovered-models'] });
        void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
        void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
        message.info('该模型暂无报告');
        return;
      }
      await openReportById(detail.reports[0].report_id);
    } catch (error) {
      const apiError = error as { status?: number; message?: string };
      if (apiError?.status === 404) {
        markModelNoReport(modelId);
        void queryClient.invalidateQueries({ queryKey: ['discovered-models'] });
        void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
        void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
        message.info('该模型暂无报告');
        return;
      }
      const msg = typeof apiError?.message === 'string' ? apiError.message : '加载报告失败';
      message.error(msg);
    }
  };

  useEffect(() => {
    if (!reportTaskStatus?.status || !reportTaskId) return;

    const statusKey = `${reportTaskId}:${reportTaskStatus.status}`;
    if (lastNotifiedReportTaskStatus.current === statusKey) return;
    lastNotifiedReportTaskStatus.current = statusKey;

    if (reportTaskStatus.status === 'completed') {
      const progress = (reportTaskStatus.progress || {}) as Record<string, unknown>;
      const completedReportId =
        typeof progress.report_id === 'string' && progress.report_id.trim() ? progress.report_id : undefined;
      const completedModelId =
        typeof progress.model_id === 'number' ? progress.model_id : creatingReportModelId;

      if (typeof completedModelId === 'number') {
        setModelsWithoutReports((prev) => {
          if (!prev.has(completedModelId)) return prev;
          const next = new Set(prev);
          next.delete(completedModelId);
          return next;
        });
      }

      setReportTaskId(null);
      setCreatingReportModelId(null);
      void queryClient.invalidateQueries({ queryKey: ['discovered-models'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['exploration-statistics'] });
      message.success('报告生成成功');

      if (completedReportId) {
        void openReportById(completedReportId).catch((error: unknown) => {
          const apiError = error as { message?: string };
          const msg = typeof apiError?.message === 'string' ? apiError.message : '加载报告失败';
          message.error(msg);
        });
      } else if (typeof completedModelId === 'number') {
        void fetchLatestReport(completedModelId);
      }
      return;
    }

    if (reportTaskStatus.status === 'failed') {
      setReportTaskId(null);
      setCreatingReportModelId(null);
      message.error(reportTaskStatus.error_message || '生成报告失败');
    }
  }, [creatingReportModelId, fetchLatestReport, queryClient, reportTaskId, reportTaskStatus]);

  const reportTaskInlineStatus = useMemo(() => {
    if (!reportTaskId || !reportTaskStatus) return '';

    if (reportTaskStatus.status === 'pending') return '排队中';
    if (reportTaskStatus.status === 'running') {
      const rawStage = (reportTaskStatus.progress?.current_stage || '').toLowerCase();
      if (rawStage === 'queued') return '排队中';
      if (rawStage === 'report_generation') return '生成中';
      return stageLabel(rawStage || 'report_generation');
    }
    if (reportTaskStatus.status === 'completed') return '已完成';
    if (reportTaskStatus.status === 'failed') return '失败';
    return '处理中';
  }, [reportTaskId, reportTaskStatus]);

  const columns: TableProps<DiscoveredModel>['columns'] = useMemo(
    () => [
      {
        title: '模型名称',
        dataIndex: 'model_name',
        key: 'model_name',
        width: 250,
        render: (value: string, record: DiscoveredModel) => (
          <Space direction="vertical" size={0}>
            <Text strong>{value}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.organization || 'Unknown'}
            </Text>
          </Space>
        ),
      },
      {
        title: '来源平台',
        dataIndex: 'source_platform',
        key: 'source_platform',
        width: 130,
        render: (value: string) => (
          <Tag icon={value === 'github' ? <GithubOutlined /> : undefined}>{sourceLabel(value)}</Tag>
        ),
      },
      {
        title: '更新信号',
        key: 'signal',
        width: 260,
        render: (_, record: DiscoveredModel) => {
          const updateType = getExtraString(record, 'update_type') || 'unknown';
          const updateSummary = getExtraString(record, 'update_summary') || '暂无更新说明';
          return (
            <Space direction="vertical" size={2} style={{ maxWidth: 240 }}>
              <Tag color={updateType === 'new_model_repo' || updateType === 'new_release_tag' ? 'blue' : 'default'}>
                {updateType}
              </Tag>
              <Tooltip title={updateSummary}>
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                  {updateSummary}
                </Text>
              </Tooltip>
            </Space>
          );
        },
      },
      {
        title: '发布置信度',
        key: 'release_confidence',
        width: 170,
        render: (_, record: DiscoveredModel) => {
          const confidence = getExtraNumber(record, 'release_confidence') ?? 0;
          return (
            <Space direction="vertical" size={2} style={{ width: 120 }}>
              <Text strong style={{ color: confidence >= 75 ? '#52c41a' : confidence >= 60 ? '#1890ff' : '#999' }}>
                {confidence.toFixed(1)} / 100
              </Text>
              <Progress
                percent={Math.max(0, Math.min(100, Math.round(confidence)))}
                showInfo={false}
                strokeColor={confidence >= 75 ? '#52c41a' : confidence >= 60 ? '#1890ff' : '#999'}
                size="small"
              />
            </Space>
          );
        },
      },
      {
        title: '综合评分',
        dataIndex: 'final_score',
        key: 'final_score',
        width: 150,
        render: (value?: number) => (
          <Space direction="vertical" size={2} style={{ width: 120 }}>
            <Text strong style={{ color: getScoreColor(value) }}>
              {value?.toFixed(1) ?? 'N/A'} / 100
            </Text>
            <Progress
              percent={Math.max(0, Math.min(100, Math.round(value ?? 0)))}
              showInfo={false}
              strokeColor={getScoreColor(value)}
              size="small"
            />
          </Space>
        ),
      },
      {
        title: '记录类型',
        key: 'record_type',
        width: 120,
        render: (_, record: DiscoveredModel) => {
          const canViewReport = record.status === 'reported' && !modelsWithoutReports.has(record.id);
          return canViewReport ? <Tag color="green">已生成报告</Tag> : <Tag color="gold">预警候选</Tag>;
        },
      },
      {
        title: '最近更新',
        key: 'last_updated',
        width: 170,
        render: (_, record: DiscoveredModel) => {
          const updatedAt = getExtraString(record, 'updated_at');
          return formatDate(updatedAt || record.release_date);
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 240,
        render: (_, record: DiscoveredModel) => {
          const canViewReport = record.status === 'reported' && !modelsWithoutReports.has(record.id);
          if (canViewReport) {
            return (
              <Button
                type="primary"
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => {
                  void fetchLatestReport(record.id);
                }}
              >
                查看报告
              </Button>
            );
          }

          if (!isAuthenticated) {
            return (
              <Button size="small" disabled>
                登录后生成
              </Button>
            );
          }

          const isCurrentRowGenerating =
            creatingReportModelId === record.id && (generateReportMutation.isPending || Boolean(reportTaskId));
          const inlineStatus = isCurrentRowGenerating
            ? reportTaskInlineStatus || (generateReportMutation.isPending ? '提交中' : '生成中')
            : '';
          return (
            <Space size={6}>
              <Button
                type="primary"
                size="small"
                loading={isCurrentRowGenerating}
                disabled={generateReportMutation.isPending || Boolean(reportTaskId)}
                onClick={() => {
                  generateReportMutation.mutate(record.id);
                }}
              >
                {isCurrentRowGenerating ? '生成中' : '生成报告'}
              </Button>
              {isCurrentRowGenerating ? (
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {inlineStatus}
                </Text>
              ) : null}
            </Space>
          );
        },
      },
    ],
    [
      creatingReportModelId,
      fetchLatestReport,
      generateReportMutation.isPending,
      generateReportMutation.mutate,
      isAuthenticated,
      modelsWithoutReports,
      reportTaskId,
      reportTaskInlineStatus,
    ]
  );

  const taskAlert = useMemo(() => {
    if (!taskStatus) return null;

    const stage = stageLabel(taskStatus.progress?.current_stage || 'unknown');
    const discovered = taskStatus.progress?.models_discovered || 0;
    const evaluated = taskStatus.progress?.models_evaluated || 0;
    const updates = taskStatus.progress?.updates_detected || 0;
    const candidates = taskStatus.progress?.release_candidates || 0;
    const reports = taskStatus.progress?.reports_generated || 0;

    if (taskStatus.status === 'failed') {
      return {
        type: 'error' as const,
        inline: `失败 | ${taskStatus.task_id} | ${taskStatus.error_message || '任务执行失败'}`,
      };
    }
    if (taskStatus.status === 'completed') {
      return {
        type: 'success' as const,
        inline: `完成 | ${taskStatus.task_id} | 更新 ${updates}，候选 ${candidates}，报告 ${reports}`,
      };
    }
    return {
      type: 'info' as const,
      inline: `执行中 | ${taskStatus.task_id} | ${stage}，发现 ${discovered}，评估 ${evaluated}，更新 ${updates}，候选 ${candidates}，报告 ${reports}`,
    };
  }, [taskStatus]);

  const monitorSourceSummary = useMemo(() => {
    const sources = explorationConfigState.monitor_sources || [];
    if (!sources.length) return '未配置';
    const first = sourceLabel(sources[0]);
    if (sources.length === 1) return first;
    return `${first} + ${sources.length - 1}`;
  }, [explorationConfigState.monitor_sources]);

  const handleSaveConfig = async (): Promise<void> => {
    try {
      const values = await configForm.validateFields();
      const payload: ExplorationConfig = {
        ...DEFAULT_EXPLORATION_CONFIG,
        ...values,
        monitor_sources: values.monitor_sources || [],
        watch_organizations: values.watch_organizations || [],
      };
      updateConfigMutation.mutate(payload);
    } catch {
      // 校验失败时由表单展示错误
    }
  };

  return (
    <div>
      {!isAuthenticated && (
        <Alert
          type="info"
          showIcon
          message="当前为只读模式，登录后可启动模型先知任务。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Space style={{ minWidth: 0 }} align="center" size={10}>
            {isAuthenticated ? (
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={() => {
                  startExplorationMutation.mutate();
                }}
                loading={startExplorationMutation.isPending}
                disabled={
                  startExplorationMutation.isPending ||
                  isTaskActive ||
                  (explorationConfigState.monitor_sources?.length || 0) === 0
                }
              >
                启动模型先知
              </Button>
            ) : null}
            {isAuthenticated ? (
              <Button
                icon={<SettingOutlined />}
                loading={configLoading}
                onClick={() => {
                  configForm.setFieldsValue(explorationConfigState);
                  setConfigModalVisible(true);
                }}
              >
                配置
              </Button>
            ) : null}
            {taskAlert ? (
              <div
                title={taskAlert.inline}
                style={{
                  minWidth: 0,
                  maxWidth: 860,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  lineHeight: 1.2,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: taskAlert.type === 'success' ? '#52c41a' : taskAlert.type === 'error' ? '#ff4d4f' : '#1677ff',
                  }}
                />
                <Text
                  style={{
                    marginBottom: 0,
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'inline-block',
                    maxWidth: '100%',
                  }}
                >
                  {taskAlert.inline}
                </Text>
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>
                配置监控范围后启动任务，系统将自动追踪预发布信号。
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              数据源: {monitorSourceSummary} | 组织: {explorationConfigState.watch_organizations.length} |
              自动监控: {explorationConfigState.auto_monitor_enabled
                ? `每 ${explorationConfigState.auto_monitor_interval_hours} 小时`
                : '关闭'}
            </Text>
          </Space>

          <Space wrap>
            <Search
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onSearch={(value) => {
                setSearchValue(value.trim());
                setPage(1);
              }}
              placeholder="搜索模型或组织"
              allowClear
              style={{ width: 220 }}
            />
            <Select
              placeholder="模型类型"
              style={{ width: 140 }}
              allowClear
              value={modelType}
              onChange={(value) => {
                setModelType(value);
                setPage(1);
              }}
            >
              <Select.Option value="LLM">LLM</Select.Option>
              <Select.Option value="Vision">Vision</Select.Option>
              <Select.Option value="Audio">Audio</Select.Option>
              <Select.Option value="Multimodal">Multimodal</Select.Option>
              <Select.Option value="Generative">Generative</Select.Option>
            </Select>
            <Select
              placeholder="来源平台"
              style={{ width: 150 }}
              allowClear
              value={sourcePlatform}
              onChange={(value) => {
                setSourcePlatform(value);
                setPage(1);
              }}
            >
              <Select.Option value="github">GitHub</Select.Option>
              <Select.Option value="huggingface">Hugging Face</Select.Option>
              <Select.Option value="modelscope">ModelScope</Select.Option>
              <Select.Option value="arxiv">arXiv</Select.Option>
            </Select>
            <Select
              placeholder="最低评分"
              style={{ width: 140 }}
              value={minScore}
              onChange={(value: number) => {
                setMinScore(value);
                setPage(1);
              }}
            >
              <Select.Option value={0}>全部</Select.Option>
              <Select.Option value={70}>≥ 70 分</Select.Option>
              <Select.Option value={80}>≥ 80 分</Select.Option>
              <Select.Option value={90}>≥ 90 分</Select.Option>
            </Select>
          </Space>
        </div>
      </Card>

      <Card>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>模型先知列表</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已生成报告与预警候选合并展示
            </Text>
          </div>
        </Space>
        <Table
          columns={columns}
          dataSource={pagedModels}
          loading={reportedLoading || candidateLoading}
          rowKey="id"
          pagination={{
            total: mergedModels.length,
            current: page,
            pageSize: PAGE_SIZE,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (newPage) => setPage(newPage),
          }}
          locale={{
            emptyText: <Empty description="暂无模型先知数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
        />
      </Card>

      <Modal
        title="模型先知配置"
        open={configModalVisible}
        width={760}
        onCancel={() => setConfigModalVisible(false)}
        okText="保存配置"
        cancelText="取消"
        okButtonProps={{
          loading: updateConfigMutation.isPending,
          disabled: !isAuthenticated,
        }}
        onOk={() => {
          void handleSaveConfig();
        }}
      >
        {!isAuthenticated ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="当前未登录，仅可查看配置。登录后可保存。"
          />
        ) : null}
        <Form form={configForm} layout="vertical" initialValues={explorationConfigState}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="监控数据源"
                name="monitor_sources"
                rules={[{ required: true, message: '请至少选择一个数据源' }]}
              >
                <Select
                  mode="multiple"
                  maxTagCount="responsive"
                  options={[
                    { value: 'github', label: 'GitHub' },
                    { value: 'huggingface', label: 'Hugging Face' },
                    { value: 'modelscope', label: 'ModelScope' },
                    { value: 'arxiv', label: 'arXiv' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="监控厂商/组织"
                name="watch_organizations"
                tooltip="重点关注这些组织的更新信号"
              >
                <Select
                  mode="tags"
                  maxTagCount="responsive"
                  options={DEFAULT_WATCH_ORGS.map((item) => ({ value: item, label: item }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="最低评分阈值" name="min_score">
                <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="回溯天数" name="days_back">
                <InputNumber min={1} max={30} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="每源最大候选数" name="max_results_per_source">
                <InputNumber min={1} max={200} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="任务执行模式" name="run_mode">
                <Select
                  options={[
                    { value: 'auto', label: '自动选择' },
                    { value: 'agent', label: 'Agent 模式' },
                    { value: 'deterministic', label: '规则模式' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="启用自动监控" name="auto_monitor_enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="自动监控间隔（小时）"
                name="auto_monitor_interval_hours"
                tooltip="开启自动监控后，系统将按该间隔自动发起模型先知任务"
              >
                <InputNumber
                  min={1}
                  max={168}
                  precision={0}
                  style={{ width: '100%' }}
                  disabled={!autoMonitorEnabledInForm}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={null}
        open={reportModalVisible}
        onCancel={() => {
          setReportModalVisible(false);
          setSelectedReport(null);
        }}
        width={980}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setReportModalVisible(false);
            }}
          >
            关闭
          </Button>,
          <Button
            key="export"
            type="primary"
            onClick={() => {
              if (!selectedReport) return;
              const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
              window.open(`${baseUrl}/exploration/reports/${selectedReport.report_id}/export`, '_blank');
            }}
          >
            导出报告
          </Button>,
          isAuthenticated ? (
            <Button
              key="delete"
              danger
              loading={deleteReportMutation.isPending}
              onClick={() => {
                if (!selectedReport) return;
                Modal.confirm({
                  title: '删除报告',
                  content: '确认删除该报告吗？删除后不可恢复。',
                  okText: '删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async () => {
                    await deleteReportMutation.mutateAsync(selectedReport.report_id);
                  },
                });
              }}
            >
              删除报告
            </Button>
          ) : null,
        ]}
      >
        {selectedReport && (
          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {buildFullReportMarkdown(selectedReport)}
            </ReactMarkdown>
          </div>
        )}
      </Modal>
    </div>
  );
}
