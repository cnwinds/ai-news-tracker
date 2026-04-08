import { useEffect, useState } from 'react';
import {
  Button,
  Divider,
  Empty,
  List,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  LinkOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';

import { apiService } from '@/services/api';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDeleteArticle } from '@/hooks/useArticles';
import { getThemeColor } from '@/utils/theme';
import { createMarkdownComponents, normalizeMarkdownImageContent, remarkGfm } from '@/utils/markdown';
import { copyToClipboard } from '@/utils/clipboard';
import { useMessage } from '@/hooks/useMessage';
import { getOrCreateSessionId } from '@/utils/sessionId';

const { Title, Text } = Typography;

interface ArticleDetailModalProps {
  articleId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function ArticleDetailModal({ articleId, open, onClose }: ArticleDetailModalProps) {
  const { theme } = useTheme();
  const { isAuthenticated, username } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const queryClient = useQueryClient();
  const message = useMessage();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => apiService.getArticle(articleId!),
    enabled: open && articleId !== null,
    staleTime: 30000,
  });

  const { data: graphContext, isLoading: graphContextLoading } = useQuery({
    queryKey: ['knowledge-graph-article-context', articleId],
    queryFn: () => apiService.getKnowledgeGraphArticleContext(articleId!),
    enabled: open && articleId !== null,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!open || !article) {
      return;
    }
    apiService.logAccess(
      'click',
      window.location.pathname,
      `查看文章: ${article.title}`,
      username || getOrCreateSessionId()
    ).catch((logError) => {
      console.debug('Failed to log article view:', logError);
    });
  }, [article, open, username]);

  const favoriteMutation = useMutation({
    mutationFn: async () => {
      if (!article) {
        return;
      }
      if (article.is_favorited) {
        await apiService.unfavoriteArticle(article.id);
      } else {
        await apiService.favoriteArticle(article.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article', articleId] });
    },
  });

  const deleteMutation = useDeleteArticle();

  const handleFavorite = () => {
    if (!article) {
      return;
    }
    favoriteMutation.mutate();
  };

  const handleDelete = () => {
    if (!article) {
      return;
    }
    deleteMutation.mutate(article.id, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  const handleCopyShareLink = () => {
    if (!article) {
      return;
    }
    const shareUrl = `${window.location.origin}/share/${article.id}`;
    void copyToClipboard(shareUrl, { onSuccess: (msg) => message.success(msg) }, '分享链接已复制');
  };

  const modalStyle: React.CSSProperties = {
    maxWidth: isMobile ? '100%' : '960px',
    margin: isMobile ? 0 : '0 auto',
  };

  const modalBodyStyle: React.CSSProperties = {
    padding: 0,
    maxHeight: '80vh',
    overflowY: 'auto',
    background: getThemeColor(theme, 'bgElevated'),
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width="100%"
      style={modalStyle}
      styles={{
        body: modalBodyStyle,
        mask: {
          backgroundColor: theme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(10px)',
        },
      }}
    >
      <div
        style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${getThemeColor(theme, 'border')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: getThemeColor(theme, 'bgElevated'),
          position: 'sticky',
          top: 0,
          zIndex: 10,
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {article && (
            <>
              {article.importance && (
                <Tag color={article.importance === 'high' ? 'red' : article.importance === 'medium' ? 'orange' : 'default'}>
                  {article.importance === 'high' ? '高' : article.importance === 'medium' ? '中' : '低'}
                </Tag>
              )}
              <Text
                strong
                style={{
                  fontSize: isMobile ? 16 : 18,
                  color: getThemeColor(theme, 'text'),
                  flex: 1,
                  minWidth: 0,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {article.title_zh || article.title}
              </Text>
              <Tag color="blue">{article.source}</Tag>
            </>
          )}
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      <div style={{ padding: isMobile ? '16px' : '24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: getThemeColor(theme, 'textSecondary') }}>加载中...</div>
          </div>
        ) : error ? (
          <Empty description="加载文章失败" style={{ marginTop: 50 }} />
        ) : article ? (
          <>
            <Space size="middle" wrap style={{ marginBottom: 24 }}>
              {article.published_at && (
                <Text type="secondary">
                  <strong>发布时间：</strong>
                  {dayjs(article.published_at).format('YYYY-MM-DD HH:mm')}
                </Text>
              )}
              {article.author && (
                <Text type="secondary">
                  <strong>作者：</strong>
                  {article.author}
                </Text>
              )}
            </Space>

            {(article.detailed_summary || article.summary) && (
              <section style={{ marginBottom: 24 }}>
                <Title level={4} style={{ marginTop: 0, color: getThemeColor(theme, 'text') }}>
                  AI 精读
                </Title>
                <div
                  style={{
                    padding: 16,
                    backgroundColor: getThemeColor(theme, 'bgSecondary'),
                    borderRadius: 8,
                    border: `1px solid ${getThemeColor(theme, 'border')}`,
                    color: getThemeColor(theme, 'text'),
                    lineHeight: 1.8,
                  }}
                >
                  <ReactMarkdown
                    components={createMarkdownComponents(theme)}
                    remarkPlugins={[remarkGfm]}
                  >
                    {normalizeMarkdownImageContent(article.detailed_summary || article.summary || '')}
                  </ReactMarkdown>
                </div>
              </section>
            )}

            <section style={{ marginBottom: 24 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 12 }}
                onClick={() => setIsContentExpanded((value) => !value)}
              >
                <Title level={4} style={{ color: getThemeColor(theme, 'text'), margin: 0 }}>
                  文章内容
                </Title>
                <Button
                  type="text"
                  icon={isContentExpanded ? <UpOutlined /> : <DownOutlined />}
                  size="small"
                  style={{ color: getThemeColor(theme, 'textSecondary'), marginLeft: 8 }}
                />
              </div>
              {article.content ? (
                isContentExpanded ? (
                  <div
                    style={{
                      padding: 16,
                      backgroundColor: getThemeColor(theme, 'bgSecondary'),
                      borderRadius: 8,
                      border: `1px solid ${getThemeColor(theme, 'border')}`,
                      color: getThemeColor(theme, 'text'),
                      lineHeight: 1.8,
                      wordBreak: 'break-word',
                    }}
                  >
                    <ReactMarkdown
                      components={createMarkdownComponents(theme)}
                      remarkPlugins={[remarkGfm]}
                    >
                      {normalizeMarkdownImageContent(article.content)}
                    </ReactMarkdown>
                  </div>
                ) : null
              ) : (
                <Text type="secondary">文章正文未保存，请通过原文链接查看。</Text>
              )}
            </section>

            {article.tags && article.tags.length > 0 && (
              <section style={{ marginBottom: 24 }}>
                <Text strong>标签：</Text>
                <Space size={[8, 8]} wrap style={{ marginLeft: 8 }}>
                  {article.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              </section>
            )}

            <section style={{ marginBottom: 24 }}>
              <Title level={4} style={{ marginTop: 0, color: getThemeColor(theme, 'text') }}>
                图谱上下文
              </Title>
              {graphContextLoading ? (
                <Spin size="small" />
              ) : graphContext && (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <Text strong>关联实体</Text>
                    <div style={{ marginTop: 8 }}>
                      {graphContext.nodes.length > 0 ? (
                        graphContext.nodes.map((node) => (
                          <Tag key={node.node_key}>
                            {node.label} / {node.node_type}
                          </Tag>
                        ))
                      ) : (
                        <Text type="secondary">当前文章还没有同步出可展示的图谱实体。</Text>
                      )}
                    </div>
                  </div>

                  <div>
                    <Text strong>命中社区</Text>
                    <div style={{ marginTop: 8 }}>
                      {graphContext.communities.length > 0 ? (
                        graphContext.communities.map((community) => (
                          <Tag key={community.community_id} color="blue">
                            {community.label}
                          </Tag>
                        ))
                      ) : (
                        <Text type="secondary">暂无社区归属。</Text>
                      )}
                    </div>
                  </div>

                  <div>
                    <Text strong>相关文章</Text>
                    <List
                      size="small"
                      locale={{ emptyText: '暂无相关文章' }}
                      dataSource={graphContext.related_articles}
                      renderItem={(relatedArticle) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Space direction="vertical" size={0} style={{ width: '100%' }}>
                            <a href={relatedArticle.url} target="_blank" rel="noreferrer">
                              {relatedArticle.title_zh || relatedArticle.title}
                            </a>
                            <Text type="secondary">
                              {relatedArticle.source} · 关系数 {relatedArticle.relation_count}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </div>
                </Space>
              )}
            </section>

            <Divider />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<LinkOutlined />}
                  onClick={() => {
                    if (article.url) {
                      window.open(article.url, '_blank');
                    }
                  }}
                >
                  查看原文
                </Button>
                <Button icon={<ShareAltOutlined />} onClick={handleCopyShareLink}>
                  分享链接
                </Button>
                <Button
                  icon={article.is_favorited ? <StarFilled /> : <StarOutlined />}
                  onClick={handleFavorite}
                  disabled={!isAuthenticated}
                >
                  {article.is_favorited ? '已收藏' : '收藏'}
                </Button>
                <Popconfirm
                  title="确定要删除这篇文章吗？"
                  description="删除后无法恢复。"
                  onConfirm={handleDelete}
                  okText="确定"
                  cancelText="取消"
                  disabled={!isAuthenticated}
                >
                  <Button
                    type="primary"
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleteMutation.isPending}
                    disabled={!isAuthenticated}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                采集时间：{dayjs(article.collected_at).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
