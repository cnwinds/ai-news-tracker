/**
 * 模型先知组件：追踪预发布模型信号、候选研判与报告
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Row,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tooltip,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FilterOutlined,
  GithubOutlined,
  LinkOutlined,
  LockOutlined,
  RocketOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Markdown } from '@/utils/markdown';
import type {
  DiscoveredModel,
  DiscoveredModelListResponse,
  ExplorationReport,
  ExplorationConfig,
  ExplorationTask,
  ExplorationTaskCreateRequest,
} from '@/types';
import '@/styles/pages/explorer.css';

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

const MODEL_TYPE_OPTIONS = ['LLM', 'Vision', 'Audio', 'Multimodal', 'Generative'].map((value) => ({
  value,
  label: value,
}));
const SOURCE_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'arxiv', label: 'arXiv' },
];
const MIN_SCORE_OPTIONS = [
  { value: 0, label: '全部评分' },
  { value: 40, label: '≥ 40 分' },
  { value: 70, label: '≥ 70 分' },
  { value: 80, label: '≥ 80 分' },
  { value: 90, label: '≥ 90 分' },
];
const PIPELINE = [
  { key: 'discovery', label: '更新监测' },
  { key: 'evaluation', label: '质量评估' },
  { key: 'analysis', label: '候选研判' },
  { key: 'report_generation', label: '报告生成' },
];

type ViewMode = 'all' | 'reported' | 'candidate';
type Tone = 'high' | 'mid' | 'low' | 'none';

function formatDate(date?: string, pattern = 'MM-DD HH:mm'): string {
  if (!date) return '-';
  const parsed = dayjs(date);
  if (!parsed.isValid()) return '-';
  return parsed.format(pattern);
}

function scoreTone(score?: number): Tone {
  if (!score) return 'none';
  if (score >= 80) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

function confidenceTone(confidence: number): Tone {
  if (confidence >= 75) return 'high';
  if (confidence >= 60) return 'mid';
  return 'low';
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

/** 阅读器头部已展示标题，去掉正文开头重复的一级标题 */
function stripLeadingHeading(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, '');
}

function clampPercent(value?: number): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

function ScoreBar({ value, tone }: { value?: number; tone: Tone }) {
  return (
    <span className="xp-bar" aria-hidden>
      <span className={`xp-bar__fill xp-bar__fill--${tone}`} style={{ width: `${clampPercent(value)}%` }} />
    </span>
  );
}

function ScoreCell({ value, tone, empty = 'N/A' }: { value?: number; tone: Tone; empty?: string }) {
  return (
    <span className="xp-score">
      <span className={`xp-score__value xp-score__value--${tone}`}>
        {typeof value === 'number' ? value.toFixed(1) : empty}
      </span>
      <ScoreBar value={value} tone={tone} />
    </span>
  );
}

