/**
 * 文章列表组件
 */
import { useState, useMemo } from 'react';
import { Card, Select, Radio, Space, Pagination, Spin, Empty, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useArticles } from '@/hooks/useArticles';
import ArticleCard from './ArticleCard';
import { apiService } from '@/services/api';
import type { ArticleFilter } from '@/types';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';

const { Option, OptGroup } = Select;

const TIME_RANGES = ['今天', '最近3天', '最近7天', '最近30天', '全部'] as const;

export default function ArticleList() {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<ArticleFilter>({
    time_range: '全部',
    page: 1,
    page_size: 20,
    source_filter_mode: 'include', // 默认正向过滤
  });

  const { data, isLoading, error, refetch, isFetching } = useArticles(filter);

  // 获取所有订阅源列表
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  // 按类型分组订阅源
  const groupedSources = useMemo(() => {
    if (!sources) return {};
    return groupSourcesByType(sources);
  }, [sources]);

  const handleTimeRangeChange = (value: string) => {
    setFilter((prev) => ({ ...prev, time_range: value, page: 1 }));
  };

  const handleSourceChange = (value: string[]) => {
    setFilter((prev) => {
      const isExcludeMode = prev.source_filter_mode === 'exclude';
      return {
        ...prev,
        [isExcludeMode ? 'exclude_sources' : 'sources']: value.length > 0 ? value : undefined,
        // 清除另一个模式的选中值
        [isExcludeMode ? 'sources' : 'exclude_sources']: undefined,
        page: 1,
      };
    });
  };

  const handleFilterModeChange = (mode: 'include' | 'exclude') => {
    setFilter((prev) => {
      // 切换模式时，将当前选中的来源转移到对应的字段
      const currentSources = mode === 'exclude' ? prev.sources : prev.exclude_sources;
      return {
        ...prev,
        source_filter_mode: mode,
        [mode === 'exclude' ? 'exclude_sources' : 'sources']: currentSources,
        [mode === 'exclude' ? 'sources' : 'exclude_sources']: undefined,
        page: 1,
      };
    });
  };

  const handlePageChange = (page: number, pageSize: number) => {
    setFilter((prev) => ({ ...prev, page, page_size: pageSize }));
  };

  return (
    <div>
      <Card
        title={
          <Space>
                <span>📰 最新AI资讯</span>
            {data && !isLoading && (
              <>
                <span style={{ color: '#8c8c8c', fontSize: '14px', fontWeight: 'normal' }}>
                  找到 {data.total} 篇文章
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => refetch()}
                  loading={isFetching}
                  title="刷新"
                />
              </>
            )}
          </Space>
        }
        extra={
          <Space>
            <Space.Compact style={{ display: 'flex', alignItems: 'stretch' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 12px',
                height: '32px',
                backgroundColor: getThemeColor(theme, 'bgElevated'),
                border: `1px solid ${getThemeColor(theme, 'border')}`,
                borderRight: 'none',
                borderTopLeftRadius: '6px',
                borderBottomLeftRadius: '6px',
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => handleFilterModeChange(filter.source_filter_mode === 'exclude' ? 'include' : 'exclude')}
              >
                <span style={{
                  fontSize: '13px',
                  color: getThemeColor(theme, 'text'),
                  fontWeight: 400,
                  userSelect: 'none',
                }}>
                  {filter.source_filter_mode === 'exclude' ? '排除' : '包含'}
                </span>
              </div>
              <Select
                mode="multiple"
                placeholder={
                  filter.source_filter_mode === 'exclude' 
                    ? '排除订阅来源' 
                    : '选择订阅来源'
                }
                style={{ 
                  minWidth: 250,
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                }}
                value={
                  filter.source_filter_mode === 'exclude' 
                    ? filter.exclude_sources 
                    : filter.sources
                }
                onChange={handleSourceChange}
                allowClear
                maxTagCount="responsive"
                showSearch
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
            </Space.Compact>
            <Radio.Group
              value={filter.time_range}
              onChange={(e) => handleTimeRangeChange(e.target.value)}
              options={TIME_RANGES.map((range) => ({ label: range, value: range }))}
              optionType="button"
              buttonStyle="solid"
            />
          </Space>
        }
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : error ? (
          <Alert message="加载失败" type="error" showIcon />
        ) : !data || data.items.length === 0 ? (
          <Empty description="暂无文章" />
        ) : (
          <>
            {data.items.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Pagination
                current={data.page}
                total={data.total}
                pageSize={data.page_size}
                showSizeChanger
                showTotal={(total) => `共 ${total} 条`}
                onChange={handlePageChange}
                onShowSizeChange={handlePageChange}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}


