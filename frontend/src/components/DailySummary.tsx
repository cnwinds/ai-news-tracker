/**
 * 内容摘要组件
 */
import { useState } from 'react';
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
  message,
  Spin,
  Alert,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { SummaryGenerateRequest, Article, DailySummaryListItem, SummaryFieldsResponse } from '@/types';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useTheme } from '@/contexts/ThemeContext';
import { createMarkdownComponents } from '@/utils/markdown';
import { getThemeColor, getSelectedStyle } from '@/utils/theme';
import { showError } from '@/utils/error';
import ArticleCard from './ArticleCard';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const { Title } = Typography;

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
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());
  const [selectedWeekDate, setSelectedWeekDate] = useState<dayjs.Dayjs | null>(null);
  const [hoveredWeekDate, setHoveredWeekDate] = useState<dayjs.Dayjs | null>(null);
  const [recommendedArticles, setRecommendedArticles] = useState<Map<number, Article[]>>(new Map());
  const [loadingArticles, setLoadingArticles] = useState<Set<number>>(new Set());
  const { theme } = useTheme();

  const { data: summaries, isLoading } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => apiService.getSummaries(50),
  });
  
  // 存储已加载的摘要详情
  const [loadedDetails, setLoadedDetails] = useState<Map<number, SummaryFieldsResponse>>(new Map());

  const generateMutation = useMutation({
    mutationFn: (data: SummaryGenerateRequest) =>
      apiService.generateSummary(data),
    onSuccess: () => {
      message.success('摘要生成成功');
      setGenerateModalVisible(false);
      form.resetFields();
      setSelectedWeekDate(null);
      setHoveredWeekDate(null);
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error) => {
      showError(error, '生成摘要失败');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (data: SummaryGenerateRequest) =>
      apiService.generateSummary(data),
    onSuccess: () => {
      message.success('摘要重新生成成功');
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error) => {
      showError(error, '重新生成摘要失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSummary(id),
    onSuccess: () => {
      message.success('摘要已删除');
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error) => {
      showError(error, '删除摘要失败');
    },
  });

  const handleRegenerate = (summary: DailySummaryListItem) => {
    const requestData: { summary_type: 'daily' | 'weekly'; date?: string; week?: string } = {
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

    regenerateMutation.mutate(requestData);
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

  const handleGenerate = (values: any) => {
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

  // 加载推荐文章（只获取基本字段，详细字段由ArticleCard按需加载）
  const loadRecommendedArticles = async (summary: DailySummaryListItem & { recommended_articles?: Array<{ id: number; title: string; reason: string }> }) => {
    if (!summary.recommended_articles || summary.recommended_articles.length === 0) {
      return;
    }

    const summaryId = summary.id;

    // 如果已经加载过，直接返回
    if (recommendedArticles.has(summaryId)) {
      return;
    }

    // 设置加载状态
    setLoadingArticles((prev) => new Set(prev).add(summaryId));

    try {
      // 批量获取文章的基本字段（不包含content、summary等大字段）
      // ArticleCard会自己按需加载详细字段
      const articleIds = summary.recommended_articles.map(rec => rec.id);
      const articles = await apiService.getArticlesBasic(articleIds);

      // 保存到状态
      setRecommendedArticles((prev) => {
        const newMap = new Map(prev);
        newMap.set(summaryId, articles);
        return newMap;
      });
    } catch (error) {
      console.error('加载推荐文章失败:', error);
      message.error('加载推荐文章失败');
    } finally {
      setLoadingArticles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(summaryId);
        return newSet;
      });
    }
  };

  // 按需加载摘要详情
  const loadSummaryDetails = async (summaryId: number) => {
    // 如果已经加载过，直接返回
    if (loadedDetails.has(summaryId)) {
      return;
    }

    try {
      const details = await apiService.getSummaryFields(summaryId, 'all');
      setLoadedDetails((prev) => {
        const newMap = new Map(prev);
        newMap.set(summaryId, details);
        return newMap;
      });
      
      // 如果有推荐文章，加载推荐文章
      if (details.recommended_articles && details.recommended_articles.length > 0) {
        const summary = summaries?.find(s => s.id === summaryId);
        if (summary) {
          // 使用加载的推荐文章信息
          const summaryWithDetails: DailySummaryListItem & { recommended_articles?: Array<{ id: number; title: string; reason: string }> } = {
            ...summary,
            recommended_articles: details.recommended_articles,
          };
          loadRecommendedArticles(summaryWithDetails);
        }
      }
    } catch (error) {
      console.error('加载摘要详情失败:', error);
      message.error('加载摘要详情失败');
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
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setGenerateModalVisible(true)}
          >
            生成新摘要
          </Button>
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
                  bodyStyle={{ padding: '12px 16px' }}
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
                          if (!details) {
                            // 正在加载详情
                            return (
                              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <Spin tip="加载摘要内容..." />
                              </div>
                            );
                          }
                          
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
                                <ReactMarkdown components={createMarkdownComponents(theme)}>
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
                              {/* 推荐文章列表 */}
                              {details.recommended_articles && details.recommended_articles.length > 0 && (
                                <div style={{ marginTop: '16px' }}>
                                  <Title level={5} style={{ marginBottom: '12px', color: getThemeColor(theme, 'text') }}>
                                    推荐文章 ({details.recommended_articles.length})
                                  </Title>
                                  {loadingArticles.has(summary.id) ? (
                                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                      <Spin />
                                    </div>
                                  ) : recommendedArticles.has(summary.id) ? (
                                    <div>
                                      {recommendedArticles.get(summary.id)?.map((article) => (
                                        <ArticleCard key={article.id} article={article} />
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
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
        title="生成新摘要"
        open={generateModalVisible}
        onCancel={() => {
          if (!generateMutation.isPending) {
            setGenerateModalVisible(false);
            form.resetFields();
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
        <Spin spinning={generateMutation.isPending} tip="正在生成摘要，请稍候...">
          {generateMutation.isPending && (
            <Alert
              message="正在生成摘要"
              description="摘要生成可能需要一些时间，请耐心等待。生成完成后会自动刷新列表。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
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



