/**
 * 文章阅读器：PC 分栏右侧、手机全屏页、搜索弹窗共用
 */
import { useEffect, useState } from 'react';
import { Button, Dropdown, Input, Popconfirm, Skeleton, Space, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  MoreOutlined,
  RobotOutlined,
  ShareAltOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Article } from '@/types';
import {
  useAnalyzeArticle,
  useArticle,
  useDeleteArticle,
  useFavoriteArticle,
  useUnfavoriteArticle,
  useUpdateArticle,
} from '@/hooks/useArticles';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { apiService } from '@/services/api';
import { copyToClipboard } from '@/utils/clipboard';
import { getOrCreateSessionId } from '@/utils/sessionId';
import { getImportanceLabel, getSummaryText } from '@/utils/article';
import { Markdown } from '@/utils/markdown';

interface ArticleReaderProps {
  articleId: number;
  /** 列表中的已有数据，用于即时渲染标题等信息 */
  preview?: Article;
  /** 'back' 显示返回箭头（手机），'close' 显示关闭（弹窗） */
  dismiss?: 'back' | 'close';
  onDismiss?: () => void;
  onDeleted?: () => void;
  /** 是否记录访问日志（自动选中的文章不记录） */
  trackView?: boolean;
}

function parseDetailedSummary(article: Article): string {
  const raw = article.detailed_summary ? String(article.detailed_summary).trim() : '';
  if (raw) {
    if (raw.startsWith('{') && raw.includes('"detailed_summary"')) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.detailed_summary === 'string') {
          return parsed.detailed_summary;
        }
      } catch {
        // 非 JSON，按原文处理
      }
    }
    return raw;
  }
  return getSummaryText(article);
}

const IMPORTANCE_CHIP: Record<string, string> = {
  high: 'chip chip--danger',
  medium: 'chip chip--warning',
  low: 'chip',
};

