/**
 * 文章卡片组件
 */
import { useState, useEffect } from 'react';
import { Card, Tag, Button, Space, Typography, Popconfirm, Tooltip, Input, Spin, Divider } from 'antd';
import { LinkOutlined, DeleteOutlined, RobotOutlined, UpOutlined, DownOutlined, StarOutlined, StarFilled, EditOutlined, SaveOutlined, ShareAltOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import type { Article } from '@/types';
import { useAnalyzeArticle, useDeleteArticle, useFavoriteArticle, useUnfavoriteArticle, useUpdateArticle, useArticleDetails } from '@/hooks/useArticles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { apiService } from '@/services/api';
import { createMarkdownComponents, normalizeMarkdownImageContent, remarkGfm } from '@/utils/markdown';
import { getThemeColor } from '@/utils/theme';
import { getSummaryText, IMPORTANCE_COLORS, getImportanceLabel } from '@/utils/article';
import { copyToClipboard } from '@/utils/clipboard';
import { useMessage } from '@/hooks/useMessage';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { getOrCreateSessionId } from '@/utils/sessionId';
import MobileListRow from '@/components/mobile/MobileListRow';

const { TextArea } = Input;
const { Title, Text } = Typography;

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const message = useMessage();
  const [expanded, setExpanded] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(article.user_notes || '');
  
  const analyzeMutation = useAnalyzeArticle();
  const deleteMutation = useDeleteArticle();
  const favoriteMutation = useFavoriteArticle();
  const unfavoriteMutation = useUnfavoriteArticle();
  const updateMutation = useUpdateArticle();
  const { theme } = useTheme();
  const { isAuthenticated, username } = useAuth();
  const { isMobile } = useBreakpoint();

  // 按需加载：只在展开时一次性加载所有详细字段
  const { data: loadedDetails, isLoading: isLoadingDetails } = useArticleDetails(
    article.id,
    expanded // 只有在展开时才加载
  );

  // 使用加载的数据或原始数据
  const articleWithLoadedData = {
    ...article,
    summary: loadedDetails?.summary ?? article.summary,
    detailed_summary: loadedDetails?.detailed_summary ?? article.detailed_summary,
    content: loadedDetails?.content ?? article.content,
    author: loadedDetails?.author ?? article.author,
    tags: loadedDetails?.tags ?? article.tags,
    user_notes: loadedDetails?.user_notes ?? article.user_notes,
    target_audience: loadedDetails?.target_audience ?? article.target_audience,
  };

  // 当加载的详细信息更新时，同步更新notesValue（仅在未编辑状态下）
  useEffect(() => {
    if (loadedDetails?.user_notes !== undefined && !isEditingNotes) {
      setNotesValue(loadedDetails.user_notes || '');
    }
  }, [loadedDetails?.user_notes, isEditingNotes]);

  // 当文章展开时，记录文章展开访问
  useEffect(() => {
    if (expanded && article) {
      apiService.logAccess(
        'page_view',  // 页面浏览量 = 文章展开
        window.location.pathname,
        `展开文章: ${article.title}`,
        username || getOrCreateSessionId()
      ).catch((error) => {
        console.debug('Failed to log article expand:', error);
      });
    }
  }, [expanded, article, username]);

  // 优先显示 detailed_summary（精读），如果没有则显示 summary（摘要）
  const getDetailedSummaryText = (article: Article): string => {
    if (article.detailed_summary) {
      const detailedSummaryStr = String(article.detailed_summary).trim();
      if (detailedSummaryStr) {
        // 处理可能的 JSON 格式
        if (detailedSummaryStr.startsWith('{') && detailedSummaryStr.includes('"detailed_summary"')) {
          try {
            const parsed = JSON.parse(detailedSummaryStr);
            if (typeof parsed === 'object' && parsed !== null && 'detailed_summary' in parsed) {
              if (typeof parsed.detailed_summary === 'string') {
                return parsed.detailed_summary;
              }
            }
          } catch {
            // JSON 解析失败，返回原始字符串
          }
        }
        return detailedSummaryStr;
      }
    }
    // 如果没有 detailed_summary，回退到 summary
    return getSummaryText(article);
  };
  
  const summaryText = getDetailedSummaryText(articleWithLoadedData);

  const handleAnalyze = () => {
    // 如果已分析，使用 force=true 强制重新分析
    analyzeMutation.mutate({ 
      id: article.id, 
      force: article.is_processed 
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(article.id);
  };

  const handleFavorite = () => {
    if (article.is_favorited) {
      unfavoriteMutation.mutate(article.id);
    } else {
      favoriteMutation.mutate(article.id);
    }
  };

  const handleSaveNotes = () => {
    updateMutation.mutate({
      id: article.id,
      data: { user_notes: notesValue },
    }, {
      onSuccess: () => {
        setIsEditingNotes(false);
      },
    });
  };

  const handleCancelEditNotes = () => {
    setNotesValue(articleWithLoadedData.user_notes || '');
    setIsEditingNotes(false);
  };

  const handleShareLink = () => {
    const shareUrl = `${window.location.origin}/share/${article.id}`;
    void copyToClipboard(shareUrl, { onSuccess: (msg) => message.success(msg) }, '分享链接已复制');
  };

  const actionButtonSize = isMobile ? 'small' : 'middle';
  const titleStyle = { marginBottom: 0, display: 'inline' as const, fontSize: isMobile ? 16 : undefined };
  const displayTitle = article.title_zh || article.title;
  const mobileDate = article.published_at
    ? dayjs(article.published_at).format('MM-DD')
    : '未知';

  const expandedDetails = (
    <div style={{
      marginTop: isMobile ? 0 : 8,
      paddingTop: isMobile ? 12 : 8,
      borderTop: isMobile ? 'none' : `1px solid ${getThemeColor(theme, 'border')}`,
    }}>
            {/* 日期和作者 */}
            <div style={{ marginBottom: 8 }}>
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {article.published_at
                    ? dayjs(article.published_at).format('YYYY-MM-DD HH:mm')
                    : '未知时间'}
                </Text>
                {articleWithLoadedData.author && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    作者: {articleWithLoadedData.author}
                  </Text>
                )}
                {!article.is_processed && <Tag>未分析</Tag>}
              </Space>
            </div>

            {/* 摘要区域：摘要内容（Markdown格式） */}
            {isLoadingDetails ? (
              <div style={{ marginBottom: 12, textAlign: 'center', padding: '20px 0' }}>
                <Spin size="small" />
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  加载详细信息中...
                </Text>
              </div>
            ) : summaryText ? (
              <div style={{ marginBottom: 12 }}>
                {article.is_processed && (
                  <Tag icon={<RobotOutlined />} color="purple" style={{ marginBottom: 8 }}>
                    AI生成的精读
                  </Tag>
                )}
                <div
                  style={{
                    fontSize: 14,
                    color: getThemeColor(theme, 'text'),
                    lineHeight: '1.6',
                  }}
                >
                  <ReactMarkdown 
                    components={createMarkdownComponents(theme)}
                    remarkPlugins={[remarkGfm]}
                  >
                    {normalizeMarkdownImageContent(summaryText)}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}

            {/* 文章内容（默认折叠） */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  marginBottom: 8,
                }}
                onClick={() => setIsContentExpanded(!isContentExpanded)}
              >
                <Text strong style={{ fontSize: 14, color: getThemeColor(theme, 'text'), margin: 0 }}>
                  文章内容
                </Text>
                <Button
                  type="text"
                  icon={isContentExpanded ? <UpOutlined /> : <DownOutlined />}
                  size="small"
                  style={{ color: getThemeColor(theme, 'textSecondary'), marginLeft: 8, padding: 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsContentExpanded(!isContentExpanded);
                  }}
                />
              </div>
              {isContentExpanded && (
                <>
                  {articleWithLoadedData.content ? (
                    <div
                      style={{
                        padding: '12px',
                        backgroundColor: getThemeColor(theme, 'bgSecondary'),
                        borderRadius: '6px',
                        border: `1px solid ${getThemeColor(theme, 'border')}`,
                        color: getThemeColor(theme, 'text'),
                        lineHeight: '1.8',
                        wordBreak: 'break-word',
                        fontSize: 13,
                        maxHeight: '400px',
                        overflowY: 'auto',
                      }}
                    >
                      <ReactMarkdown 
                        components={createMarkdownComponents(theme)}
                        remarkPlugins={[remarkGfm]}
                      >
                        {normalizeMarkdownImageContent(articleWithLoadedData.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      暂无内容
                    </Text>
                  )}
                </>
              )}
            </div>

            {/* 标签区域 */}
            {articleWithLoadedData.tags && articleWithLoadedData.tags.length > 0 && (
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <Text strong style={{ fontSize: 13, color: getThemeColor(theme, 'text'), flexShrink: 0, lineHeight: '28px' }}>
                  标签
                </Text>
                <Space size={[8, 8]} wrap style={{ flex: 1, minWidth: 0 }}>
                  {articleWithLoadedData.tags.map((tag, idx) => (
                    <Tag key={idx}>
                      {tag}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}

            {/* 用户笔记区域 */}
            {isEditingNotes ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14 }}>我的笔记</Text>
                </div>
                <div>
                  <TextArea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="记录你的思考或评论..."
                    rows={4}
                    style={{ marginBottom: 8 }}
                  />
                  <Space>
                    {isAuthenticated && (
                      <Button
                        type="primary"
                        size={actionButtonSize}
                        icon={<SaveOutlined />}
                        onClick={handleSaveNotes}
                        loading={updateMutation.isPending}
                      >
                        保存
                      </Button>
                    )}
                    <Button
                      size={actionButtonSize}
                      onClick={handleCancelEditNotes}
                    >
                      取消
                    </Button>
                  </Space>
                </div>
              </div>
            ) : articleWithLoadedData.user_notes ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <Text strong style={{ fontSize: 14 }}>我的笔记</Text>
                  {isAuthenticated && (
                    <Button
                      type="text"
                      size={actionButtonSize}
                      icon={<EditOutlined />}
                      onClick={() => setIsEditingNotes(true)}
                    >
                      编辑
                    </Button>
                  )}
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: getThemeColor(theme, 'bgSecondary'),
                    border: `1px solid ${getThemeColor(theme, 'border')}`,
                    borderRadius: 4,
                    minHeight: 40,
                    fontSize: 14,
                    color: getThemeColor(theme, 'text'),
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {articleWithLoadedData.user_notes}
                </div>
              </div>
            ) : null}

            {/* 分割线 */}
            <Divider style={{ margin: '12px 0' }} />

            {/* 查看原文按钮 */}
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* 第一组：文章交互操作 */}
              <Space size="small" wrap>
                <Button
                  type="default"
                  icon={<LinkOutlined />}
                  href={article.url}
                  target="_blank"
                  size={actionButtonSize}
                >
                  查看原文
                </Button>
                <Button
                  type="default"
                  icon={<ShareAltOutlined />}
                  onClick={handleShareLink}
                  size={actionButtonSize}
                >
                  分享
                </Button>
                {isAuthenticated && (
                  <Button
                    type={article.is_favorited ? "primary" : "default"}
                    icon={article.is_favorited ? <StarFilled /> : <StarOutlined />}
                    onClick={handleFavorite}
                    loading={favoriteMutation.isPending || unfavoriteMutation.isPending}
                    size={actionButtonSize}
                  >
                    {article.is_favorited ? '已收藏' : '收藏'}
                  </Button>
                )}
              </Space>
              
              {/* 第二组：笔记操作 */}
              {isAuthenticated && (
                <Space size="small" wrap style={{ marginLeft: 8 }}>
                  <Button
                    type="default"
                    icon={<EditOutlined />}
                    onClick={() => setIsEditingNotes(true)}
                    size={actionButtonSize}
                  >
                    笔记
                  </Button>
                </Space>
              )}
              
              {/* 第三组：管理操作 */}
              {!isEditingNotes && (
                <Space size="small" wrap style={{ marginLeft: 8 }}>
                  {isAuthenticated && (
                    <>
                      <Button
                        type="default"
                        size={actionButtonSize}
                        icon={<RobotOutlined />}
                        onClick={handleAnalyze}
                        loading={analyzeMutation.isPending}
                      >
                        {article.is_processed ? '重新分析' : 'AI分析'}
                      </Button>
                      <Popconfirm
                        title="确定要删除这篇文章吗？"
                        onConfirm={handleDelete}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button
                          type="primary"
                          danger
                          size={actionButtonSize}
                          icon={<DeleteOutlined />}
                          loading={deleteMutation.isPending}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  <Button
                    type="default"
                    size={actionButtonSize}
                    icon={<UpOutlined />}
                    onClick={() => setExpanded(false)}
                  >
                    收起
                  </Button>
                </Space>
              )}
            </div>
          </div>
  );

  if (isMobile) {
    const metaParts = [
      mobileDate,
      article.source,
      article.importance ? getImportanceLabel(article.importance) : null,
      article.is_favorited ? '已收藏' : null,
    ].filter(Boolean);

    return (
      <MobileListRow
        title={displayTitle}
        meta={metaParts.join(' · ')}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      >
        {expandedDetails}
      </MobileListRow>
    );
  }

  return (
    <Card
      style={{ marginBottom: 8 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            cursor: 'pointer',
            padding: '2px 0',
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) {
              return;
            }
            setExpanded(!expanded);
          }}
        >
          <Tag color="default" style={{ flexShrink: 0 }}>
            {article.published_at
              ? dayjs(article.published_at).format('YYYY-MM-DD')
              : '未知日期'}
          </Tag>
          {article.importance && (
            <Tag color={IMPORTANCE_COLORS[article.importance]} style={{ flexShrink: 0 }}>
              {getImportanceLabel(article.importance)}
            </Tag>
          )}
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {article.title_zh ? (
              <Tooltip title={article.title} placement="top">
                <Title
                  level={5}
                  style={titleStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = getThemeColor(theme, 'primary');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = getThemeColor(theme, 'text');
                  }}
                >
                  {article.title_zh}
                </Title>
              </Tooltip>
            ) : (
              <Title
                level={5}
                style={titleStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = getThemeColor(theme, 'primary');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = getThemeColor(theme, 'text');
                }}
              >
                {article.title}
              </Title>
            )}
            <Tag
              color="blue"
              style={{ flexShrink: 0, cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (article.url) {
                  window.open(article.url, '_blank');
                }
              }}
            >
              {article.source}
            </Tag>
            {article.is_favorited && (
              <Tooltip title="已收藏">
                <StarFilled style={{ color: '#faad14', fontSize: 14 }} />
              </Tooltip>
            )}
          </div>
          <Button
            type="text"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            size="small"
            style={{ flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          />
        </div>
        {expanded && expandedDetails}
      </Space>
    </Card>
  );
}

