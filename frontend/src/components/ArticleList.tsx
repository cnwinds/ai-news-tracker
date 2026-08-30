/**
 * 文章列表组件
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Pagination,
  Radio,
  Select,
  Space,
  Spin,
} from 'antd';
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useArticles } from '@/hooks/useArticles';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/contexts/ThemeContext';
import ArticleCard from './ArticleCard';
import { apiService } from '@/services/api';
import type { ArticleFilter } from '@/types';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import SourceFilterToggle from './SourceFilterToggle';
import { getThemeColor } from '@/utils/theme';

const { Option, OptGroup } = Select;

const TIME_RANGES = ['今天', '最近3天', '最近7天', '最近30天', '全部'] as const;

export default function ArticleList() {
  const { isMobile } = useBreakpoint();
  const { theme } = useTheme();
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<ArticleFilter>({
    time_range: '全部',
    page: 1,
    page_size: 20,
    source_filter_mode: 'include',
  });

  const { data, isLoading, error, refetch, isFetching } = useArticles(filter);

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  const groupedSources = useMemo(() => {
    if (!sources) return {};
    return groupSourcesByType(sources);
  }, [sources]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filter.time_range !== '全部') count += 1;
    if (filter.sources?.length || filter.exclude_sources?.length) count += 1;
    if (filter.source_filter_mode === 'exclude') count += 1;
    return count;
  }, [filter]);

  const handleTimeRangeChange = (value: string) => {
    setFilter((prev) => ({ ...prev, time_range: value, page: 1 }));
  };

  const handleSourceChange = (value: string[]) => {
    setFilter((prev) => {
      const isExcludeMode = prev.source_filter_mode === 'exclude';
      return {
        ...prev,
        [isExcludeMode ? 'exclude_sources' : 'sources']: value.length > 0 ? value : undefined,
        [isExcludeMode ? 'sources' : 'exclude_sources']: undefined,
        page: 1,
      };
    });
  };

  const handleFilterModeChange = (mode: 'include' | 'exclude') => {
    setFilter((prev) => {
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

  const sourceSelect = (
    <Space.Compact style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
      <SourceFilterToggle
        mode={filter.source_filter_mode || 'include'}
        onModeChange={handleFilterModeChange}
      />
      <Select
        mode="tags"
        placeholder={
          filter.source_filter_mode === 'exclude'
            ? '排除订阅源或关键词'
            : '选择订阅源或关键词'
        }
        style={{
          flex: 1,
          minWidth: isMobile ? undefined : 280,
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
        tokenSeparators={[',', ' ', '\n']}
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
  );

  const filterPanel = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <div
          className="mobile-filter-label"
          style={{ color: getThemeColor(theme, 'textSecondary') }}
        >
          时间范围
        </div>
        <Select
          value={filter.time_range}
          onChange={handleTimeRangeChange}
          style={{ width: '100%' }}
          options={TIME_RANGES.map((range) => ({ label: range, value: range }))}
        />
      </div>
      <div>
        <div
          className="mobile-filter-label"
          style={{ color: getThemeColor(theme, 'textSecondary') }}
        >
          订阅源
        </div>
        {sourceSelect}
      </div>
    </Space>
  );

  const listBody = isLoading ? (
    <div className="mobile-feed-loading">
      <Spin size="large" />
    </div>
  ) : error ? (
    <Alert message="加载失败" type="error" showIcon style={{ margin: isMobile ? 12 : 0 }} />
  ) : !data || data.items.length === 0 ? (
    <Empty description="暂无文章" style={{ padding: '40px 0' }} />
  ) : (
    <>
      <div className={isMobile ? 'mobile-list' : 'mobile-feed-list'}>
        {data.items.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
      <div
        className={isMobile ? 'mobile-feed-pagination' : undefined}
        style={isMobile ? undefined : { marginTop: 16, textAlign: 'right' }}
      >
        <Pagination
          current={data.page}
          total={data.total}
          pageSize={data.page_size}
          size={isMobile ? 'small' : 'default'}
          simple={isMobile}
          showSizeChanger={!isMobile}
          showTotal={isMobile ? undefined : (total) => `共 ${total} 条`}
          onChange={handlePageChange}
          onShowSizeChange={handlePageChange}
        />
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="mobile-feed-page">
        <div
          className="mobile-feed-toolbar"
          style={{
            background: getThemeColor(theme, 'bgElevated'),
          }}
        >
          <div className="mobile-feed-toolbar__meta">
            {data && !isLoading ? (
              <>
                <span
                  className="mobile-feed-toolbar__count"
                  style={{ color: getThemeColor(theme, 'textSecondary') }}
                >
                  {data.total} 篇
                </span>
                <span
                  className="mobile-feed-toolbar__range"
                  style={{ color: getThemeColor(theme, 'textSecondary') }}
                >
                  {filter.time_range}
                </span>
              </>
            ) : (
              <span style={{ color: getThemeColor(theme, 'textSecondary') }}>加载中...</span>
            )}
          </div>
          <div className="mobile-feed-toolbar__actions">
            <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
              <Button
                type="text"
                icon={<FilterOutlined />}
                onClick={() => setFilterDrawerOpen(true)}
                className="mobile-feed-toolbar__btn"
              />
            </Badge>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isFetching}
              className="mobile-feed-toolbar__btn"
            />
          </div>
        </div>

        {listBody}

        <Drawer
          title="筛选条件"
          placement="bottom"
          height="auto"
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          className="mobile-filter-drawer"
          extra={
            <Button type="link" onClick={() => setFilterDrawerOpen(false)}>
              完成
            </Button>
          }
        >
          {filterPanel}
        </Drawer>
      </div>
    );
  }

  const timeRangeFilter = (
    <Radio.Group
      value={filter.time_range}
      onChange={(e) => handleTimeRangeChange(e.target.value)}
      options={TIME_RANGES.map((range) => ({ label: range, value: range }))}
      optionType="button"
      buttonStyle="solid"
    />
  );

  return (
    <Card
      title={
        <Space wrap>
          <span>最新 AI 资讯</span>
          {data && !isLoading && (
            <>
              <span style={{ color: '#8c8c8c', fontSize: 14, fontWeight: 'normal' }}>
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
        <Space wrap>
          {sourceSelect}
          {timeRangeFilter}
        </Space>
      }
    >
      {listBody}
    </Card>
  );
}
