/**
 * 内容总结：PC 为「摘要列表 + 阅读器」分栏，手机为列表 + 全屏阅读页
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Skeleton,
  Spin,
  Tooltip,
} from 'antd';
import { FileTextOutlined, PlusOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import { apiService } from '@/services/api';
import { useMessage } from '@/hooks/useMessage';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/utils/clipboard';
import type {
  SummaryGenerateRequest,
  DailySummaryListItem,
  SummaryFieldsResponse,
  SummaryGenerateFormValues,
  SummaryPromptSettings,
} from '@/types';
import SummaryReader from '@/components/summary/SummaryReader';
import {
  groupByMonth,
  summaryLevel,
  summaryRangeLabel,
  summaryWeekTag,
  TYPE_LABEL,
  type SummaryTypeFilter,
} from '@/components/summary/format';
import '@/styles/pages/summary.css';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const { TextArea } = Input;

const ART_POLL_INTERVAL_MS = 5000;
const ART_POLL_TIMEOUT_MS = 30 * 60 * 1000;

const TYPE_FILTERS: { value: SummaryTypeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'daily', label: '日报' },
  { value: 'weekly', label: '周报' },
];

// 计算给定日期所在周的周六到周五范围
// 一周定义为：从上周六到本周五（共7天）
const getWeekRange = (date: dayjs.Dayjs) => {
  const dayOfWeek = date.day(); // 0=周日, 1=周一, ..., 6=周六

  let monday: dayjs.Dayjs;

  if (dayOfWeek === 6) {
    // 如果是周六，这个周六属于"从本周六到下周五"这个周期
    // 所以需要找到包含这个周六的周期：本周六到下周五
    // 这个周期的周一应该是下周一
    monday = date.add(2, 'day').startOf('isoWeek');
  } else {
    // 周日（0）、周一到周五（1-5），都属于"从上周六到本周五"这个周期
    // 这个周期的周一应该是本周一（ISO周的周一）
    // 对于周日，需要先加一天到周一，然后再找ISO周的周一
    monday = date.add(dayOfWeek === 0 ? 1 : 0, 'day').startOf('isoWeek');
  }

  // 周六是周一的前2天（上周六）
  const saturday = monday.subtract(2, 'day');
  // 周五是周一的后4天（本周五）
  const friday = monday.add(4, 'day');
  return { saturday, friday };
};

// 判断日期是否在周六到周五的范围内
const isInWeekRange = (date: dayjs.Dayjs, weekDate: dayjs.Dayjs | null) => {
  if (!weekDate) return false;
  const { saturday, friday } = getWeekRange(weekDate);
  return (date.isAfter(saturday, 'day') || date.isSame(saturday, 'day')) &&
    (date.isBefore(friday, 'day') || date.isSame(friday, 'day'));
};

interface SummaryRowProps {
  summary: DailySummaryListItem;
  active: boolean;
  onSelect: (summary: DailySummaryListItem) => void;
}

function SummaryRow({ summary, active, onSelect }: SummaryRowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const weekTag = summaryWeekTag(summary);
  const isWeekly = summary.summary_type === 'weekly';
  const highlights = summary.highlights ?? [];

  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      className={`feed-row summary-row${active ? ' feed-row--active' : ''}`}
      onClick={() => onSelect(summary)}
      aria-current={active ? 'true' : undefined}
    >
      <span className="feed-row__marker">
        <span className={`dot dot--${summaryLevel(summary)}`} />
      </span>
      <span className="feed-row__body">
        <span className="summary-row__meta">
          <span className="summary-row__range">{summaryRangeLabel(summary)}</span>
          {weekTag && <span className="summary-row__week">{weekTag}</span>}
          <span className={`summary-row__type${isWeekly ? ' summary-row__type--weekly' : ''}`}>
            {TYPE_LABEL[summary.summary_type] || summary.summary_type}
          </span>
          <span className="summary-row__stats">
            <span className="summary-row__stat">{summary.total_articles} 篇</span>
            {summary.high_importance_count > 0 && (
              <span className="summary-row__stat summary-row__stat--high" title="高重要">
                <span className="dot dot--high" />
                {summary.high_importance_count}
              </span>
            )}
          </span>
        </span>
        <span className="feed-row__title summary-row__headline">
          {summary.headline || `${summaryRangeLabel(summary)} ${TYPE_LABEL[summary.summary_type] || ''}`}
        </span>
        {highlights.length > 1 && (
          <span className="summary-row__more">
            <span className="summary-row__more-count">+{highlights.length - 1}</span>
            {highlights[1]}
          </span>
        )}
      </span>
      <span className="feed-row__trail" />
    </button>
  );
}

export default function DailySummary() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [promptSettingsVisible, setPromptSettingsVisible] = useState(false);
  const [form] = Form.useForm();
  const [promptForm] = Form.useForm();
  const queryClient = useQueryClient();
  const message = useMessage();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [selectedWeekDate, setSelectedWeekDate] = useState<dayjs.Dayjs | null>(null);
  const [hoveredWeekDate, setHoveredWeekDate] = useState<dayjs.Dayjs | null>(null);
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();
  const [typeFilter, setTypeFilter] = useState<SummaryTypeFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  // 保存正在重新生成的摘要ID
  const regeneratingSummaryIdRef = useRef<number | null>(null);
  // 正在请求详情的摘要ID（避免重复请求）
  const inflightRef = useRef<Set<number>>(new Set());

  const { data: summaries, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => apiService.getSummaries(50),
  });

  const { data: summaryPromptSettings, isLoading: summaryPromptLoading } = useQuery({
    queryKey: ['summaryPromptSettings'],
    queryFn: () => apiService.getSummaryPromptSettings(),
    enabled: generateModalVisible,
    staleTime: 0, // 禁用缓存，每次都重新获取
    gcTime: 0, // React Query v5 使用 gcTime 替代 cacheTime
    refetchOnMount: true, // 每次挂载时重新获取
  });

  // 存储已加载的摘要详情
  const [loadedDetails, setLoadedDetails] = useState<Map<number, SummaryFieldsResponse>>(new Map());
  // 跟踪正在加载详情的摘要ID
  const [loadingDetails, setLoadingDetails] = useState<Set<number>>(new Set());
  // 详情加载失败的摘要ID
  const [failedDetails, setFailedDetails] = useState<Set<number>>(new Set());

  const items = useMemo(
    () => (summaries ?? []).filter((s) => typeFilter === 'all' || s.summary_type === typeFilter),
    [summaries, typeFilter]
  );
  const groups = useMemo(() => groupByMonth(items), [items]);
  const selectedSummary = summaries?.find((s) => s.id === selectedId);

  useEffect(() => {
    // 当对话框打开且数据加载完成时，设置表单值
    if (generateModalVisible && summaryPromptSettings && !summaryPromptLoading) {
      promptForm.setFieldsValue({
        daily_summary_prompt: summaryPromptSettings.daily_summary_prompt || '',
        weekly_summary_prompt: summaryPromptSettings.weekly_summary_prompt || '',
      });
    }
  }, [generateModalVisible, summaryPromptSettings, summaryPromptLoading, promptForm]);

  const removeDetails = (summaryId: number) => {
    setLoadedDetails((prev) => {
      if (!prev.has(summaryId)) return prev;
      const newMap = new Map(prev);
      newMap.delete(summaryId);
      return newMap;
    });
  };

  // 按需加载摘要详情
  const loadSummaryDetails = async (summaryId: number, forceReload: boolean = false) => {
    // 如果已经加载过且不是强制重新加载，直接返回
    if (!forceReload && loadedDetails.has(summaryId)) {
      return;
    }

    // 如果正在加载，避免重复加载
    if (inflightRef.current.has(summaryId)) {
      return;
    }

    // 设置加载状态
    inflightRef.current.add(summaryId);
    setLoadingDetails((prev) => new Set(prev).add(summaryId));
    setFailedDetails((prev) => {
      if (!prev.has(summaryId)) return prev;
      const newSet = new Set(prev);
      newSet.delete(summaryId);
      return newSet;
    });

    try {
      const details = await apiService.getSummaryFields(summaryId, 'all');
      setLoadedDetails((prev) => {
        const newMap = new Map(prev);
        newMap.set(summaryId, details);
        return newMap;
      });
    } catch (loadError) {
      console.error('加载摘要详情失败:', loadError);
      message.error('加载摘要详情失败');
      // 如果加载失败，从缓存中移除
      removeDetails(summaryId);
      setFailedDetails((prev) => new Set(prev).add(summaryId));
    } finally {
      // 清除加载状态
      inflightRef.current.delete(summaryId);
      setLoadingDetails((prev) => {
        const newSet = new Set(prev);
        newSet.delete(summaryId);
        return newSet;
      });
    }
  };

  // PC：数据刷新后保持选中项，否则自动选中第一份
  useEffect(() => {
    if (isMobile || items.length === 0) return;
    if (selectedId === null || !items.some((s) => s.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, isMobile, selectedId]);

  // 选中项变化时加载详情
  useEffect(() => {
    if (selectedId !== null) {
      void loadSummaryDetails(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selectSummary = (summary: DailySummaryListItem) => {
    setSelectedId(summary.id);
    if (summary.id === selectedId) {
      // 同一项再次点击时 effect 不会触发，手动确保详情已加载
      void loadSummaryDetails(summary.id);
    }
    if (isMobile) {
      setReaderOpen(true);
    }
  };

  // PC 键盘导航：J/K 或 ↓/↑
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"], .ant-select, .ant-modal, .ant-drawer, .ant-picker-dropdown')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!['j', 'k', 'arrowdown', 'arrowup'].includes(key) || items.length === 0) return;
      e.preventDefault();
      const index = items.findIndex((s) => s.id === selectedId);
      const delta = key === 'j' || key === 'arrowdown' ? 1 : -1;
      const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
      if (next) setSelectedId(next.id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, selectedId, isMobile]);

  const generateMutation = useMutation({
    mutationFn: (data: SummaryGenerateRequest) =>
      apiService.generateSummary(data),
    onSuccess: async (created) => {
      showSuccess('摘要生成成功');
      setGenerateModalVisible(false);
      setPromptSettingsVisible(false);
      form.resetFields();
      setSelectedWeekDate(null);
      setHoveredWeekDate(null);
      if (created?.id) {
        // 同一日期/周重新生成时内容可能已缓存，清除以便重新加载
        removeDetails(created.id);
      }
      await queryClient.invalidateQueries({ queryKey: ['summaries'] });
      if (created?.id && !isMobile) {
        setTypeFilter('all');
        if (selectedIdRef.current === created.id) {
          void loadSummaryDetails(created.id, true);
        } else {
          setSelectedId(created.id);
        }
      }
    },
    onError: createErrorHandler({
      operationName: '生成摘要',
      customMessages: {
        auth: '需要登录才能生成摘要',
      },
    }),
  });

  const updatePromptMutation = useMutation({
    mutationFn: (data: SummaryPromptSettings) => apiService.updateSummaryPromptSettings(data),
    onSuccess: () => {
      showSuccess('提示词已保存');
      queryClient.invalidateQueries({ queryKey: ['summaryPromptSettings'] });
    },
    onError: createErrorHandler({
      operationName: '保存提示词',
      customMessages: {
        auth: '需要登录才能保存提示词',
      },
    }),
  });

  const regenerateMutation = useMutation({
    mutationFn: (data: SummaryGenerateRequest) =>
      apiService.generateSummary(data),
    onSuccess: async () => {
      showSuccess('摘要重新生成成功');

      const summaryId = regeneratingSummaryIdRef.current;
      if (summaryId !== null) {
        // 清除已加载的详情缓存
        removeDetails(summaryId);
      }

      // 刷新摘要列表并等待完成
      await queryClient.invalidateQueries({ queryKey: ['summaries'] });

      // 当前正在阅读该摘要时，强制重新加载详情
      if (summaryId !== null && selectedIdRef.current === summaryId) {
        void loadSummaryDetails(summaryId, true);
      }

      // 清除 ref
      regeneratingSummaryIdRef.current = null;
    },
    onError: (mutationError) => {
      regeneratingSummaryIdRef.current = null;
      createErrorHandler({
        operationName: '重新生成摘要',
        customMessages: {
          auth: '需要登录才能重新生成摘要',
        },
      })(mutationError);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSummary(id),
    onSuccess: () => {
      showSuccess('摘要已删除');
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: createErrorHandler({
      operationName: '删除摘要',
      customMessages: {
        auth: '需要登录才能删除摘要',
      },
    }),
  });

  const artMutation = useMutation({
    mutationFn: async (id: number) => {
      let status = await apiService.generateSummaryIllustrations(id);
      const deadline = Date.now() + ART_POLL_TIMEOUT_MS;
      while (status.running) {
        if (Date.now() > deadline) throw new Error('配图仍在后台生成，请稍后刷新查看');
        await new Promise((resolve) => setTimeout(resolve, ART_POLL_INTERVAL_MS));
        status = await apiService.getSummaryIllustrationStatus(id);
      }
      if (status.error) throw new Error(status.error);
      return apiService.getSummaryFields(id, 'illustrations');
    },
    onSuccess: ({ illustrations }, id) => {
      showSuccess('配图已生成');
      setLoadedDetails((prev) => {
        const current = prev.get(id);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(id, { ...current, illustrations });
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: createErrorHandler({
      operationName: '生成配图',
      customMessages: {
        auth: '需要登录才能生成配图',
      },
    }),
  });

  // 自动生成的总结会在后台补画配图：打开无封面的总结时轮询任务，结束后刷新详情
  const selectedHasCover = selectedId !== null && !!loadedDetails.get(selectedId)?.illustrations?.cover;
  const artStatusQuery = useQuery({
    queryKey: ['summary-art-status', selectedId],
    queryFn: () => apiService.getSummaryIllustrationStatus(selectedId as number),
    enabled: selectedId !== null && loadedDetails.has(selectedId) && !selectedHasCover && !artMutation.isPending,
    refetchInterval: (query) => (query.state.data?.running ? ART_POLL_INTERVAL_MS : false),
  });
  const backgroundDrawing = !!artStatusQuery.data?.running;
  const wasDrawingRef = useRef(false);
  useEffect(() => {
    if (wasDrawingRef.current && !backgroundDrawing && selectedId !== null) {
      void loadSummaryDetails(selectedId, true);
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    }
    wasDrawingRef.current = backgroundDrawing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundDrawing, selectedId]);

  const handleRegenerate = (summary: DailySummaryListItem) => {
    const requestData: SummaryGenerateRequest = {
      summary_type: summary.summary_type as 'daily' | 'weekly',
    };

    if (summary.summary_type === 'daily') {
      // 从summary_date提取日期
      requestData.date = dayjs(summary.summary_date).format('YYYY-MM-DD');
    } else if (summary.summary_type === 'weekly') {
      // 从summary_date提取周
      const summaryDate = dayjs(summary.summary_date);
      requestData.week = `${summaryDate.year()}-${summaryDate.isoWeek().toString().padStart(2, '0')}`;
    }

    // 保存正在重新生成的摘要ID
    regeneratingSummaryIdRef.current = summary.id;

    // 调用重新生成
    regenerateMutation.mutate(requestData);
  };

  const handleShareLink = (summaryId: number) => {
    const shareUrl = `${window.location.origin}/share/summary/${summaryId}`;
    void copyToClipboard(
      shareUrl,
      {
        onSuccess: (msg) => message.success(msg),
        onInfo: (msg) => message.info(msg),
      },
      '分享链接已复制'
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        removeDetails(id);
        if (selectedIdRef.current === id) {
          setSelectedId(null);
          setReaderOpen(false);
        }
      },
    });
  };

  const handleGenerate = (values: SummaryGenerateFormValues) => {
    const requestData: { summary_type: 'daily' | 'weekly'; date?: string; week?: string } = {
      summary_type: values.summary_type as 'daily' | 'weekly',
    };

    // 根据类型设置不同的参数
    if (values.summary_type === 'daily') {
      if (values.date) {
        requestData.date = dayjs(values.date).format('YYYY-MM-DD');
      }
    } else if (values.summary_type === 'weekly') {
      if (values.week) {
        // week格式: YYYY-WW
        const weekDate = dayjs(values.week);
        requestData.week = `${weekDate.year()}-${weekDate.isoWeek().toString().padStart(2, '0')}`;
      }
    }

    generateMutation.mutate(requestData);
  };

  const handleSavePromptSettings = (values: SummaryPromptSettings) => {
    updatePromptMutation.mutate(values);
  };

  const closeGenerate = () => {
    if (generateMutation.isPending) return;
    setGenerateModalVisible(false);
    setPromptSettingsVisible(false);
    form.resetFields();
    // 提示词表单在对话框打开时会自动从服务器加载，所以这里可以清空
    promptForm.resetFields();
    setSelectedWeekDate(null);
    setHoveredWeekDate(null);
  };

  const isDaySummarized = (current: dayjs.Dayjs) => {
    const dateStr = current.format('YYYY-MM-DD');
    return summaries?.some(
      (s) => s.summary_type === 'daily' && dayjs(s.summary_date).format('YYYY-MM-DD') === dateStr
    ) ?? false;
  };

  const isWeekSummarized = (current: dayjs.Dayjs) =>
    summaries?.some((s) => {
      if (s.summary_type !== 'weekly') return false;
      const summaryDate = dayjs(s.summary_date);
      return summaryDate.year() === current.year() && summaryDate.isoWeek() === current.isoWeek();
    }) ?? false;

  const promptPanel = promptSettingsVisible && (
    <div className="summary-prompt">
      <div className="summary-prompt__head">
        <span className="eyebrow">提示词设置</span>
      </div>
      <Spin spinning={summaryPromptLoading || updatePromptMutation.isPending}>
        <Form form={promptForm} onFinish={handleSavePromptSettings} layout="vertical">
          <Form.Item
            name="daily_summary_prompt"
            label="按天总结提示词"
            rules={[{ required: true, message: '请输入按天总结提示词' }]}
          >
            <TextArea autoSize={{ minRows: 6, maxRows: 16 }} />
          </Form.Item>
          <Form.Item
            name="weekly_summary_prompt"
            label="按周总结提示词"
            rules={[{ required: true, message: '请输入按周总结提示词' }]}
          >
            <TextArea autoSize={{ minRows: 8, maxRows: 18 }} />
          </Form.Item>
          <div className="summary-prompt__hint">
            可用变量：<code>{'{{time_str}}'}</code> / <code>{'{{date_range}}'}</code> / <code>{'{{articles}}'}</code>
          </div>
          <div className="summary-prompt__actions">
            <Button
              type="primary"
              size="small"
              htmlType="submit"
              loading={updatePromptMutation.isPending}
              disabled={!isAuthenticated}
            >
              保存提示词
            </Button>
            <Button
              size="small"
              onClick={() => {
                if (summaryPromptSettings) {
                  promptForm.setFieldsValue({
                    daily_summary_prompt: summaryPromptSettings.daily_summary_prompt,
                    weekly_summary_prompt: summaryPromptSettings.weekly_summary_prompt,
                  });
                }
              }}
              disabled={!summaryPromptSettings}
            >
              重置
            </Button>
          </div>
        </Form>
      </Spin>
    </div>
  );

  const generateBody = (
    <Spin spinning={generateMutation.isPending}>
      {generateMutation.isPending && (
        <Alert
          message="正在生成摘要"
          description="摘要生成后，AI 会在后台继续绘制封面与趋势配图（约需数分钟），绘制完成后自动显示。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {promptPanel}
      <Form form={form} onFinish={handleGenerate} layout="vertical">
        <Form.Item
          name="summary_type"
          label="摘要类型"
          initialValue="daily"
          rules={[{ required: true }]}
        >
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio value="daily">按天总结</Radio>
            <Radio value="weekly">按周总结</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          noStyle
          shouldUpdate={(prevValues, currentValues) => prevValues.summary_type !== currentValues.summary_type}
        >
          {({ getFieldValue }) => {
            const summaryType = getFieldValue('summary_type');
            return (
              <>
                {summaryType === 'daily' && (
                  <Form.Item
                    name="date"
                    label="选择日期"
                    tooltip="不选择则默认为今天，已总结的日期会显示为灰色"
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      format="YYYY-MM-DD"
                      placeholder="选择日期（默认今天）"
                      dateRender={(current) => (
                        <div className={`summary-cal-cell${isDaySummarized(current) ? ' summary-cal-cell--done' : ''}`}>
                          {current.date()}
                        </div>
                      )}
                    />
                  </Form.Item>
                )}
                {summaryType === 'weekly' && (
                  <Form.Item
                    name="week"
                    label="选择周"
                    tooltip="选择该周的任意一天，系统会自动识别该周。不选择则默认为本周，已总结的周会显示为灰色"
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      format="YYYY-MM-DD"
                      placeholder="选择周（默认本周）"
                      onChange={(date) => {
                        setSelectedWeekDate(date);
                      }}
                      dateRender={(current) => {
                        // 优先显示选中状态，然后是悬停状态
                        const stateClass = isInWeekRange(current, selectedWeekDate)
                          ? ' summary-cal-cell--week-selected'
                          : isInWeekRange(current, hoveredWeekDate)
                            ? ' summary-cal-cell--week-hover'
                            : isWeekSummarized(current)
                              ? ' summary-cal-cell--done'
                              : '';
                        return (
                          <div
                            className={`summary-cal-cell${stateClass}`}
                            onMouseEnter={() => setHoveredWeekDate(current)}
                            onMouseLeave={() => setHoveredWeekDate(null)}
                          >
                            {current.date()}
                          </div>
                        );
                      }}
                    />
                  </Form.Item>
                )}
              </>
            );
          }}
        </Form.Item>
      </Form>
    </Spin>
  );

  const settingsToggle = (
    <Tooltip title="提示词设置">
      <button
        type="button"
        className={`icon-btn${promptSettingsVisible ? ' icon-btn--active' : ''}`}
        onClick={() => setPromptSettingsVisible((prev) => !prev)}
        disabled={generateMutation.isPending}
        aria-label="提示词设置"
        aria-pressed={promptSettingsVisible}
      >
        <SettingOutlined />
      </button>
    </Tooltip>
  );

  const generateDialog = isMobile ? (
    <Drawer
      title="生成新摘要"
      placement="bottom"
      height="auto"
      open={generateModalVisible}
      onClose={closeGenerate}
      className="m-sheet"
      closable={!generateMutation.isPending}
      maskClosable={!generateMutation.isPending}
      extra={settingsToggle}
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
    >
      {generateBody}
      <div className="summary-gen__sheet-actions">
        <Button onClick={closeGenerate} disabled={generateMutation.isPending}>
          取消
        </Button>
        <Button type="primary" onClick={() => form.submit()} loading={generateMutation.isPending}>
          {generateMutation.isPending ? '正在生成...' : '生成'}
        </Button>
      </div>
    </Drawer>
  ) : (
    <Modal
      title={(
        <div className="summary-gen__title">
          <span>生成新摘要</span>
          {settingsToggle}
        </div>
      )}
      open={generateModalVisible}
      onCancel={closeGenerate}
      onOk={() => form.submit()}
      confirmLoading={generateMutation.isPending}
      okText={generateMutation.isPending ? '正在生成...' : '生成'}
      cancelButtonProps={{ disabled: generateMutation.isPending }}
      width={600}
      closable={!generateMutation.isPending}
      maskClosable={!generateMutation.isPending}
    >
      {generateBody}
    </Modal>
  );

  const typeSegmented = (
    <Segmented
      size={isMobile ? 'middle' : 'small'}
      block
      value={typeFilter}
      onChange={(v) => {
        setTypeFilter(v as SummaryTypeFilter);
        listRef.current?.scrollTo({ top: 0 });
      }}
      options={TYPE_FILTERS}
    />
  );

  const countLabel = isLoading ? (
    <span className="feed-toolbar__count">加载中…</span>
  ) : (
    <span className="feed-toolbar__count">
      <strong>{items.length}</strong> 份摘要
      {typeFilter !== 'all' ? ` · ${TYPE_LABEL[typeFilter]}` : ''}
    </span>
  );

  const toolbarActions = (
    <div className="summary-toolbar__actions">
      <Tooltip title="刷新">
        <button type="button" className="icon-btn" onClick={() => refetch()} aria-label="刷新">
          <ReloadOutlined spin={isFetching && !isLoading} />
        </button>
      </Tooltip>
      {isAuthenticated && (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setGenerateModalVisible(true)}
        >
          生成
        </Button>
      )}
    </div>
  );

  const listBody = isLoading ? (
    <div style={{ padding: '12px 14px' }}>
      <Skeleton active title={false} paragraph={{ rows: 10 }} />
    </div>
  ) : error ? (
    <Empty description="加载失败，请稍后重试" style={{ padding: '48px 0' }} />
  ) : items.length === 0 ? (
    <Empty
      description={summaries && summaries.length > 0 ? '没有该类型的摘要' : '暂无摘要'}
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      style={{ padding: '48px 0' }}
    />
  ) : (
    groups.map((group) => (
      <div key={group.key}>
        <div className="feed-day eyebrow">
          {group.label}
          <span style={{ letterSpacing: 0 }}>{group.items.length}</span>
        </div>
        {group.items.map((summary) => (
          <SummaryRow
            key={summary.id}
            summary={summary}
            active={!isMobile && selectedId === summary.id}
            onSelect={selectSummary}
          />
        ))}
      </div>
    ))
  );

  const renderReader = (summary: DailySummaryListItem, onBack?: () => void) => (
    <SummaryReader
      key={summary.id}
      summary={summary}
      details={loadedDetails.get(summary.id)}
      loading={loadingDetails.has(summary.id) || !failedDetails.has(summary.id)}
      onRetry={() => void loadSummaryDetails(summary.id, true)}
      canEdit={isAuthenticated}
      regenerating={regenerateMutation.isPending && regeneratingSummaryIdRef.current === summary.id}
      deleting={deleteMutation.isPending}
      generatingArt={
        (artMutation.isPending && artMutation.variables === summary.id) ||
        (backgroundDrawing && selectedId === summary.id)
      }
      onGenerateArt={() => artMutation.mutate(summary.id)}
      onShare={() => handleShareLink(summary.id)}
      onRegenerate={() => handleRegenerate(summary)}
      onDelete={() => handleDelete(summary.id)}
      onBack={onBack}
    />
  );

  if (isMobile) {
    return (
      <div className="m-feed">
        <div className="m-feed__toolbar">
          {typeSegmented}
          <div className="feed-toolbar__row">
            {countLabel}
            {toolbarActions}
          </div>
        </div>

        <div className="m-feed__list" ref={listRef}>
          {listBody}
        </div>

        <Drawer
          open={readerOpen}
          onClose={() => setReaderOpen(false)}
          placement="right"
          width="100%"
          closable={false}
          className="m-reader"
          styles={{ header: { display: 'none' }, body: { padding: 0 } }}
          destroyOnHidden
        >
          {selectedSummary && renderReader(selectedSummary, () => setReaderOpen(false))}
        </Drawer>

        {generateDialog}
      </div>
    );
  }

  return (
    <div className="feed-split">
      <section className="feed-split__list" aria-label="摘要列表">
        <div className="feed-toolbar">
          <div className="feed-toolbar__row">
            {countLabel}
            {toolbarActions}
          </div>
          {typeSegmented}
        </div>
        <div className="feed-list" ref={listRef}>
          {listBody}
        </div>
      </section>

      <section className="feed-split__reader" aria-label="摘要阅读面板">
        {selectedSummary ? (
          renderReader(selectedSummary)
        ) : (
          <div className="reader__empty">
            <span className="reader__empty-mark">
              <FileTextOutlined />
            </span>
            <div>{isLoading ? '加载中…' : '选择一份摘要开始阅读'}</div>
            {!isLoading && (summaries?.length ?? 0) === 0 && isAuthenticated && (
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setGenerateModalVisible(true)}>
                生成第一份摘要
              </Button>
            )}
          </div>
        )}
      </section>

      {generateDialog}
    </div>
  );
}
