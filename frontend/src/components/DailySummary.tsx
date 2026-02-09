/**
 * 内容摘要组件
 */
import { useEffect, useState, useRef } from 'react';
import {
  Card,
  Button,
  List,
  Typography,
  Space,
  Tag,
  Modal,
  Form,
  Radio,
  DatePicker,
  Spin,
  Alert,
  Input,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, DownOutlined, UpOutlined, SettingOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useMessage } from '@/hooks/useMessage';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type {
  SummaryGenerateRequest,
  DailySummaryListItem,
  SummaryFieldsResponse,
  SummaryGenerateFormValues,
  SummaryPromptSettings,
} from '@/types';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import { getThemeColor, getSelectedStyle } from '@/utils/theme';
import { copyToClipboard } from '@/utils/clipboard';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const { Title, Text } = Typography;
const { TextArea } = Input;

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

export default function DailySummary() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [promptSettingsVisible, setPromptSettingsVisible] = useState(false);
  const [form] = Form.useForm();
  const [promptForm] = Form.useForm();
  const queryClient = useQueryClient();
  const message = useMessage();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());
  const [selectedWeekDate, setSelectedWeekDate] = useState<dayjs.Dayjs | null>(null);
  const [hoveredWeekDate, setHoveredWeekDate] = useState<dayjs.Dayjs | null>(null);
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  // 保存正在重新生成的摘要ID
  const regeneratingSummaryIdRef = useRef<number | null>(null);

  const { data: summaries, isLoading } = useQuery({
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

  useEffect(() => {
    // 当对话框打开且数据加载完成时，设置表单值
    if (generateModalVisible && summaryPromptSettings && !summaryPromptLoading) {
      promptForm.setFieldsValue({
        daily_summary_prompt: summaryPromptSettings.daily_summary_prompt || '',
        weekly_summary_prompt: summaryPromptSettings.weekly_summary_prompt || '',
      });
    }
  }, [generateModalVisible, summaryPromptSettings, summaryPromptLoading, promptForm]);

  const generateMutation = useMutation({
    mutationFn: (data: SummaryGenerateRequest) =>
      apiService.generateSummary(data),
    onSuccess: () => {
      showSuccess('摘要生成成功');
      setGenerateModalVisible(false);
      setPromptSettingsVisible(false);
      form.resetFields();
      setSelectedWeekDate(null);
      setHoveredWeekDate(null);
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
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
      
      // 如果该摘要已展开，先清除其缓存和加载状态
      const summaryId = regeneratingSummaryIdRef.current;
      if (summaryId !== null && expandedSummaries.has(summaryId)) {
        // 清除已加载的详情缓存
        setLoadedDetails((prev) => {
          const newMap = new Map(prev);
          newMap.delete(summaryId);
          return newMap;
        });
        // 清除加载状态
        setLoadingDetails((prev) => {
          const newSet = new Set(prev);
          newSet.delete(summaryId);
          return newSet;
        });
      }
      
      // 刷新摘要列表
      await queryClient.invalidateQueries({ queryKey: ['summaries'] });
      
      // 等待列表刷新完成后重新加载详情
      if (summaryId !== null && expandedSummaries.has(summaryId)) {
        // 使用 Promise 等待列表数据刷新
        await queryClient.refetchQueries({ queryKey: ['summaries'] });
        
        // 强制重新加载详情（延迟一点确保列表已更新）
        setTimeout(() => {
          loadSummaryDetails(summaryId, true);
        }, 200);
      }
      
      // 清除 ref
      regeneratingSummaryIdRef.current = null;
    },
    onError: (error) => {
      regeneratingSummaryIdRef.current = null;
      createErrorHandler({
        operationName: '重新生成摘要',
        customMessages: {
          auth: '需要登录才能重新生成摘要',
        },
      })(error);
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
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个摘要吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteMutation.mutate(id);
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

  // 按需加载摘要详情
  const loadSummaryDetails = async (summaryId: number, forceReload: boolean = false) => {
    // 如果已经加载过且不是强制重新加载，直接返回
    if (!forceReload && loadedDetails.has(summaryId)) {
      return;
    }

    // 如果正在加载，避免重复加载
    if (loadingDetails.has(summaryId)) {
      return;
    }

    // 设置加载状态
    setLoadingDetails((prev) => new Set(prev).add(summaryId));

    try {
      const details = await apiService.getSummaryFields(summaryId, 'all');
      setLoadedDetails((prev) => {
        const newMap = new Map(prev);
        newMap.set(summaryId, details);
        return newMap;
      });
    } catch (error) {
      console.error('加载摘要详情失败:', error);
      message.error('加载摘要详情失败');
      // 如果加载失败，从缓存中移除
      setLoadedDetails((prev) => {
        const newMap = new Map(prev);
        newMap.delete(summaryId);
        return newMap;
      });
    } finally {
      // 清除加载状态
      setLoadingDetails((prev) => {
        const newSet = new Set(prev);
        newSet.delete(summaryId);
        return newSet;
      });
    }
  };

  const toggleExpand = (summary: DailySummaryListItem) => {
    const summaryId = summary.id;
    setExpandedSummaries((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(summaryId)) {
        newSet.delete(summaryId);
      } else {
        newSet.add(summaryId);
        // 展开时加载摘要详情
        loadSummaryDetails(summaryId);
      }
      return newSet;
    });
  };

  return (
    <div>
      <Card
        title="📊 内容总结"
        extra={
          isAuthenticated ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGenerateModalVisible(true)}
            >
              生成新摘要
            </Button>
          ) : null
        }
      >
        {isLoading ? (
          <div>加载中...</div>
        ) : !summaries || summaries.length === 0 ? (
          <div>暂无摘要</div>
        ) : (
          <List
            dataSource={summaries}
            renderItem={(summary) => (
              <List.Item style={{ padding: 0, marginBottom: 8 }}>
                <Card
                  style={{ width: '100%', marginBottom: 0 }}
                  styles={{ body: { padding: '12px 16px' } }}
                >
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {/* 第一行（概览）：标题 + 统计Tag + 展开按钮，整行可点击 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '2px 0',
                      }}
                      onClick={() => toggleExpand(summary)}
                    >
                      {/* 标题 */}
                      <Title level={5} style={{ marginBottom: 0, display: 'inline', flexShrink: 0 }}>
                        {summary.summary_type === 'daily'
                          ? `每日摘要 - ${dayjs(summary.summary_date).format('YYYY-MM-DD')}`
                          : `每周摘要 - ${dayjs(summary.start_date).format('YYYY-MM-DD')} 至 ${dayjs(summary.end_date).format('YYYY-MM-DD')}`
                        }
                      </Title>

                      {/* 统计Tag */}
                      <Tag style={{ flexShrink: 0 }}>文章数: {summary.total_articles}</Tag>
                      <Tag color="red" style={{ flexShrink: 0 }}>高重要性: {summary.high_importance_count}</Tag>
                      <Tag color="orange" style={{ flexShrink: 0 }}>中重要性: {summary.medium_importance_count}</Tag>

                      {/* 展开/收起图标 - 推到最右边 */}
                      <Button
                        type="text"
                        icon={expandedSummaries.has(summary.id) ? <UpOutlined /> : <DownOutlined />}
                        size="small"
                        style={{ flexShrink: 0, marginLeft: 'auto' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(summary);
                        }}
                      />
                    </div>
                    {expandedSummaries.has(summary.id) && (
                      <>
                        {(() => {
                          const details = loadedDetails.get(summary.id);
                          const isLoading = loadingDetails.has(summary.id);
                          
                          if (!details) {
                            if (isLoading) {
                              // 正在加载详情
                              return (
                                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                  <Spin size="large" />
                                </div>
                              );
                            } else {
                              // 加载失败或未加载，尝试重新加载
                              loadSummaryDetails(summary.id);
                              return (
                                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                  <Spin size="large" />
                                </div>
                              );
                            }
                          }
                          
                          // details 已确认存在，可以安全使用
                          return (
                            <>
                              <div
                                style={{
                                  padding: '16px',
                                  backgroundColor: getThemeColor(theme, 'bgSecondary'),
                                  borderRadius: '4px',
                                  border: `1px solid ${getThemeColor(theme, 'border')}`,
                                  color: getThemeColor(theme, 'text'),
                                }}
                              >
                                <ReactMarkdown 
                                  components={createMarkdownComponents(theme)}
                                  remarkPlugins={[remarkGfm]}
                                >
                                  {details.summary_content || ''}
                                </ReactMarkdown>
                              </div>
                              {details.key_topics && details.key_topics.length > 0 && (
                                <div>
                                  <strong style={{ color: getThemeColor(theme, 'text') }}>
                                    关键主题：
                                  </strong>
                                  {details.key_topics.map((topic, index) => (
                                    <Tag key={index} style={{ marginBottom: 4 }}>
                                      {topic}
                                    </Tag>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                          {isAuthenticated && (
                            <>
                              <Button
                                type="default"
                                icon={<ReloadOutlined />}
                                onClick={() => handleRegenerate(summary)}
                                loading={regenerateMutation.isPending}
                              >
                                重新生成
                              </Button>
                              <Button
                                type="primary"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleDelete(summary.id)}
                                loading={deleteMutation.isPending}
                              >
                                删除
                              </Button>
                            </>
                          )}
                          <Button
                            type="default"
                            icon={<ShareAltOutlined />}
                            onClick={() => handleShareLink(summary.id)}
                          >
                            分享
                          </Button>
                          <Button
                            type="default"
                            icon={<UpOutlined />}
                            onClick={() => toggleExpand(summary)}
                          >
                            收起
                          </Button>
                        </div>
                      </>
                    )}
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <span>生成新摘要</span>
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setPromptSettingsVisible((prev) => !prev)}
              disabled={generateMutation.isPending}
            >
              设置
            </Button>
          </div>
        )}
        open={generateModalVisible}
        onCancel={() => {
          if (!generateMutation.isPending) {
            setGenerateModalVisible(false);
            setPromptSettingsVisible(false);
            form.resetFields();
            // 提示词表单在对话框打开时会自动从服务器加载，所以这里可以清空
            // 但不清空也可以，因为下次打开时会重新加载
            promptForm.resetFields();
            setSelectedWeekDate(null);
            setHoveredWeekDate(null);
          }
        }}
        onOk={() => form.submit()}
        confirmLoading={generateMutation.isPending}
        okText={generateMutation.isPending ? '正在生成...' : '生成'}
        cancelButtonProps={{ disabled: generateMutation.isPending }}
        width={600}
        closable={!generateMutation.isPending}
        maskClosable={!generateMutation.isPending}
      >
        <Spin spinning={generateMutation.isPending}>
          {generateMutation.isPending && (
            <Alert
              message="正在生成摘要"
              description="摘要生成可能需要一些时间，请耐心等待。生成完成后会自动刷新列表。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {promptSettingsVisible && (
            <Card size="small" title="提示词设置" style={{ marginBottom: 16 }}>
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
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    可用变量：{'{{time_str}}'} / {'{{date_range}}'} / {'{{articles}}'}
                  </Text>
                  <div style={{ marginTop: 12 }}>
                    <Space>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={updatePromptMutation.isPending}
                        disabled={!isAuthenticated}
                      >
                        保存提示词
                      </Button>
                      <Button
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
                    </Space>
                  </div>
                </Form>
              </Spin>
            </Card>
          )}
          <Form form={form} onFinish={handleGenerate} layout="vertical">
            <Form.Item
              name="summary_type"
              label="摘要类型"
              initialValue="daily"
              rules={[{ required: true }]}
            >
              <Radio.Group>
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
                          dateRender={(current) => {
                            if (!summaries) {
                              return <div>{current.date()}</div>;
                            }
                            const dateStr = current.format('YYYY-MM-DD');
                            const isSummarized = summaries?.some(
                              (s) =>
                                s.summary_type === 'daily' &&
                                dayjs(s.summary_date).format('YYYY-MM-DD') === dateStr
                            ) ?? false;
                            const backgroundColor = isSummarized
                              ? getThemeColor(theme, 'bgElevated')
                              : 'transparent';

                            const color = isSummarized
                              ? getThemeColor(theme, 'textTertiary')
                              : 'inherit';

                            return (
                              <div
                                style={{
                                  color,
                                  backgroundColor,
                                  borderRadius: '2px',
                                  padding: '2px',
                                  width: '100%',
                                  textAlign: 'center',
                                }}
                              >
                                {current.date()}
                              </div>
                            );
                          }}
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
                            const isInSelectedWeek = isInWeekRange(current, selectedWeekDate);
                            const isInHoveredWeek = isInWeekRange(current, hoveredWeekDate);
                            const isSummarized = summaries ? summaries.some((s) => {
                              if (s.summary_type !== 'weekly') return false;
                              const summaryDate = dayjs(s.summary_date);
                              const currentYear = current.year();
                              const currentWeek = current.isoWeek();
                              return (
                                summaryDate.year() === currentYear &&
                                summaryDate.isoWeek() === currentWeek
                              );
                            }) : false;

                            // 优先显示选中状态，然后是悬停状态
                            const selectedStyle = getSelectedStyle(theme);
                            const primaryColor = getThemeColor(theme, 'primary');
                            const hoverColor = getThemeColor(theme, 'primaryHover');

                            const backgroundColor = isInSelectedWeek
                              ? selectedStyle.backgroundColor
                              : isInHoveredWeek
                                ? getThemeColor(theme, 'calendarHoverBg')
                                : isSummarized
                                  ? getThemeColor(theme, 'bgElevated')
                                  : 'transparent';

                            const border = isInSelectedWeek
                              ? selectedStyle.borderLeft?.replace('3px', '1px') || `1px solid ${primaryColor}`
                              : isInHoveredWeek
                                ? `1px solid ${hoverColor}`
                                : 'none';

                            return (
                              <div
                                style={{
                                  color: isSummarized
                                    ? getThemeColor(theme, 'textTertiary')
                                    : 'inherit',
                                  backgroundColor,
                                  borderRadius: '2px',
                                  padding: '2px',
                                  width: '100%',
                                  textAlign: 'center',
                                  border,
                                  cursor: 'pointer',
                                  transition: 'background-color 0.2s, border 0.2s',
                                }}
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
      </Modal>
    </div>
  );
}