export default function ModelExplorer() {
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();

  const [modelType, setModelType] = useState<string | undefined>(undefined);
  const [sourcePlatform, setSourcePlatform] = useState<string | undefined>(undefined);
  const [minScore, setMinScore] = useState<number>(DEFAULT_MIN_SCORE);
  const [searchText, setSearchText] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [page, setPage] = useState(1);
  const [expandedModelId, setExpandedModelId] = useState<number | null>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

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

  const canViewReport = (model: DiscoveredModel): boolean =>
    model.status === 'reported' && !modelsWithoutReports.has(model.id);

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

  const stats = useMemo(() => {
    let reported = 0;
    let highConfidence = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (const model of mergedModels) {
      if (model.status === 'reported' && !modelsWithoutReports.has(model.id)) reported += 1;
      if ((getExtraNumber(model, 'release_confidence') ?? 0) >= 75) highConfidence += 1;
      if (typeof model.final_score === 'number') {
        scoreSum += model.final_score;
        scoreCount += 1;
      }
    }
    return {
      total: mergedModels.length,
      reported,
      candidate: mergedModels.length - reported,
      highConfidence,
      avgScore: scoreCount ? scoreSum / scoreCount : undefined,
    };
  }, [mergedModels, modelsWithoutReports]);

  const visibleModels = useMemo(() => {
    if (viewMode === 'all') return mergedModels;
    const wantReported = viewMode === 'reported';
    return mergedModels.filter(
      (model) => (model.status === 'reported' && !modelsWithoutReports.has(model.id)) === wantReported
    );
  }, [mergedModels, modelsWithoutReports, viewMode]);

  const pagedModels = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visibleModels.slice(start, start + PAGE_SIZE);
  }, [visibleModels, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(visibleModels.length / PAGE_SIZE));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [visibleModels.length, page]);

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

  const openConfig = (): void => {
    configForm.setFieldsValue(explorationConfigState);
    setConfigModalVisible(true);
  };

  const closeReport = (): void => {
    setReportModalVisible(false);
  };

  const handleExportReport = (): void => {
    if (!selectedReport) return;
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    window.open(`${baseUrl}/exploration/reports/${selectedReport.report_id}/export`, '_blank');
  };

  const handleDeleteReport = (): void => {
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
  };

  const changeView = (value: ViewMode): void => {
    setViewMode(value);
    setPage(1);
    setExpandedModelId(null);
  };

  const isGeneratingFor = (modelId: number): boolean =>
    creatingReportModelId === modelId && (generateReportMutation.isPending || Boolean(reportTaskId));

  const renderModelAction = (record: DiscoveredModel, large = false): ReactNode => {
    const size = large ? 'large' : 'small';
    if (canViewReport(record)) {
      return (
        <Button
          size={size}
          block={large}
          type={large ? 'primary' : 'default'}
          className={large ? undefined : 'xp-act xp-act--view'}
          icon={<FileTextOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            void fetchLatestReport(record.id);
          }}
        >
          查看报告
        </Button>
      );
    }

    if (!isAuthenticated) {
      return (
        <Button size={size} block={large} className={large ? undefined : 'xp-act'} disabled>
          登录后生成
        </Button>
      );
    }

    const generating = isGeneratingFor(record.id);
    const inlineStatus = generating
      ? reportTaskInlineStatus || (generateReportMutation.isPending ? '提交中' : '生成中')
      : '';
    return (
      <span className="xp-act-wrap">
        <Button
          size={size}
          block={large}
          className={large ? undefined : 'xp-act'}
          icon={generating ? undefined : <ThunderboltOutlined />}
          loading={generating}
          disabled={generateReportMutation.isPending || Boolean(reportTaskId)}
          onClick={(event) => {
            event.stopPropagation();
            generateReportMutation.mutate(record.id);
          }}
        >
          {generating ? '生成中' : '生成报告'}
        </Button>
        {generating ? <span className="xp-act-status">{inlineStatus}</span> : null}
      </span>
    );
  };

  const renderStatusChip = (record: DiscoveredModel): ReactNode =>
    canViewReport(record) ? (
      <span className="chip chip--accent">已出报告</span>
    ) : (
      <span className="chip chip--warning">预警候选</span>
    );

  const renderUpdateType = (record: DiscoveredModel): ReactNode => {
    const updateType = getExtraString(record, 'update_type') || 'unknown';
    const strong = updateType === 'new_model_repo' || updateType === 'new_release_tag';
    return <span className={`xp-type${strong ? ' xp-type--strong' : ''}`}>{updateType}</span>;
  };

  const renderModelDetail = (record: DiscoveredModel): ReactNode => {
    const updateSummary = getExtraString(record, 'update_summary') || '暂无更新说明';
    const sourceUrl = getExtraString(record, 'source_url');
    const updatedAt = getExtraString(record, 'updated_at');
    const breakdown: Array<{ label: string; value?: number }> = [
      { label: '影响力', value: record.impact_score },
      { label: '质量', value: record.quality_score },
      { label: '创新性', value: record.innovation_score },
      { label: '实用性', value: record.practicality_score },
    ];
    const facts: Array<{ label: string; value: ReactNode; mono?: boolean }> = [
      { label: '组织', value: record.organization || 'Unknown' },
      { label: '类型', value: record.model_type || '-' },
      { label: '发布日期', value: formatDate(record.release_date, 'YYYY-MM-DD'), mono: true },
      { label: '最近更新', value: formatDate(updatedAt || record.release_date, 'YYYY-MM-DD HH:mm'), mono: true },
      { label: 'Stars', value: record.github_stars.toLocaleString(), mono: true },
      { label: 'Forks', value: record.github_forks.toLocaleString(), mono: true },
      { label: '论文引用', value: record.paper_citations.toLocaleString(), mono: true },
      { label: '社媒提及', value: record.social_mentions.toLocaleString(), mono: true },
    ];

    return (
      <div className="xp-detail">
        <div className="xp-detail__summary">
          <span className="eyebrow">更新信号</span>
          <p>{updateSummary}</p>
          {sourceUrl ? (
            <a
              className="xp-detail__link"
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              <LinkOutlined /> 来源链接
            </a>
          ) : null}
        </div>
        <div className="xp-detail__block">
          <span className="eyebrow">评分构成</span>
          <div className="xp-breakdown">
            {breakdown.map((item) => (
              <div key={item.label} className="xp-breakdown__row">
                <span className="xp-breakdown__label">{item.label}</span>
                <ScoreBar value={item.value} tone={scoreTone(item.value)} />
                <span className="xp-breakdown__value">
                  {typeof item.value === 'number' ? item.value.toFixed(1) : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="xp-detail__block">
          <span className="eyebrow">档案</span>
          <dl className="xp-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="xp-facts__item">
                <dt>{fact.label}</dt>
                <dd className={fact.mono ? 'mono' : undefined}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  };

  const renderFilters = (stacked: boolean): ReactNode => (
    <div className={stacked ? 'xp-filters xp-filters--stacked' : 'xp-filters'}>
      {stacked ? <div className="mobile-filter-label">关键词</div> : null}
      <Search
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        onSearch={(value) => {
          setSearchValue(value.trim());
          setPage(1);
        }}
        placeholder="搜索模型或组织"
        allowClear
        className="xp-filters__search"
      />
      {stacked ? <div className="mobile-filter-label">模型类型</div> : null}
      <Select
        placeholder="模型类型"
        className="xp-filters__select"
        allowClear
        value={modelType}
        onChange={(value) => { setModelType(value); setPage(1); }}
        options={MODEL_TYPE_OPTIONS}
        popupMatchSelectWidth={false}
      />
      {stacked ? <div className="mobile-filter-label">来源平台</div> : null}
      <Select
        placeholder="来源平台"
        className="xp-filters__select"
        allowClear
        value={sourcePlatform}
        onChange={(value) => { setSourcePlatform(value); setPage(1); }}
        options={SOURCE_OPTIONS}
        popupMatchSelectWidth={false}
      />
      {stacked ? <div className="mobile-filter-label">最低评分</div> : null}
      <Select
        placeholder="最低评分"
        className="xp-filters__select"
        value={minScore}
        onChange={(value: number) => { setMinScore(value); setPage(1); }}
        options={MIN_SCORE_OPTIONS}
        popupMatchSelectWidth={false}
      />
    </div>
  );

  const activeFilterCount =
    (searchValue ? 1 : 0) + (modelType ? 1 : 0) + (sourcePlatform ? 1 : 0) + (minScore !== DEFAULT_MIN_SCORE ? 1 : 0);

  const viewOptions = [
    { value: 'all', label: <span className="xp-seg">全部<em>{stats.total}</em></span> },
    { value: 'reported', label: <span className="xp-seg">已出报告<em>{stats.reported}</em></span> },
    { value: 'candidate', label: <span className="xp-seg">预警候选<em>{stats.candidate}</em></span> },
  ];

  const listLoading = (reportedLoading || candidateLoading) && pagedModels.length === 0;
  const startDisabled =
    startExplorationMutation.isPending ||
    isTaskActive ||
    (explorationConfigState.monitor_sources?.length || 0) === 0;

  const taskDotClass = !taskStatus
    ? 'dot'
    : taskStatus.status === 'completed'
      ? 'dot xp-dot--ok'
      : taskStatus.status === 'failed'
        ? 'dot dot--high'
        : 'dot dot--live';

  const taskStageLabel = !taskStatus
    ? '待命'
    : taskStatus.status === 'completed' || taskStatus.status === 'failed'
      ? stageLabel(taskStatus.status)
      : stageLabel(taskStatus.progress?.current_stage || 'queued');

  const pipelineIndex = (() => {
    if (!taskStatus) return -1;
    if (taskStatus.status === 'completed') return PIPELINE.length;
    const stage = (taskStatus.progress?.current_stage || '').toLowerCase();
    return PIPELINE.findIndex((item) => item.key === stage);
  })();

  const taskCounters = taskStatus
    ? [
        { label: '发现', value: taskStatus.progress?.models_discovered || 0 },
        { label: '评估', value: taskStatus.progress?.models_evaluated || 0 },
        { label: '更新', value: taskStatus.progress?.updates_detected || 0 },
        { label: '候选', value: taskStatus.progress?.release_candidates || 0 },
        { label: '报告', value: taskStatus.progress?.reports_generated || 0 },
      ]
    : [];

  const sheetModel =
    isMobile && expandedModelId !== null ? mergedModels.find((model) => model.id === expandedModelId) : undefined;
  const reportModel = selectedReport
    ? mergedModels.find((model) => model.id === selectedReport.model_id)
    : undefined;

  const configFormNode = (
    <>
      {!isAuthenticated ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="当前未登录，仅可查看配置。登录后可保存。"
        />
      ) : null}
      <Form form={configForm} layout="vertical" initialValues={explorationConfigState} className="xp-config">
        <div className="xp-config__group">
          <span className="eyebrow">监控范围</span>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                label="监控数据源"
                name="monitor_sources"
                rules={[{ required: true, message: '请至少选择一个数据源' }]}
              >
                <Select mode="multiple" maxTagCount="responsive" options={SOURCE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
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
        </div>
        <div className="xp-config__group">
          <span className="eyebrow">筛选阈值</span>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item label="最低评分阈值" name="min_score">
                <InputNumber min={0} max={100} precision={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item label="回溯天数" name="days_back">
                <InputNumber min={1} max={30} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item label="每源最大候选数" name="max_results_per_source">
                <InputNumber min={1} max={200} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </div>
        <div className="xp-config__group">
          <span className="eyebrow">执行</span>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
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
            <Col xs={10} sm={4}>
              <Form.Item label="自动监控" name="auto_monitor_enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={14} sm={8}>
              <Form.Item
                label="监控间隔（小时）"
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
        </div>
      </Form>
    </>
  );

  const reportBody = selectedReport ? (
    <article className="reader xp-report">
      <div className="reader__bar">
        <div className="reader__bar-group">
          <button
            type="button"
            className="icon-btn"
            onClick={closeReport}
            aria-label={isMobile ? '返回' : '关闭'}
          >
            {isMobile ? <ArrowLeftOutlined /> : <CloseOutlined />}
          </button>
          <span className="chip chip--outline">模型先知报告</span>
        </div>
        <div className="reader__bar-group">
          {isAuthenticated ? (
            <Tooltip title="删除报告">
              <button
                type="button"
                className="icon-btn"
                onClick={handleDeleteReport}
                disabled={deleteReportMutation.isPending}
                aria-label="删除报告"
              >
                <DeleteOutlined />
              </button>
            </Tooltip>
          ) : null}
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportReport}
            style={{ marginLeft: 6 }}
          >
            导出报告
          </Button>
        </div>
      </div>

      <header>
        <div className="reader__kicker">
          {reportModel ? (
            <>
              <span className="chip chip--accent">{reportModel.model_name}</span>
              <span className="chip">
                {reportModel.source_platform === 'github' ? <GithubOutlined /> : null}
                {sourceLabel(reportModel.source_platform)}
              </span>
              {typeof reportModel.final_score === 'number' ? (
                <span className="chip mono">综合 {reportModel.final_score.toFixed(1)}</span>
              ) : null}
            </>
          ) : null}
        </div>
        <h1 className="reader__title">{selectedReport.title || '模型先知报告'}</h1>
        <div className="reader__meta">
          <span className="reader__meta-item mono">{formatDate(selectedReport.generated_at, 'YYYY-MM-DD HH:mm')}</span>
          {reportModel?.organization ? <span className="reader__meta-item">组织 · {reportModel.organization}</span> : null}
          <span className="reader__meta-item mono" title={selectedReport.report_id}>
            #{selectedReport.report_id.slice(0, 8)}
          </span>
        </div>
      </header>

      <Markdown>{stripLeadingHeading(buildFullReportMarkdown(selectedReport))}</Markdown>
    </article>
  ) : null;

  const reportDrawer = (
    <Drawer
      open={reportModalVisible}
      onClose={closeReport}
      afterOpenChange={(open) => {
        if (!open) setSelectedReport(null);
      }}
      placement="right"
      width={isMobile ? '100%' : 'min(920px, calc(100vw - 120px))'}
      closable={false}
      className={isMobile ? 'm-reader' : 'xp-report-drawer'}
      styles={{ header: { display: 'none' }, body: { padding: 0 } }}
    >
      {reportBody}
    </Drawer>
  );

  const configContainer = isMobile ? (
    <Drawer
      title="模型先知配置"
      placement="bottom"
      height="auto"
      open={configModalVisible}
      onClose={() => setConfigModalVisible(false)}
      className="m-sheet xp-config-sheet"
      footer={
        <div className="xp-sheet-footer">
          <Button size="large" onClick={() => setConfigModalVisible(false)}>
            取消
          </Button>
          <Button
            size="large"
            type="primary"
            loading={updateConfigMutation.isPending}
            disabled={!isAuthenticated}
            onClick={() => {
              void handleSaveConfig();
            }}
          >
            保存配置
          </Button>
        </div>
      }
    >
      {configFormNode}
    </Drawer>
  ) : (
    <Modal
      title="模型先知配置"
      open={configModalVisible}
      width={720}
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
      {configFormNode}
    </Modal>
  );

  if (isMobile) {
    return (
      <div className="mobile-list-page xp-m">
        <div className="mobile-list-toolbar">
          <span className="mobile-list-toolbar__meta">
            <strong className="mono">{visibleModels.length}</strong> 个模型
          </span>
          <div className="xp-m__actions">
            {isAuthenticated ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<RocketOutlined />}
                  loading={startExplorationMutation.isPending}
                  disabled={startExplorationMutation.isPending || isTaskActive}
                  onClick={() => startExplorationMutation.mutate()}
                >
                  启动
                </Button>
                <button type="button" className="icon-btn" onClick={openConfig} aria-label="配置">
                  <SettingOutlined />
                </button>
              </>
            ) : null}
            <Badge dot={activeFilterCount > 0} offset={[-6, 6]}>
              <button
                type="button"
                className={`icon-btn${activeFilterCount ? ' icon-btn--active' : ''}`}
                onClick={() => setFilterDrawerOpen(true)}
                aria-label="筛选"
              >
                <FilterOutlined />
              </button>
            </Badge>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="xp-notice xp-notice--m">
            <LockOutlined /> 只读模式，登录后可启动任务。
          </div>
        ) : null}

        {taskAlert ? (
          <div className="xp-m__task" title={taskAlert.inline}>
            <span className={taskDotClass} />
            <span className="xp-m__task-text">{taskAlert.inline}</span>
          </div>
        ) : null}

        <div className="xp-m__stats">
          <div className="xp-m__stat">
            <span className="xp-m__stat-value">{stats.reported}</span>
            <span className="xp-m__stat-label">已出报告</span>
          </div>
          <div className="xp-m__stat">
            <span className="xp-m__stat-value">{stats.candidate}</span>
            <span className="xp-m__stat-label">预警候选</span>
          </div>
          <div className="xp-m__stat">
            <span className="xp-m__stat-value">{stats.highConfidence}</span>
            <span className="xp-m__stat-label">高置信</span>
          </div>
        </div>

        <div className="xp-m__seg">
          <Segmented block value={viewMode} onChange={(value) => changeView(value as ViewMode)} options={viewOptions} />
        </div>

        {listLoading ? (
          <div className="mobile-list xp-m__skeleton">
            <Skeleton active title={false} paragraph={{ rows: 8 }} />
          </div>
        ) : pagedModels.length === 0 ? (
          <div className="mobile-feed-loading">
            <Empty description="暂无模型数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <div className="mobile-list">
            {pagedModels.map((record) => {
              const reported = canViewReport(record);
              const updatedAt = getExtraString(record, 'updated_at');
              return (
                <button
                  key={record.id}
                  type="button"
                  className="xp-mrow"
                  onClick={() => setExpandedModelId(record.id)}
                >
                  <span className="xp-mrow__marker">
                    <span className={reported ? 'dot xp-dot--report' : 'dot dot--medium'} />
                  </span>
                  <span className="xp-mrow__body">
                    <span className="xp-mrow__title">{record.model_name}</span>
                    <span className="xp-mrow__meta">
                      <span className="xp-mrow__org">{record.organization || 'Unknown'}</span>
                      <span aria-hidden>·</span>
                      <span>{sourceLabel(record.source_platform)}</span>
                      <span aria-hidden>·</span>
                      <span className="mono">{formatDate(updatedAt || record.release_date)}</span>
                    </span>
                  </span>
                  <span className="xp-mrow__score">
                    <ScoreCell value={record.final_score} tone={scoreTone(record.final_score)} empty="-" />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {visibleModels.length > PAGE_SIZE ? (
          <div className="mobile-feed-pagination">
            <Pagination
              simple
              size="small"
              current={page}
              total={visibleModels.length}
              pageSize={PAGE_SIZE}
              onChange={(newPage) => setPage(newPage)}
            />
          </div>
        ) : null}

        <Drawer
          title="筛选"
          placement="bottom"
          height="auto"
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          className="m-sheet"
          extra={
            <Button type="link" onClick={() => setFilterDrawerOpen(false)}>
              完成
            </Button>
          }
        >
          {renderFilters(true)}
        </Drawer>

        <Drawer
          title={sheetModel?.model_name}
          placement="bottom"
          height="auto"
          open={Boolean(sheetModel)}
          onClose={() => setExpandedModelId(null)}
          className="m-sheet xp-model-sheet"
        >
          {sheetModel ? (
            <div className="xp-sheet">
              <div className="xp-sheet__chips">
                {renderStatusChip(sheetModel)}
                <span className="chip">
                  {sheetModel.source_platform === 'github' ? <GithubOutlined /> : null}
                  {sourceLabel(sheetModel.source_platform)}
                </span>
                {renderUpdateType(sheetModel)}
              </div>
              <div className="xp-sheet__scores">
                <div className="xp-sheet__score">
                  <span className="eyebrow">综合评分</span>
                  <ScoreCell value={sheetModel.final_score} tone={scoreTone(sheetModel.final_score)} />
                </div>
                <div className="xp-sheet__score">
                  <span className="eyebrow">发布置信度</span>
                  {(() => {
                    const confidence = getExtraNumber(sheetModel, 'release_confidence') ?? 0;
                    return <ScoreCell value={confidence} tone={confidenceTone(confidence)} />;
                  })()}
                </div>
              </div>
              {renderModelDetail(sheetModel)}
              <div className="xp-sheet__actions">{renderModelAction(sheetModel, true)}</div>
            </div>
          ) : null}
        </Drawer>

        {configContainer}
        {reportDrawer}
      </div>
    );
  }

  return (
    <div className="xp">
      {!isAuthenticated ? (
        <div className="xp-notice">
          <LockOutlined /> 当前为只读模式，登录后可启动模型先知任务。
        </div>
      ) : null}

      <section className="panel xp-console" aria-label="任务控制台">
        <div className="xp-console__main">
          <div className="xp-console__status">
            <span className={taskDotClass} />
            <span className="eyebrow">{taskStageLabel}</span>
            {taskAlert ? (
              <span className="xp-console__line" title={taskAlert.inline}>
                {taskAlert.inline}
              </span>
            ) : (
              <span className="xp-console__line xp-console__line--muted">
                配置监控范围后启动任务，系统将自动追踪预发布信号。
              </span>
            )}
          </div>
          {taskStatus ? (
            <div className="xp-console__progress">
              <ol className="xp-steps">
                {PIPELINE.map((step, index) => {
                  const state =
                    index < pipelineIndex ? 'done' : index === pipelineIndex ? 'current' : 'todo';
                  return (
                    <li
                      key={step.key}
                      className={`xp-steps__item xp-steps__item--${state}${taskStatus.status === 'failed' && state === 'current' ? ' xp-steps__item--failed' : ''}`}
                    >
                      <span className="xp-steps__index mono">{String(index + 1).padStart(2, '0')}</span>
                      {step.label}
                    </li>
                  );
                })}
              </ol>
              <div className="xp-counters">
                {taskCounters.map((item) => (
                  <span key={item.label} className="xp-counters__item">
                    {item.label}
                    <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="xp-console__meta">
            <span className="xp-console__kv">
              数据源 <strong>{monitorSourceSummary}</strong>
            </span>
            <span className="xp-console__kv">
              组织 <strong className="mono">{explorationConfigState.watch_organizations.length}</strong>
            </span>
            <span className="xp-console__kv">
              自动监控{' '}
              {explorationConfigState.auto_monitor_enabled ? (
                <strong className="u-accent">
                  每 <span className="mono">{explorationConfigState.auto_monitor_interval_hours}</span> 小时
                </strong>
              ) : (
                <strong>关闭</strong>
              )}
            </span>
          </div>
        </div>
        {isAuthenticated ? (
          <div className="xp-console__actions">
            <Button icon={<SettingOutlined />} loading={configLoading} onClick={openConfig}>
              配置
            </Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={() => {
                startExplorationMutation.mutate();
              }}
              loading={startExplorationMutation.isPending}
              disabled={startDisabled}
            >
              启动模型先知
            </Button>
          </div>
        ) : null}
      </section>

      <div className="xp-metrics">
        <div className="metric">
          <span className="metric__label">追踪模型</span>
          <span className="metric__value">{stats.total}</span>
          <span className="metric__foot">
            评分 ≥ <span className="mono">{minScore}</span>
          </span>
        </div>
        <div className="metric">
          <span className="metric__label">
            <span className="dot xp-dot--report" /> 已出报告
          </span>
          <span className="metric__value">{stats.reported}</span>
          <span className="metric__foot">可查看完整研判</span>
        </div>
        <div className="metric">
          <span className="metric__label">
            <span className="dot dot--medium" /> 预警候选
          </span>
          <span className="metric__value">{stats.candidate}</span>
          <span className="metric__foot">发布置信度 ≥ 60</span>
        </div>
        <div className="metric">
          <span className="metric__label">高置信信号</span>
          <span className="metric__value">{stats.highConfidence}</span>
          <span className="metric__foot">
            平均综合分 <span className="mono">{stats.avgScore !== undefined ? stats.avgScore.toFixed(1) : '-'}</span>
          </span>
        </div>
      </div>

      <section className="panel xp-board" aria-label="模型先知列表">
        <div className="xp-toolbar">
          <Segmented size="small" value={viewMode} onChange={(value) => changeView(value as ViewMode)} options={viewOptions} />
          {renderFilters(false)}
        </div>

        <div className="xp-table" role="table" aria-label="模型列表">
          <div className="xp-row xp-row--head" role="row">
            <span role="columnheader">模型</span>
            <span role="columnheader">来源</span>
            <span role="columnheader">更新信号</span>
            <span role="columnheader">发布置信度</span>
            <span role="columnheader">综合评分</span>
            <span role="columnheader" className="xp-col-updated">最近更新</span>
            <span role="columnheader" className="xp-col-action">操作</span>
          </div>

          {listLoading ? (
            <div className="xp-table__state">
              <Skeleton active title={false} paragraph={{ rows: 8 }} />
            </div>
          ) : pagedModels.length === 0 ? (
            <div className="xp-table__state">
              <Empty description="暂无模型先知数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            pagedModels.map((record) => {
              const expanded = expandedModelId === record.id;
              const reported = canViewReport(record);
              const confidence = getExtraNumber(record, 'release_confidence') ?? 0;
              const updateSummary = getExtraString(record, 'update_summary') || '暂无更新说明';
              const updatedAt = getExtraString(record, 'updated_at');
              const toggle = (): void => setExpandedModelId((prev) => (prev === record.id ? null : record.id));
              return (
                <div key={record.id} className={`xp-item${expanded ? ' xp-item--open' : ''}`} role="rowgroup">
                  <div
                    className="xp-row"
                    role="row"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={toggle}
                    onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle();
                      }
                    }}
                  >
                    <span className="xp-cell xp-cell--model" role="cell">
                      <span className={reported ? 'dot xp-dot--report' : 'dot dot--medium'} title={reported ? '已出报告' : '预警候选'} />
                      <span className="xp-cell__stack">
                        <span className="xp-name">{record.model_name}</span>
                        <span className="xp-org">{record.organization || 'Unknown'}</span>
                      </span>
                    </span>
                    <span className="xp-cell" role="cell">
                      <span className="chip">
                        {record.source_platform === 'github' ? <GithubOutlined /> : null}
                        {sourceLabel(record.source_platform)}
                      </span>
                    </span>
                    <span className="xp-cell xp-cell--signal" role="cell">
                      {renderUpdateType(record)}
                      <span className="xp-signal" title={updateSummary}>
                        {updateSummary}
                      </span>
                    </span>
                    <span className="xp-cell" role="cell">
                      <ScoreCell value={confidence} tone={confidenceTone(confidence)} />
                    </span>
                    <span className="xp-cell" role="cell">
                      <ScoreCell value={record.final_score} tone={scoreTone(record.final_score)} />
                    </span>
                    <span className="xp-cell xp-col-updated mono xp-date" role="cell">
                      {formatDate(updatedAt || record.release_date)}
                    </span>
                    <span className="xp-cell xp-col-action" role="cell">
                      {renderModelAction(record)}
                      <DownOutlined className="xp-chevron" aria-hidden />
                    </span>
                  </div>
                  {expanded ? <div className="xp-item__detail">{renderModelDetail(record)}</div> : null}
                </div>
              );
            })
          )}
        </div>

        <div className="xp-board__foot">
          <span className="xp-board__count">
            共 <strong>{visibleModels.length}</strong> 条 · 已生成报告与预警候选合并展示
          </span>
          {visibleModels.length > PAGE_SIZE ? (
            <Pagination
              size="small"
              current={page}
              total={visibleModels.length}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              onChange={(newPage) => setPage(newPage)}
            />
          ) : null}
        </div>
      </section>

      {configContainer}
      {reportDrawer}
    </div>
  );
}
