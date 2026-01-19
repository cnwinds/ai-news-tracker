/**
 * RAG语义搜索组件
 */
import { useState, useMemo } from 'react';
import { Card, Input, Select, Space, List, Tag, Typography, Empty, Spin, Alert, Button, DatePicker, Tooltip } from 'antd';
import { SearchOutlined, LinkOutlined, StarFilled } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { apiService } from '@/services/api';
import type { RAGSearchRequest, ArticleSearchResult } from '@/types';
import dayjs from 'dayjs';
import { useTheme } from '@/contexts/ThemeContext';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import { getThemeColor } from '@/utils/theme';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import { IMPORTANCE_COLORS, getImportanceLabel } from '@/utils/article';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const { Option, OptGroup } = Select;

export default function RAGSearch() {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [importance, setImportance] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [topK, setTopK] = useState(10);
  const { theme } = useTheme();

  // 获取订阅源列表
  const { data: sourcesList } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  // 按类型分组订阅源
  const groupedSources = useMemo(() => {
    if (!sourcesList) return {};
    return groupSourcesByType(sourcesList);
  }, [sourcesList]);

  // 搜索mutation
  const searchMutation = useMutation({
    mutationFn: (request: RAGSearchRequest) => apiService.searchArticles(request),
  });

  const handleSearch = () => {
    if (!query.trim()) {
      return;
    }

    const request: RAGSearchRequest = {
      query: query.trim(),
      top_k: topK,
    };

    if (sources.length > 0) {
      request.sources = sources;
    }

    if (importance.length > 0) {
      request.importance = importance;
    }

    if (timeRange[0] && timeRange[1]) {
      request.time_from = timeRange[0].toISOString();
      request.time_to = timeRange[1].toISOString();
    }

    searchMutation.mutate(request);
  };

  // 移除 handleKeyPress，因为 Input.Search 的 onSearch 已经处理了 Enter 键

  const formatSimilarity = (similarity: number): string => {
    return `${(similarity * 100).toFixed(1)}%`;
  };

  return (
    <div>
      <Card
        title="🔍 语义搜索"
        extra={
          <Space>
            <Text type="secondary">返回数量：</Text>
            <Select
              value={topK}
              onChange={setTopK}
              style={{ width: 80 }}
              options={[
                { label: '5', value: 5 },
                { label: '10', value: 10 },
                { label: '20', value: 20 },
                { label: '50', value: 50 },
              ]}
            />
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 搜索框 */}
          <Input.Search
            placeholder="输入搜索关键词，支持自然语言查询..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={handleSearch}
            enterButton={<SearchOutlined />}
            size="large"
            loading={searchMutation.isPending}
          />

          {/* 筛选器 */}
          <Space wrap>
            <Select
              mode="multiple"
              placeholder="选择来源"
              style={{ minWidth: 200 }}
              value={sources}
              onChange={setSources}
              allowClear
              showSearch
              maxTagCount="responsive"
              filterOption={(input, option) => {
                if (option?.type === 'group') return true;
                const label = String(option?.label ?? '');
                return label.toLowerCase().includes(input.toLowerCase());
              }}
            >
              {Object.entries(groupedSources).map(([type, sourcesList]) => (
                <OptGroup 
                  key={type} 
                  label={`${SOURCE_TYPE_LABELS[type] || type} (${sourcesList.length})`}
                >
                  {sourcesList.map((source) => (
                    <Option key={source.id} value={source.name} label={source.name}>
                      {source.name}
                    </Option>
                  ))}
                </OptGroup>
              ))}
            </Select>

            <Select
              mode="multiple"
              placeholder="选择重要性"
              style={{ minWidth: 150 }}
              value={importance}
              onChange={setImportance}
              allowClear
              options={[
                { label: '高', value: 'high' },
                { label: '中', value: 'medium' },
                { label: '低', value: 'low' },
              ]}
            />

            <RangePicker
              value={timeRange}
              onChange={(dates) => setTimeRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
              showTime
              format="YYYY-MM-DD HH:mm"
              placeholder={['开始时间', '结束时间']}
            />

            <Button onClick={() => {
              setQuery('');
              setSources([]);
              setImportance([]);
              setTimeRange([null, null]);
            }}>
              清除筛选
            </Button>
          </Space>

          {/* 搜索结果 */}
          {searchMutation.isPending ? (
            <div style={{ textAlign: 'center', padding: '50px 0' }}>
              <Spin size="large" />
            </div>
          ) : searchMutation.error ? (
            <Alert
              message="搜索失败"
              description={searchMutation.error instanceof Error ? searchMutation.error.message : '未知错误'}
              type="error"
              showIcon
            />
          ) : searchMutation.data ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary">
                  找到 {searchMutation.data.total} 条相关结果
                  {searchMutation.data.query && `（查询："${searchMutation.data.query}"）`}
                </Text>
              </div>

              {searchMutation.data.results.length === 0 ? (
                <Empty description="未找到相关文章" />
              ) : (
                <List
                  dataSource={searchMutation.data.results}
                  renderItem={(item: ArticleSearchResult) => (
                    <List.Item>
                      <Card
                        style={{ width: '100%', marginBottom: 8 }}
                        size="small"
                      >
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            {item.importance && (
                              <Tag color={IMPORTANCE_COLORS[item.importance]}>
                                {getImportanceLabel(item.importance)}
                              </Tag>
                            )}
                            <Tag color="blue">{item.source}</Tag>
                            {item.is_favorited && (
                              <Tooltip title="已收藏">
                                <StarFilled style={{ color: '#faad14', fontSize: 14 }} />
                              </Tooltip>
                            )}
                            <Tag color="purple">相似度: {formatSimilarity(item.similarity)}</Tag>
                          </div>

                          {item.title_zh ? (
                            <Tooltip title={item.title} placement="top">
                              <Title level={5} style={{ marginBottom: 8, cursor: 'help' }}>
                                {item.title_zh}
                              </Title>
                            </Tooltip>
                          ) : (
                            <Title level={5} style={{ marginBottom: 8 }}>
                              {item.title}
                            </Title>
                          )}

                          {item.summary && (
                            <div
                              style={{
                                fontSize: 14,
                                color: getThemeColor(theme, 'textSecondary'),
                                lineHeight: 1.6,
                              }}
                            >
                              <ReactMarkdown 
                                components={createMarkdownComponents(theme)}
                                remarkPlugins={[remarkGfm]}
                              >
                                {item.summary}
                              </ReactMarkdown>
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <Space>
                              {item.published_at && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {dayjs(item.published_at).format('YYYY-MM-DD HH:mm')}
                                </Text>
                              )}
                            </Space>
                            <Button
                              type="link"
                              icon={<LinkOutlined />}
                              href={item.url}
                              target="_blank"
                              size="small"
                            >
                              查看原文
                            </Button>
                          </div>
                        </Space>
                      </Card>
                    </List.Item>
                  )}
                />
              )}
            </>
          ) : (
            <Empty description="输入关键词开始搜索" />
          )}
        </Space>
      </Card>
    </div>
  );
}