export default function ArticleReader({
  articleId,
  preview,
  dismiss,
  onDismiss,
  onDeleted,
  trackView = true,
}: ArticleReaderProps) {
  const message = useMessage();
  const { isAuthenticated, username } = useAuth();
  const { data, isLoading, error } = useArticle(articleId);
  const article = data ?? preview;

  const analyzeMutation = useAnalyzeArticle();
  const deleteMutation = useDeleteArticle();
  const favoriteMutation = useFavoriteArticle();
  const unfavoriteMutation = useUnfavoriteArticle();
  const updateMutation = useUpdateArticle();

  const [contentOpen, setContentOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');

  useEffect(() => {
    setContentOpen(false);
    setEditingNotes(false);
  }, [articleId]);

  useEffect(() => {
    if (!editingNotes) {
      setNotesValue(data?.user_notes || '');
    }
  }, [data?.user_notes, editingNotes]);

  useEffect(() => {
    if (!data || !trackView) return;
    apiService
      .logAccess('page_view', window.location.pathname, `展开文章: ${data.title}`, username || getOrCreateSessionId())
      .catch((logError) => console.debug('Failed to log article view:', logError));
    // 每篇文章只记录一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, trackView]);

  if (!article) {
    return (
      <div className="reader">
        <div style={{ paddingTop: 32 }}>
          {error ? (
            <div className="reader__empty">加载文章失败</div>
          ) : (
            <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 8 }} />
          )}
        </div>
      </div>
    );
  }

  const displayTitle = article.title_zh || article.title;
  const brief = data ? parseDetailedSummary(data) : '';
  const publishedAt = article.published_at ? dayjs(article.published_at) : null;

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/share/${article.id}`;
    void copyToClipboard(shareUrl, { onSuccess: (msg) => message.success(msg) }, '分享链接已复制');
  };

  const handleFavorite = () => {
    if (article.is_favorited) {
      unfavoriteMutation.mutate(article.id);
    } else {
      favoriteMutation.mutate(article.id);
    }
  };

  const handleSaveNotes = () => {
    updateMutation.mutate(
      { id: article.id, data: { user_notes: notesValue } },
      { onSuccess: () => setEditingNotes(false) }
    );
  };

  const moreItems: MenuProps['items'] = isAuthenticated
    ? [
        {
          key: 'analyze',
          icon: <RobotOutlined />,
          label: article.is_processed ? '重新 AI 分析' : 'AI 分析',
          disabled: analyzeMutation.isPending,
          onClick: () => analyzeMutation.mutate({ id: article.id, force: article.is_processed }),
        },
        {
          key: 'notes',
          icon: <EditOutlined />,
          label: data?.user_notes ? '编辑笔记' : '添加笔记',
          onClick: () => setEditingNotes(true),
        },
      ]
    : [];

  return (
    <article className="reader">
      <div className="reader__bar">
        <div className="reader__bar-group">
          {dismiss && (
            <button
              type="button"
              className="icon-btn"
              onClick={onDismiss}
              aria-label={dismiss === 'back' ? '返回' : '关闭'}
            >
              {dismiss === 'back' ? <ArrowLeftOutlined /> : <CloseOutlined />}
            </button>
          )}
          <span className="chip chip--outline" title={article.source}>
            {article.source}
          </span>
        </div>
        <div className="reader__bar-group">
          <Tooltip title="复制分享链接">
            <button type="button" className="icon-btn" onClick={handleShare} aria-label="分享">
              <ShareAltOutlined />
            </button>
          </Tooltip>
          {isAuthenticated && (
            <Tooltip title={article.is_favorited ? '取消收藏' : '收藏'}>
              <button
                type="button"
                className={`icon-btn${article.is_favorited ? ' icon-btn--active' : ''}`}
                onClick={handleFavorite}
                aria-label="收藏"
                disabled={favoriteMutation.isPending || unfavoriteMutation.isPending}
                style={article.is_favorited ? { color: 'var(--c-warning)' } : undefined}
              >
                {article.is_favorited ? <StarFilled /> : <StarOutlined />}
              </button>
            </Tooltip>
          )}
          {isAuthenticated && (
            <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
              <button type="button" className="icon-btn" aria-label="更多操作">
                <MoreOutlined />
              </button>
            </Dropdown>
          )}
          {isAuthenticated && (
            <Popconfirm
              title="删除这篇文章？"
              description="删除后无法恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate(article.id, { onSuccess: () => onDeleted?.() })}
            >
              <Tooltip title="删除">
                <button type="button" className="icon-btn" aria-label="删除">
                  <DeleteOutlined />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
          <Button
            type="primary"
            size="small"
            icon={<ExportOutlined />}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 6 }}
          >
            原文
          </Button>
        </div>
      </div>

      <header>
        <div className="reader__kicker">
          {article.importance && (
            <span className={IMPORTANCE_CHIP[article.importance] || 'chip'}>
              <span className={`dot dot--${article.importance}`} style={{ boxShadow: 'none' }} />
              {getImportanceLabel(article.importance)}重要度
            </span>
          )}
          {article.category && <span className="chip">{article.category}</span>}
          {article.is_processed && (
            <span className="chip chip--accent">
              <RobotOutlined /> AI 已分析
            </span>
          )}
        </div>
        <h1 className="reader__title">{displayTitle}</h1>
        {article.title_zh && article.title_zh !== article.title && (
          <p className="reader__subtitle">{article.title}</p>
        )}
        <div className="reader__meta">
          {publishedAt && (
            <span className="reader__meta-item mono">{publishedAt.format('YYYY-MM-DD HH:mm')}</span>
          )}
          {data?.author && <span className="reader__meta-item">作者 · {data.author}</span>}
          {data?.target_audience && <span className="reader__meta-item">面向 · {data.target_audience}</span>}
          <span className="reader__meta-item">采集于 {dayjs(article.collected_at).locale('zh-cn').fromNow()}</span>
        </div>
      </header>

      {isLoading && !data ? (
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      ) : (
        <>
          {brief && (
            <section className="reader__section">
              <div className="reader__section-head">
                <span className="eyebrow">{data?.detailed_summary ? 'AI 精读' : '摘要'}</span>
              </div>
              <div className="reader__brief">
                <Markdown>{brief}</Markdown>
              </div>
            </section>
          )}

          {(editingNotes || data?.user_notes) && (
            <section className="reader__section">
              <div className="reader__section-head">
                <span className="eyebrow">我的笔记</span>
                {!editingNotes && isAuthenticated && (
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingNotes(true)}>
                    编辑
                  </Button>
                )}
              </div>
              {editingNotes ? (
                <>
                  <Input.TextArea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="记录你的思考或评论..."
                    autoSize={{ minRows: 4, maxRows: 12 }}
                    autoFocus
                  />
                  <Space style={{ marginTop: 10 }}>
                    <Button type="primary" size="small" onClick={handleSaveNotes} loading={updateMutation.isPending}>
                      保存
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setNotesValue(data?.user_notes || '');
                        setEditingNotes(false);
                      }}
                    >
                      取消
                    </Button>
                  </Space>
                </>
              ) : (
                <div className="reader__notes">{data?.user_notes}</div>
              )}
            </section>
          )}

          <section className="reader__section">
            <div className="reader__section-head">
              <button
                type="button"
                className="reader__toggle"
                onClick={() => setContentOpen((v) => !v)}
                aria-expanded={contentOpen}
              >
                <span className="eyebrow">原文内容</span>
                <DownOutlined
                  style={{
                    fontSize: 10,
                    color: 'var(--c-text-tertiary)',
                    transform: contentOpen ? 'rotate(180deg)' : undefined,
                    transition: 'transform 0.15s ease',
                  }}
                />
              </button>
            </div>
            {contentOpen &&
              (data?.content ? (
                <div className="reader__content">
                  <Markdown compact>{data.content}</Markdown>
                </div>
              ) : (
                <p className="u-muted" style={{ fontSize: 13 }}>
                  正文未保存，请通过原文链接查看。
                </p>
              ))}
          </section>

          {data?.tags && data.tags.length > 0 && (
            <section className="reader__section">
              <div className="reader__section-head">
                <span className="eyebrow">标签</span>
              </div>
              <div className="reader__tags">
                {data.tags.map((tag) => (
                  <span key={tag} className="chip">
                    # {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </article>
  );
}
