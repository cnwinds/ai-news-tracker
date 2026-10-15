/**
 * 资讯列表：PC 为「列表 + 阅读器」分栏，手机为列表 + 全屏阅读页
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Drawer, Empty, Pagination, Popover, Segmented, Select, Skeleton, Tooltip } from 'antd';
import { FilterOutlined, ReadOutlined, ReloadOutlined, StarFilled } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useArticles } from '@/hooks/useArticles';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useReadArticles } from '@/hooks/useReadArticles';
import { apiService } from '@/services/api';
import type { Article, ArticleFilter, SourceFilterMode } from '@/types';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import ArticleReader from '@/components/article/ArticleReader';

const TIME_RANGES = [
  { value: '今天', label: '今天' },
  { value: '最近3天', label: '3 天' },
  { value: '最近7天', label: '7 天' },
  { value: '最近30天', label: '30 天' },
  { value: '全部', label: '全部' },
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayLabel(date: string | undefined): string {
  if (!date) return '未知日期';
  const d = dayjs(date);
  const today = dayjs().startOf('day');
  const diff = today.diff(d.startOf('day'), 'day');
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.format('MM-DD')} ${WEEKDAYS[d.day()]}`;
}

function groupByDay(items: Article[]): { key: string; label: string; items: Article[] }[] {
  const groups: { key: string; label: string; items: Article[] }[] = [];
  items.forEach((item) => {
    const key = item.published_at ? dayjs(item.published_at).format('YYYY-MM-DD') : 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: dayLabel(item.published_at), items: [item] });
    }
  });
  return groups;
}

interface FeedRowProps {
  article: Article;
  active: boolean;
  read: boolean;
  onSelect: (article: Article) => void;
}

function FeedRow({ article, active, read, onSelect }: FeedRowProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      className={`feed-row${active ? ' feed-row--active' : ''}${read && !active ? ' feed-row--read' : ''}`}
      onClick={() => onSelect(article)}
      aria-current={active ? 'true' : undefined}
    >
      <span className="feed-row__marker">
        <span className={`dot dot--${article.importance || 'low'}`} title={article.importance ? `重要度：${article.importance}` : undefined} />
      </span>
      <span className="feed-row__body">
        <span className="feed-row__title">{article.title_zh || article.title}</span>
        <span className="feed-row__meta">
          <span className="feed-row__source">{article.source}</span>
          {article.published_at && (
            <>
              <span aria-hidden>·</span>
              <span className="feed-row__time">{dayjs(article.published_at).format('HH:mm')}</span>
            </>
          )}
        </span>
      </span>
      <span className="feed-row__trail">{article.is_favorited && <StarFilled />}</span>
    </button>
  );
}

export default function ArticleList() {
  const { isMobile } = useBreakpoint();
  const { readIds, markRead } = useReadArticles();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<ArticleFilter>({
    time_range: '全部',
    page: 1,
    page_size: 30,
    source_filter_mode: 'include',
  });
  const [selected, setSelected] = useState<{ id: number; byUser: boolean } | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error, refetch, isFetching } = useArticles(filter);
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  const groupedSources = useMemo(() => (sources ? groupSourcesByType(sources) : {}), [sources]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const groups = useMemo(() => groupByDay(items), [items]);

  const isExclude = filter.source_filter_mode === 'exclude';
  const activeSources = (isExclude ? filter.exclude_sources : filter.sources) ?? [];
  const sourceFilterCount = activeSources.length > 0 ? 1 : 0;

  // PC：数据刷新后保持选中项，否则自动选中第一篇
  useEffect(() => {
    if (isMobile || items.length === 0) return;
    if (!selected || !items.some((a) => a.id === selected.id)) {
      setSelected({ id: items[0].id, byUser: false });
    }
  }, [items, isMobile, selected]);

  const selectArticle = (article: Article) => {
    setSelected({ id: article.id, byUser: true });
    markRead(article.id);
    if (isMobile) {
      setReaderOpen(true);
    }
  };

  // PC 键盘导航：J/K 或 ↓/↑
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"], .ant-select, .ant-modal, .ant-drawer')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!['j', 'k', 'arrowdown', 'arrowup'].includes(key) || items.length === 0) return;
      e.preventDefault();
      const index = items.findIndex((a) => a.id === selected?.id);
      const delta = key === 'j' || key === 'arrowdown' ? 1 : -1;
      const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
      if (next) selectArticle(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selected, isMobile]);

  const updateFilter = (patch: Partial<ArticleFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
    listRef.current?.scrollTo({ top: 0 });
  };

  const handleSourceChange = (value: string[]) => {
    const next = value.length > 0 ? value : undefined;
    updateFilter(isExclude ? { exclude_sources: next, sources: undefined } : { sources: next, exclude_sources: undefined });
  };

  const handleModeChange = (mode: SourceFilterMode) => {
    const current = mode === 'exclude' ? filter.sources : filter.exclude_sources;
    updateFilter({
      source_filter_mode: mode,
      sources: mode === 'include' ? current : undefined,
      exclude_sources: mode === 'exclude' ? current : undefined,
    });
  };

  const sourcePanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: isMobile ? '100%' : 340 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="eyebrow">订阅源</span>
        <Segmented
          size="small"
          value={filter.source_filter_mode || 'include'}
          onChange={(v) => handleModeChange(v as SourceFilterMode)}
          options={[
            { label: '仅包含', value: 'include' },
            { label: '排除', value: 'exclude' },
          ]}
        />
      </div>
      <Select
        mode="tags"
        placeholder={isExclude ? '排除的订阅源或关键词' : '筛选订阅源或关键词'}
        style={{ width: '100%' }}
        value={activeSources}
        onChange={handleSourceChange}
        allowClear
        maxTagCount="responsive"
        showSearch
        filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        tokenSeparators={[',', ' ', '\n']}
        options={Object.entries(groupedSources).map(([type, list]) => ({
          label: `${SOURCE_TYPE_LABELS[type] || type} (${list.length})`,
          options: list.map((s) => ({ label: s.name, value: s.name })),
        }))}
      />
    </div>
  );

  const timeSegmented = (
    <Segmented
      size={isMobile ? 'middle' : 'small'}
      block
      value={filter.time_range}
      onChange={(v) => updateFilter({ time_range: String(v) })}
      options={TIME_RANGES}
    />
  );

  const listBody = isLoading ? (
    <div style={{ padding: '12px 14px' }}>
      <Skeleton active title={false} paragraph={{ rows: 10 }} />
    </div>
  ) : error ? (
    <Empty description="加载失败，请稍后重试" style={{ padding: '48px 0' }} />
  ) : items.length === 0 ? (
    <Empty description="没有符合条件的文章" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '48px 0' }} />
  ) : (
    groups.map((group) => (
      <div key={group.key}>
        <div className="feed-day eyebrow">
          {group.label}
          <span style={{ letterSpacing: 0 }}>{group.items.length}</span>
        </div>
        {group.items.map((article) => (
          <FeedRow
            key={article.id}
            article={article}
            active={!isMobile && selected?.id === article.id}
            read={readIds.has(article.id)}
            onSelect={selectArticle}
          />
        ))}
      </div>
    ))
  );

  const pagination = data && data.total > data.page_size && (
    <Pagination
      simple
      size="small"
      current={data.page}
      total={data.total}
      pageSize={data.page_size}
      showSizeChanger={false}
      onChange={(page) => updateFilter({ page })}
    />
  );

  const countLabel = data ? (
    <span className="feed-toolbar__count">
      <strong>{data.total.toLocaleString()}</strong> 篇
      {filter.time_range !== '全部' ? ` · ${filter.time_range}` : ''}
    </span>
  ) : (
    <span className="feed-toolbar__count">加载中…</span>
  );

  const selectedPreview = items.find((a) => a.id === selected?.id);

  if (isMobile) {
    return (
      <div className="m-feed">
        <div className="m-feed__toolbar">
          {timeSegmented}
          <div className="feed-toolbar__row">
            {countLabel}
            <div style={{ display: 'flex', gap: 2 }}>
              <Badge dot={sourceFilterCount > 0} offset={[-6, 6]}>
                <button type="button" className="icon-btn" onClick={() => setFilterOpen(true)} aria-label="筛选">
                  <FilterOutlined />
                </button>
              </Badge>
              <button type="button" className="icon-btn" onClick={() => refetch()} aria-label="刷新">
                <ReloadOutlined spin={isFetching} />
              </button>
            </div>
          </div>
        </div>

        <div className="m-feed__list" ref={listRef}>
          {listBody}
        </div>
        {pagination && <div className="feed-list__footer">{pagination}</div>}

        <Drawer
          title="筛选"
          placement="bottom"
          height="auto"
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          className="m-sheet"
          extra={
            <Button type="link" onClick={() => setFilterOpen(false)}>
              完成
            </Button>
          }
        >
          {sourcePanel}
        </Drawer>

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
          {selected && (
            <ArticleReader
              articleId={selected.id}
              preview={selectedPreview}
              dismiss="back"
              onDismiss={() => setReaderOpen(false)}
              onDeleted={() => setReaderOpen(false)}
            />
          )}
        </Drawer>
      </div>
    );
  }

  return (
    <div className="feed-split">
      <section className="feed-split__list" aria-label="文章列表">
        <div className="feed-toolbar">
          <div className="feed-toolbar__row">
            {countLabel}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Popover content={sourcePanel} trigger="click" placement="bottomLeft" arrow={false}>
                <Tooltip title="筛选订阅源">
                  <Badge dot={sourceFilterCount > 0} offset={[-6, 6]}>
                    <button
                      type="button"
                      className={`icon-btn${sourceFilterCount ? ' icon-btn--active' : ''}`}
                      aria-label="筛选订阅源"
                    >
                      <FilterOutlined />
                    </button>
                  </Badge>
                </Tooltip>
              </Popover>
              <Tooltip title="刷新">
                <button type="button" className="icon-btn" onClick={() => refetch()} aria-label="刷新">
                  <ReloadOutlined spin={isFetching} />
                </button>
              </Tooltip>
            </div>
          </div>
          {timeSegmented}
        </div>
        <div className="feed-list" ref={listRef}>
          {listBody}
        </div>
        {pagination && <div className="feed-list__footer">{pagination}</div>}
      </section>

      <section className="feed-split__reader" aria-label="阅读面板">
        {selected ? (
          <ArticleReader
            key={selected.id}
            articleId={selected.id}
            preview={selectedPreview}
            trackView={selected.byUser}
            onDeleted={() => setSelected(null)}
          />
        ) : (
          <div className="reader__empty">
            <span className="reader__empty-mark">
              <ReadOutlined />
            </span>
            <div>选择一篇文章开始阅读</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <span className="kbd">J</span>
              <span className="kbd">K</span> 上下切换
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
