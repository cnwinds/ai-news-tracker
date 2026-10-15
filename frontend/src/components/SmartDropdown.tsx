/**
 * 智能下拉面板组件（命令面板风格）
 * 支持零态（历史记录）和输入态（意图分流）
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  MessageOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  LinkOutlined,
  LoadingOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { ArticleSearchResult, SmartDropdownItemData } from '@/types';
import dayjs from 'dayjs';
import '@/styles/pages/assistant.css';

interface SmartDropdownProps {
  query: string;
  onSelectArticle: (article: ArticleSearchResult) => void;
  onSelectHistory: (chatId: string) => void;
  onSelectAIQuery: (query: string) => void;
  onSelectSearchHistory?: (searchQuery: string) => void;
  onSearchExecuted?: (searchQuery: string) => void;
  onCollectUrl?: (url: string) => Promise<void>;
  onKeepDropdownOpen?: () => void; // 保持下拉窗口打开的回调
}

const SEARCH_HISTORY_KEY = 'ai_news_search_history';
const MAX_SEARCH_HISTORY = 10;

// 获取搜索历史
const getSearchHistory = (): string[] => {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('读取搜索历史失败:', e);
  }
  return [];
};

// 保存搜索历史
const saveSearchHistory = (searchQuery: string) => {
  if (!searchQuery.trim()) return;

  try {
    let history = getSearchHistory();
    // 移除重复项
    history = history.filter((item) => item !== searchQuery);
    // 添加到开头
    history.unshift(searchQuery);
    // 限制数量
    history = history.slice(0, MAX_SEARCH_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('保存搜索历史失败:', e);
  }
};

function FooterHints({ zeroState }: { zeroState?: boolean }) {
  return (
    <div className="cmd-footer">
      {zeroState ? (
        <>
          <span className="cmd-footer__hint">输入关键词搜索，或粘贴链接采集</span>
          <span className="cmd-footer__spacer" />
          <span className="cmd-footer__hint"><span className="kbd">Esc</span> 关闭</span>
        </>
      ) : (
        <>
          <span className="cmd-footer__hint"><span className="kbd">↑</span><span className="kbd">↓</span> 选择</span>
          <span className="cmd-footer__hint"><span className="kbd">Enter</span> 打开</span>
          <span className="cmd-footer__spacer" />
          <span className="cmd-footer__hint"><span className="kbd">Esc</span> 关闭</span>
        </>
      )}
    </div>
  );
}

export default function SmartDropdown({
  query,
  onSelectArticle,
  onSelectHistory,
  onSelectAIQuery,
  onSelectSearchHistory,
  onSearchExecuted,
  onCollectUrl,
  onKeepDropdownOpen,
}: SmartDropdownProps) {
  const { chatHistories } = useAIConversation();
  const queryClient = useQueryClient();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 获取索引统计信息
  const { data: indexStats, refetch: refetchStats } = useQuery({
    queryKey: ['rag-stats'],
    queryFn: () => apiService.getRAGStats(),
    staleTime: 30000, // 30秒内不重新获取
  });

  // 创建索引的 mutation
  const indexMutation = useMutation({
    mutationFn: () => apiService.indexAllUnindexedArticles(10),
    onSuccess: async (data) => {
      showSuccess(`索引创建成功：${data.success} 篇文章已索引`);
      setIsIndexing(false);
      // 立即刷新索引统计（使用 refetch 确保立即更新）
      await refetchStats();
      // 同时使用 invalidateQueries 确保其他组件也能获取最新数据
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
      // 重置高亮索引
      setHighlightedIndex(0);
      // 确保下拉窗口保持打开
      if (onKeepDropdownOpen) {
        onKeepDropdownOpen();
      }
    },
    onError: (error: unknown) => {
      createErrorHandler({
        operationName: '创建索引',
        customMessages: {
          auth: '需要登录才能创建索引',
        },
      })(error);
      setIsIndexing(false);
      // 即使失败也刷新一次统计（可能部分索引成功）
      refetchStats();
      // 即使失败也保持下拉窗口打开
      if (onKeepDropdownOpen) {
        onKeepDropdownOpen();
      }
    },
  });

  // 检测输入是否为URL（仅 http(s) 开头或形如域名的 ASCII 字符串，避免将「千问3.5 门控技术」等误判为 URL）
  const isUrl = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    try {
      const url = new URL(trimmed);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      // 仅当输入形如域名（无空格、仅含 ASCII 字母数字与 .-）且可解析为 URL 时，才视为 URL
      if (/\s/.test(trimmed) || !/^[a-zA-Z0-9.-]+$/.test(trimmed)) return false;
      try {
        const url = new URL(`https://${trimmed}`);
        return url.hostname.includes('.');
      } catch {
        return false;
      }
    }
  };

  const isUrlInput = isUrl(query);

  // 搜索文章（仅在输入时且不是URL）
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['article-search', query],
    queryFn: () => apiService.searchArticles({ query, top_k: 5 }),
    enabled: query.trim().length > 0 && !isUrlInput,
    staleTime: 30000,
  });

  // 加载搜索历史
  useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);

  const isZeroState = !query.trim();

  // 处理URL采集
  const handleCollectUrl = useCallback(async () => {
    if (!onCollectUrl || !query.trim()) return;

    let url = query.trim();
    // 如果URL没有协议，添加 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    setIsCollecting(true);
    try {
      await onCollectUrl(url);
    } finally {
      setIsCollecting(false);
    }
  }, [onCollectUrl, query]);

  // 处理创建索引
  const handleCreateIndex = useCallback(async () => {
    if (isIndexing) return;
    setIsIndexing(true);
    // 通知父组件保持下拉窗口打开
    if (onKeepDropdownOpen) {
      onKeepDropdownOpen();
    }
    indexMutation.mutate();
  }, [isIndexing, indexMutation, onKeepDropdownOpen]);

  // 计算选项列表
  const options = useMemo(() => {
    if (isZeroState) {
      // 零态：只显示历史记录
      return [];
    } else if (isUrlInput) {
      // URL输入态：只显示采集选项
      return [{
        type: 'collect' as const,
        data: { url: query },
        index: 0,
      }];
    } else {
      // 输入态：AI 问答选项 + 相关文章 + 索引提示（如果有未索引文章）
      const items: Array<{
        type: 'ai' | 'article' | 'index';
        data: SmartDropdownItemData;
        index: number;
      }> = [];

      // AI 智能问答选项（第一个）
      items.push({
        type: 'ai',
        data: { query },
        index: 0,
      });

      // 相关文章
      if (searchResults?.results) {
        searchResults.results.forEach((article, idx) => {
          items.push({
            type: 'article',
            data: article,
            index: idx + 1,
          });
        });
      }

      // 如果有未索引的文章，添加索引提示选项
      if (indexStats && indexStats.unindexed_articles > 0) {
        items.push({
          type: 'index',
          data: { unindexed_count: indexStats.unindexed_articles },
          index: items.length,
        });
      }

      return items;
    }
  }, [isZeroState, query, searchResults, isUrlInput, indexStats]);

  // 键盘导航
  useEffect(() => {
    if (!isZeroState && options.length > 0) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % options.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev - 1 + options.length) % options.length);
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
          e.preventDefault();
          e.stopPropagation();
          const option = options[highlightedIndex];
          if (option) {
            if (option.type === 'collect') {
              handleCollectUrl();
            } else if (option.type === 'ai') {
              onSelectAIQuery(query);
            } else if (option.type === 'index') {
              handleCreateIndex();
            } else if (option.type === 'article') {
              // 保存搜索历史（用户用键盘选择了文章）
              if (query.trim().length >= 2) {
                saveSearchHistory(query.trim());
                setSearchHistory(getSearchHistory());
              }
              // 类型守卫：确保 data 是 ArticleSearchResult
              if ('id' in option.data && 'title' in option.data && 'url' in option.data) {
                onSelectArticle(option.data as ArticleSearchResult);
              }
            }
          }
        } else if (e.key === 'Enter' && isUrlInput && !isCollecting) {
          // URL输入时，直接回车采集
          e.preventDefault();
          e.stopPropagation();
          handleCollectUrl();
        }
      };

      // 使用捕获阶段确保我们的处理器优先执行
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [isZeroState, options.length, highlightedIndex, query, isUrlInput, isCollecting, handleCollectUrl, handleCreateIndex, onSelectAIQuery, onSelectArticle]);

  // 键盘高亮项滚动到可见区域
  useEffect(() => {
    rootRef.current
      ?.querySelector('.cmd-item--active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const itemClass = (index: number, extra?: string) =>
    ['cmd-item', highlightedIndex === index ? 'cmd-item--active' : '', extra || '']
      .filter(Boolean)
      .join(' ');

  if (isZeroState) {
    // 零态：显示搜索历史和对话历史
    return (
      <div ref={rootRef} className="cmd-dropdown" onMouseDown={(e) => e.preventDefault()}>
        <div className="cmd-dropdown__section">
          <div className="cmd-dropdown__label">
            <span className="eyebrow">最近搜索</span>
          </div>
          {searchHistory.length === 0 ? (
            <div className="cmd-empty">暂无搜索历史</div>
          ) : (
            searchHistory.slice(0, 5).map((searchQuery) => (
              <button
                key={searchQuery}
                type="button"
                className="cmd-item cmd-item--compact"
                onClick={() => {
                  if (onSelectSearchHistory) {
                    onSelectSearchHistory(searchQuery);
                  } else {
                    onSelectAIQuery(searchQuery);
                  }
                }}
              >
                <span className="cmd-item__icon"><HistoryOutlined /></span>
                <span className="cmd-item__body">
                  <span className="cmd-item__title">{searchQuery}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="cmd-dropdown__section">
          <div className="cmd-dropdown__label">
            <span className="eyebrow">最近对话</span>
          </div>
          {chatHistories.length === 0 ? (
            <div className="cmd-empty">暂无对话历史</div>
          ) : (
            chatHistories.slice(0, 5).map((history) => (
              <button
                key={history.id}
                type="button"
                className="cmd-item"
                onClick={() => onSelectHistory(history.id)}
              >
                <span className="cmd-item__icon"><MessageOutlined /></span>
                <span className="cmd-item__body">
                  <span className="cmd-item__title">{history.title}</span>
                  <span className="cmd-item__meta">
                    <span className="mono u-tnum">{dayjs(history.updatedAt).fromNow()}</span>
                    <span className="cmd-sep">·</span>
                    <span className="mono u-tnum">{history.messages.length} 条消息</span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <FooterHints zeroState />
      </div>
    );
  }

  if (isUrlInput) {
    // URL输入态：显示采集提示
    return (
      <div ref={rootRef} className="cmd-dropdown" onMouseDown={(e) => e.preventDefault()}>
        <div className="cmd-dropdown__section">
          <div className="cmd-dropdown__label">
            <span className="eyebrow">采集链接</span>
          </div>
          <button
            type="button"
            className={itemClass(0, isCollecting ? 'cmd-item--busy' : '')}
            disabled={isCollecting}
            onMouseEnter={() => setHighlightedIndex(0)}
            onClick={handleCollectUrl}
          >
            <span className="cmd-item__icon cmd-item__icon--accent">
              {isCollecting ? <LoadingOutlined /> : <LinkOutlined />}
            </span>
            <span className="cmd-item__body">
              <span className="cmd-item__title">
                {isCollecting ? '正在采集文章…' : '采集这篇文章'}
              </span>
              <span className="cmd-item__meta">
                <span className="cmd-url mono">{query.trim()}</span>
              </span>
            </span>
            <span className="cmd-item__trail">
              {isCollecting ? (
                <span className="chip chip--accent">采集中</span>
              ) : (
                <span className="chip chip--outline">网页采集</span>
              )}
            </span>
          </button>
        </div>
        <FooterHints />
      </div>
    );
  }

  const indexOptionIndex = options.length - 1;
  const showIndexHint = !!indexStats && indexStats.unindexed_articles > 0;

  // 输入态：显示 AI 问答选项和相关文章
  return (
    <div ref={rootRef} className="cmd-dropdown" onMouseDown={(e) => e.preventDefault()}>
      <div className="cmd-dropdown__section">
        <div className="cmd-dropdown__label">
          <span className="eyebrow">向 AI 提问</span>
        </div>
        <button
          type="button"
          className={itemClass(0)}
          onMouseEnter={() => setHighlightedIndex(0)}
          onClick={() => {
            onSelectAIQuery(query);
            if (onSearchExecuted) {
              onSearchExecuted(query);
            }
          }}
        >
          <span className="cmd-item__icon cmd-item__icon--accent"><ThunderboltOutlined /></span>
          <span className="cmd-item__body">
            <span className="cmd-item__title">
              <span className="cmd-query">{query}</span>
            </span>
            <span className="cmd-item__meta">基于已索引资讯生成回答</span>
          </span>
          {highlightedIndex === 0 && (
            <span className="cmd-item__trail"><span className="kbd">Enter</span></span>
          )}
        </button>
      </div>

      <div className="cmd-dropdown__section">
        <div className="cmd-dropdown__label">
          <span className="eyebrow">相关文章</span>
          {searchResults && searchResults.results.length > 0 && (
            <span className="cmd-count mono u-tnum">{searchResults.results.length}</span>
          )}
        </div>
        {isSearching ? (
          <div className="cmd-empty">
            <LoadingOutlined className="cmd-empty__spin" />
            正在检索文章…
          </div>
        ) : searchResults && searchResults.results.length > 0 ? (
          searchResults.results.map((article, idx) => {
            const index = idx + 1;
            return (
              <button
                key={article.id}
                type="button"
                className={itemClass(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  // 保存搜索历史（用户查看了搜索到的文章）
                  if (query.trim().length >= 2) {
                    saveSearchHistory(query.trim());
                    setSearchHistory(getSearchHistory());
                  }
                  onSelectArticle(article);
                }}
              >
                <span className="cmd-item__icon"><FileTextOutlined /></span>
                <span className="cmd-item__body">
                  <span className="cmd-item__title">{article.title_zh || article.title}</span>
                  <span className="cmd-item__meta">
                    <span className="cmd-meta__source">{article.source}</span>
                    {article.published_at && (
                      <>
                        <span className="cmd-sep">·</span>
                        <span className="mono u-tnum">
                          {dayjs(article.published_at).format('YYYY-MM-DD')}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                {article.similarity !== undefined && (
                  <span className="cmd-item__trail">
                    <span className="chip chip--accent mono u-tnum" title="匹配度">
                      {Math.round(article.similarity * 100)}%
                    </span>
                  </span>
                )}
              </button>
            );
          })
        ) : searchResults && searchResults.results.length === 0 ? (
          <div className="cmd-empty">未找到相关文章</div>
        ) : null}
      </div>

      {showIndexHint && (
        <div className="cmd-dropdown__section">
          <div className="cmd-dropdown__label">
            <span className="eyebrow">索引提示</span>
          </div>
          <button
            type="button"
            className={itemClass(indexOptionIndex)}
            onMouseEnter={() => setHighlightedIndex(indexOptionIndex)}
            onClick={handleCreateIndex}
          >
            <span className={`cmd-item__icon ${isIndexing ? 'cmd-item__icon--accent' : 'cmd-item__icon--warning'}`}>
              {isIndexing ? <LoadingOutlined /> : <DatabaseOutlined />}
            </span>
            <span className="cmd-item__body">
              <span className="cmd-item__title">
                {isIndexing ? '正在创建索引…' : `还有 ${indexStats.unindexed_articles} 篇文章未建索引`}
              </span>
              <span className="cmd-item__meta">
                <span>索引覆盖率</span>
                <span className="mono u-tnum">
                  {Math.round(indexStats.index_coverage * 100)}% · {indexStats.indexed_articles}/{indexStats.total_articles}
                </span>
              </span>
            </span>
            <span className="cmd-item__trail">
              {isIndexing ? (
                <span className="chip chip--accent">索引中</span>
              ) : (
                <span className="chip chip--warning">立即创建</span>
              )}
            </span>
          </button>
        </div>
      )}

      <FooterHints />
    </div>
  );
}
