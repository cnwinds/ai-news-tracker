/**
 * 文章详情模态框组件
 * 显示文章的完整内容、摘要等信息
 */
import { useState, useEffect } from 'react';
import { Modal, Typography, Spin, Tag, Space, Button, Divider, Empty, message, Popconfirm } from 'antd';
import {
  CloseOutlined,
  LinkOutlined,
  ShareAltOutlined,
  StarOutlined,
  StarFilled,
  DownOutlined,
  UpOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDeleteArticle } from '@/hooks/useArticles';
import { getThemeColor } from '@/utils/theme';
import { createMarkdownComponents } from '@/utils/markdown';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface ArticleDetailModalProps {
  articleId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function ArticleDetailModal({ 
  articleId, 
  open, 
  onClose 
}: ArticleDetailModalProps) {
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 获取文章详情
  const { data: article, isLoading, error } = useQuery({
    queryKey: ['article', articleId],
    queryFn: () => apiService.getArticle(articleId!),
    enabled: open && articleId !== null,
    staleTime: 30000,
  });

  const queryClient = useQueryClient();

  // 收藏/取消收藏
  const favoriteMutation = useMutation({
    mutationFn: async () => {
      if (!article) return;
      if (article.is_favorited) {
        await apiService.unfavoriteArticle(article.id);
      } else {
        await apiService.favoriteArticle(article.id);
      }
    },
    onSuccess: () => {
      // 刷新文章数据
      queryClient.invalidateQueries({ queryKey: ['article', articleId] });
    },
  });

  const handleFavorite = async () => {
    if (!article) return;
    favoriteMutation.mutate();
  };

  // 删除文章
  const deleteMutation = useDeleteArticle();

  const handleDelete = () => {
    if (!article) return;
    deleteMutation.mutate(article.id, {
      onSuccess: () => {
        // 删除成功后关闭模态框
        onClose();
      },
    });
  };

  const modalStyle: React.CSSProperties = {
    maxWidth: isMobile ? '100%' : '900px',
    margin: isMobile ? 0 : '0 auto',
  };

  const modalBodyStyle: React.CSSProperties = {
    padding: 0,
    maxHeight: '80vh',
    overflowY: 'auto',
    background: getThemeColor(theme, 'bgElevated'),
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        message.success('分享链接已复制');
        return;
      }
    } catch (err) {
      // Fallback to manual copy.
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      message.success('分享链接已复制');
    } catch (err) {
      message.info(`分享链接: ${text}`);
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const handleCopyShareLink = () => {
    if (!article) return;
    const shareUrl = `${window.location.origin}/share/${article.id}`;
    void copyToClipboard(shareUrl);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width="100%"
      style={modalStyle}
      bodyStyle={modalBodyStyle}
      maskStyle={{
        backgroundColor: theme === 'dark' 
          ? 'rgba(0, 0, 0, 0.6)' 
          : 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* 顶部栏 */}
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
                <Tag
                  color={
                    article.importance === 'high' ? 'red' :
                    article.importance === 'medium' ? 'orange' : 'default'
                  }
                  style={{ flexShrink: 0 }}
                >
                  {article.importance === 'high' ? '高' :
                   article.importance === 'medium' ? '中' : '低'}
                </Tag>
              )}
              <Text
                strong
                style={{
                  fontSize: isMobile ? '16px' : '18px',
                  color: getThemeColor(theme, 'text'),
                  flex: 1,
                  minWidth: 0,
                  lineHeight: '1.4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {article.title_zh || article.title}
              </Text>
              <Tag color="blue" style={{ flexShrink: 0 }}>
                {article.source}
              </Tag>
            </>
          )}
        </div>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          title="关闭 (Esc)"
          style={{ flexShrink: 0 }}
        />
      </div>

      {/* 内容区域 */}
      <div style={{ padding: isMobile ? '16px' : '24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: getThemeColor(theme, 'textSecondary') }}>
              加载中...
            </div>
          </div>
        ) : error ? (
          <Empty
            description="加载文章失败"
            style={{ marginTop: 50 }}
          />
        ) : article ? (
          <>
            {/* 元信息 */}
            <div style={{ marginBottom: 24 }}>
              <Space size="middle" wrap>
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
            </div>

            {/* AI生成的摘要 */}
            {article.summary && (
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    padding: '16px',
                    backgroundColor: getThemeColor(theme, 'bgSecondary'),
                    borderRadius: '8px',
                    border: `1px solid ${getThemeColor(theme, 'border')}`,
                    color: getThemeColor(theme, 'text'),
                    lineHeight: '1.8',
                  }}
                >
                  <ReactMarkdown components={createMarkdownComponents(theme)}>
                    {article.summary}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* 文章内容 */}
            {article.content ? (
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    marginBottom: 12,
                  }}
                  onClick={() => setIsContentExpanded(!isContentExpanded)}
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
                {isContentExpanded && (
                  <div
                    style={{
                      padding: '16px',
                      backgroundColor: getThemeColor(theme, 'bgSecondary'),
                      borderRadius: '8px',
                      border: `1px solid ${getThemeColor(theme, 'border')}`,
                      color: getThemeColor(theme, 'text'),
                      lineHeight: '1.8',
                      wordBreak: 'break-word',
                    }}
                  >
                    <ReactMarkdown components={createMarkdownComponents(theme)}>
                      {article.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <Text type="secondary">文章内容未保存，请查看原文链接</Text>
              </div>
            )}

            {/* 标签 */}
            {article.tags && article.tags.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                  标签：
                </Text>
                <Space size={[8, 8]} wrap style={{ marginLeft: 8 }}>
                  {article.tags.map((tag, idx) => (
                    <Tag key={idx}>{tag}</Tag>
                  ))}
                </Space>
              </div>
            )}

            {/* 操作按钮 */}
            <Divider />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
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
                <Button
                  icon={<ShareAltOutlined />}
                  onClick={handleCopyShareLink}
                >
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
                  description="删除后无法恢复"
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
              <Text type="secondary" style={{ fontSize: '12px' }}>
                采集时间：{dayjs(article.collected_at).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
