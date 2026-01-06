/**
 * 智能下拉面板组件
 * 支持零态（历史记录）和输入态（意图分流）
 */
import { useState, useEffect, useMemo } from 'react';
import { List, Typography, Empty, Spin, Divider, Tag } from 'antd';
import { 
  MessageOutlined, 
  FileTextOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { ArticleSearchResult } from '@/types';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

interface SmartDropdownProps {
  query: string;
  onSelectArticle: (article: ArticleSearchResult) => void;
  onSelectHistory: (chatId: string) => void;
  onSelectAIQuery: (query: string) => void;
  onSelectSearchHistory?: (searchQuery: string) => void;
  onSearchExecuted?: (searchQuery: string) => void;
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

export default function SmartDropdown({
  query,
  onSelectArticle,
  onSelectHistory,
  onSelectAIQuery,
  onSelectSearchHistory,
  onSearchExecuted,
}: SmartDropdownProps) {
  const { theme } = useTheme();
  const { chatHistories } = useAIConversation();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // 搜索文章（仅在输入时）
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['article-search', query],
    queryFn: () => apiService.searchArticles({ query, top_k: 5 }),
    enabled: query.trim().length > 0,
    staleTime: 30000,
  });

  // 加载搜索历史
  useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);

  const isZeroState = !query.trim();

  // 计算选项列表
  const options = useMemo(() => {
    if (isZeroState) {
      // 零态：只显示历史记录
      return [];
    } else {
      // 输入态：AI 问答选项 + 相关文章
      const items: Array<{
        type: 'ai' | 'article';
        data: any;
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

      return items;
    }
  }, [isZeroState, query, searchResults]);

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
            if (option.type === 'ai') {
              onSelectAIQuery(query);
            } else {
              // 保存搜索历史（用户用键盘选择了文章）
              if (query.trim().length >= 2) {
                saveSearchHistory(query.trim());
                setSearchHistory(getSearchHistory());
              }
              onSelectArticle(option.data);
            }
          }
        }
      };

      // 使用捕获阶段确保我们的处理器优先执行
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZeroState, options.length, highlightedIndex, query]);

  // 响应式：检测移动端
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: isMobile ? '0' : '50%',
    transform: isMobile ? 'none' : 'translateX(-50%)',
    width: '100%',
    maxWidth: isMobile ? '100%' : '800px',
    marginTop: '8px',
    backgroundColor: getThemeColor(theme, 'bgElevated'),
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    borderRadius: '8px',
    boxShadow: theme === 'dark' 
      ? '0 4px 12px rgba(0, 0, 0, 0.5)' 
      : '0 4px 12px rgba(0, 0, 0, 0.15)',
    maxHeight: isMobile ? '70vh' : '500px',
    overflowY: 'auto',
    zIndex: 1001,
  };

  const itemStyle = (index: number): React.CSSProperties => ({
    padding: index === 0 ? '8px 12px' : '10px 12px', // AI选项更紧凑
    cursor: 'pointer',
    backgroundColor: highlightedIndex === index 
      ? getThemeColor(theme, 'selectedBg')
      : 'transparent',
    borderLeft: highlightedIndex === index 
      ? `3px solid ${getThemeColor(theme, 'primary')}`
      : '3px solid transparent',
    transition: 'all 0.2s',
    lineHeight: '1.3', // 紧凑行高
  });

  if (isZeroState) {
    // 零态：显示历史记录和今日热搜
    return (
      <div style={dropdownStyle}>
        <div style={{ padding: '16px' }}>
          {/* 最近搜索历史 */}
          <div style={{ marginBottom: '16px' }}>
            <Title level={5} style={{ 
              marginBottom: '12px',
              color: getThemeColor(theme, 'text'),
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <SearchOutlined />
              最近搜索
            </Title>
            {searchHistory.length === 0 ? (
              <Empty
                description="暂无搜索历史"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ margin: '16px 0' }}
              />
            ) : (
              <List
                dataSource={searchHistory.slice(0, 5)}
                renderItem={(searchQuery) => (
                  <List.Item
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = getThemeColor(theme, 'selectedBg');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    onClick={() => {
                      if (onSelectSearchHistory) {
                        onSelectSearchHistory(searchQuery);
                      } else {
                        onSelectAIQuery(searchQuery);
                      }
                    }}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <SearchOutlined style={{ color: getThemeColor(theme, 'primary') }} />
                        <Text 
                          ellipsis 
                          style={{ 
                            flex: 1,
                            color: getThemeColor(theme, 'text')
                          }}
                        >
                          {searchQuery}
                        </Text>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {/* 最近对话历史 */}
          <div>
            <Title level={5} style={{ 
              marginBottom: '12px',
              color: getThemeColor(theme, 'text'),
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <HistoryOutlined />
              最近对话历史
            </Title>
            {chatHistories.length === 0 ? (
              <Empty
                description="暂无对话历史"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ margin: '16px 0' }}
              />
            ) : (
              <List
                dataSource={chatHistories.slice(0, 5)}
                renderItem={(history) => (
                  <List.Item
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = getThemeColor(theme, 'selectedBg');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    onClick={() => onSelectHistory(history.id)}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MessageOutlined style={{ color: getThemeColor(theme, 'primary') }} />
                        <Text 
                          ellipsis 
                          style={{ 
                            flex: 1,
                            color: getThemeColor(theme, 'text')
                          }}
                        >
                          {history.title}
                        </Text>
                      </div>
                      <Text 
                        type="secondary" 
                        style={{ 
                          fontSize: '12px',
                          marginTop: '4px',
                          display: 'block'
                        }}
                      >
                        {dayjs(history.updatedAt).fromNow()}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>

        </div>
      </div>
    );
  }

  // 输入态：显示 AI 问答选项和相关文章
  return (
    <div style={dropdownStyle}>
      <div style={{ padding: '8px' }}>
        {/* AI 智能问答选项 */}
        <div
          style={itemStyle(0)}
          onMouseEnter={() => setHighlightedIndex(0)}
          onClick={() => {
            onSelectAIQuery(query);
            if (onSearchExecuted) {
              onSearchExecuted(query);
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: '1.3' }}>
            <ThunderboltOutlined 
              style={{ 
                fontSize: '14px',
                color: getThemeColor(theme, 'primary'),
                flexShrink: 0,
                marginTop: '2px'
              }} 
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                marginBottom: '2px',
                lineHeight: '1.3'
              }}>
                <Text strong style={{ color: getThemeColor(theme, 'text'), fontSize: '13px' }}>
                  向 AI 提问：
                </Text>
                <Text 
                  strong 
                  style={{ 
                    color: getThemeColor(theme, 'primary'),
                    fontSize: '13px',
                    lineHeight: '1.3'
                  }}
                >
                  {query}
                </Text>
              </div>
              <Text 
                type="secondary" 
                style={{ fontSize: '11px', lineHeight: '1.3', margin: 0 }}
              >
                按 Enter 生成回答
              </Text>
            </div>
          </div>
        </div>

        {/* 相关文章 */}
        <Divider style={{ margin: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            <FileTextOutlined /> 相关文章
          </Text>
        </Divider>
        {isSearching ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Spin size="small" />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              正在查询文章...
            </Text>
          </div>
        ) : searchResults && searchResults.results.length > 0 ? (
          searchResults.results.map((article, idx) => {
            const index = idx + 1;
            return (
              <div
                key={article.id}
                style={itemStyle(index)}
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
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <FileTextOutlined 
                    style={{ 
                      fontSize: '16px',
                      color: getThemeColor(theme, 'textSecondary'),
                      marginTop: '2px'
                    }} 
                  />
                  <div style={{ flex: 1 }}>
                    <Text 
                      ellipsis 
                      style={{ 
                        display: 'block',
                        color: getThemeColor(theme, 'text'),
                        marginBottom: '4px'
                      }}
                    >
                      {article.title_zh || article.title}
                    </Text>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      fontSize: '12px',
                      flexWrap: 'wrap'
                    }}>
                      <Text type="secondary">
                        {article.source}
                      </Text>
                      {article.published_at && (
                        <>
                          <Text type="secondary">·</Text>
                          <Text type="secondary">
                            {dayjs(article.published_at).format('YYYY-MM-DD')}
                          </Text>
                        </>
                      )}
                      {article.similarity !== undefined && (
                        <>
                          <Text type="secondary">·</Text>
                          <Tag 
                            color="blue" 
                            style={{ 
                              margin: 0, 
                              fontSize: '11px', 
                              padding: '0 6px',
                              lineHeight: '18px'
                            }}
                          >
                            匹配度: {Math.round(article.similarity * 100)}%
                          </Tag>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : searchResults && searchResults.results.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '20px' 
          }}>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              未找到相关文章
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}
