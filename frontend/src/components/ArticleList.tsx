/**
 * 文章列表组件
 */
import { useState, useMemo } from 'react';
import { Card, Select, Radio, Space, Pagination, Spin, Empty, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useArticles } from '@/hooks/useArticles';
import ArticleCard from './ArticleCard';
import { apiService } from '@/services/api';
import type { ArticleFilter, RSSSource } from '@/types';

const { Option, OptGroup } = Select;

export default function ArticleList() {
  const [filter, setFilter] = useState<ArticleFilter>({
    time_range: '全部',
    page: 1,
    page_size: 20,
  });

  const { data, isLoading, error } = useArticles(filter);

  // 获取所有订阅源列表
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  // 规范化源类型
  const normalizeSourceType = (type: string | undefined): string => {
    if (!type) return 'rss';
    const normalized = type.toLowerCase().trim();
    if (normalized === 'social' || normalized === 'social_media') return 'social';
    if (normalized === 'rss' || normalized === 'rss_feed') return 'rss';
    if (normalized === 'api' || normalized === 'api_source') return 'api';
    if (normalized === 'web' || normalized === 'web_source') return 'web';
    return normalized;
  };

  // 按类型分组订阅源
  const groupedSources = useMemo(() => {
    if (!sources) return {};
    
    return sources.reduce((acc: any, source: RSSSource) => {
      const type = normalizeSourceType(source.source_type);
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(source);
      return acc;
    }, {});
  }, [sources]);

  // 源类型标签映射
  const sourceTypeLabels: Record<string, string> = {
    rss: 'RSS源',
    api: 'API源',
    web: 'Web源',
    social: '社交媒体源',
  };

  const timeRanges = ['今天', '最近3天', '最近7天', '最近30天', '全部'];

  const handleTimeRangeChange = (value: string) => {
    setFilter({ ...filter, time_range: value, page: 1 });
  };

  const handleSourceChange = (value: string[]) => {
    setFilter({ ...filter, sources: value.length > 0 ? value : undefined, page: 1 });
  };

  const handlePageChange = (page: number, pageSize: number) => {
    setFilter({ ...filter, page, page_size: pageSize });
  };

  return (
    <div>
      <Card
        title="📰 最新AI资讯"
        extra={
          <Space>
            <Select
              mode="multiple"
              placeholder="选择订阅来源"
              style={{ minWidth: 250 }}
              value={filter.sources}
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
              {Object.entries(groupedSources).map(([type, sourcesList]: [string, any]) => (
                <OptGroup 
                  key={type} 
                  label={`${sourceTypeLabels[type] || type} (${sourcesList.length})`}
                >
                  {sourcesList.map((source: RSSSource) => (
                    <Option key={source.id} value={source.name} label={source.name}>
                      {source.name}
                    </Option>
                  ))}
                </OptGroup>
              ))}
            </Select>
            <Radio.Group
              value={filter.time_range}
              onChange={(e) => handleTimeRangeChange(e.target.value)}
              options={timeRanges.map((range) => ({ label: range, value: range }))}
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
            <div style={{ marginBottom: 16 }}>
              <Space>
                <span>找到 {data.total} 篇文章</span>
              </Space>
            </div>
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


