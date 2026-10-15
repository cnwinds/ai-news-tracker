/**
 * RAG语义搜索组件
 */
import { useState, useMemo } from 'react';
import { Input, Select, Alert, Button, DatePicker, Tooltip } from 'antd';
import { SearchOutlined, ExportOutlined, StarFilled, LoadingOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { RAGSearchRequest, ArticleSearchResult, ImportanceLevel } from '@/types';
import dayjs from 'dayjs';
import { Markdown } from '@/utils/markdown';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import { getImportanceLabel } from '@/utils/article';
import '@/styles/pages/assistant.css';

const { RangePicker } = DatePicker;
const { Option, OptGroup } = Select;

export default function RAGSearch() {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [importance, setImportance] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [topK, setTopK] = useState(10);

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
      request.importance = importance as ImportanceLevel[];
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
    <div className="rag-search panel">
      <div className="panel__head">
        <div className="rag-search__heading">
          <span className="eyebrow">语义搜索</span>
          <span className="panel__title">按语义检索已索引的资讯</span>
        </div>
        <span className="rag-search__topk">
          <span>返回数量</span>
          <Select
            size="small"
            value={topK}
            onChange={setTopK}
            style={{ width: 72 }}
            options={[
              { label: '5', value: 5 },
              { label: '10', value: 10 },
              { label: '20', value: 20 },
              { label: '50', value: 50 },
            ]}
          />
        </span>
      </div>

      <div className="panel__body rag-search__body">
        {/* 搜索框 */}
        <Input.Search
          className="rag-search__input"
          placeholder="输入搜索关键词，支持自然语言查询..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={handleSearch}
          enterButton={<SearchOutlined />}
          size="large"
          loading={searchMutation.isPending}
        />

        {/* 筛选器 */}
        <div className="rag-search__filters">
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
        </div>

        {/* 搜索结果 */}
        {searchMutation.isPending ? (
          <div className="rag-search__state">
            <LoadingOutlined className="rag-search__spin" />
            正在检索…
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
            <div className="rag-search__summary">
              <span className="eyebrow">结果</span>
              <span>
                找到 <span className="mono u-tnum u-accent">{searchMutation.data.total}</span> 条相关结果
                {searchMutation.data.query && `（查询："${searchMutation.data.query}"）`}
              </span>
            </div>

            {searchMutation.data.results.length === 0 ? (
              <div className="rag-search__state">未找到相关文章</div>
            ) : (
              <div className="rag-results">
                {searchMutation.data.results.map((item: ArticleSearchResult) => (
                  <article key={item.id} className="rag-result">
                    <div className="rag-result__meta">
                      {item.importance && (
                        <span className="rag-result__importance">
                          <span className={`dot dot--${item.importance}`} />
                          {getImportanceLabel(item.importance)}
                        </span>
                      )}
                      <span className="chip">{item.source}</span>
                      {item.is_favorited && (
                        <Tooltip title="已收藏">
                          <StarFilled className="rag-result__fav" />
                        </Tooltip>
                      )}
                      <span className="chip chip--accent mono u-tnum rag-result__score" title="相似度">
                        {formatSimilarity(item.similarity)}
                      </span>
                    </div>

                    {item.title_zh ? (
                      <Tooltip title={item.title} placement="top">
                        <h3 className="rag-result__title rag-result__title--hint">{item.title_zh}</h3>
                      </Tooltip>
                    ) : (
                      <h3 className="rag-result__title">{item.title}</h3>
                    )}

                    {item.summary && (
                      <div className="rag-result__summary">
                        <Markdown compact>{item.summary}</Markdown>
                      </div>
                    )}

                    <div className="rag-result__foot">
                      <span className="mono u-tnum">
                        {item.published_at ? dayjs(item.published_at).format('YYYY-MM-DD HH:mm') : ''}
                      </span>
                      <a
                        className="rag-result__link"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看原文 <ExportOutlined />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="rag-search__state rag-search__state--idle">
            <SearchOutlined className="rag-search__idle-icon" />
            输入关键词开始搜索
          </div>
        )}
      </div>
    </div>
  );
}
