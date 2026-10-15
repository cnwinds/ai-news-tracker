/**
 * 文章分享页
 * 外部用户可直接访问，独立展示文章内容
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Skeleton } from 'antd';
import {
  ArrowLeftOutlined,
  DownOutlined,
  ExportOutlined,
  FileSearchOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { getImportanceLabel } from '@/utils/article';
import { Markdown } from '@/utils/markdown';
import ShareShell from '@/components/share/ShareShell';

const IMPORTANCE_CHIP: Record<string, string> = {
  high: 'chip chip--danger',
  medium: 'chip chip--warning',
  low: 'chip',
};

export default function ShareArticle() {
  const { id } = useParams();
  const articleId = Number(id);
  const navigate = useNavigate();
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const isValidId = Number.isFinite(articleId) && articleId > 0;

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['share-article', articleId],
    queryFn: () => apiService.getArticle(articleId),
    enabled: isValidId,
    staleTime: 60 * 1000,
  });

  const renderState = (text: string) => (
    <div className="reader__empty share-state">
      <div className="reader__empty-mark">
        <FileSearchOutlined />
      </div>
      <span>{text}</span>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
        返回首页
      </Button>
    </div>
  );

  let body;
  if (!isValidId) {
    body = renderState('分享链接无效');
  } else if (isLoading) {
    body = (
      <div className="share-loading">
        <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 10 }} />
      </div>
    );
  } else if (error) {
    body = renderState('加载文章失败');
  } else if (article) {
    const brief = article.detailed_summary || article.summary;
    body = (
      <article className="reader">
        <header>
          <div className="reader__kicker">
            {article.importance && (
              <span className={IMPORTANCE_CHIP[article.importance] || 'chip'}>
                <span className={`dot dot--${article.importance}`} style={{ boxShadow: 'none' }} />
                {getImportanceLabel(article.importance)}重要度
              </span>
            )}
            <span className="chip chip--outline">{article.source}</span>
            {article.category && <span className="chip">{article.category}</span>}
          </div>
          <h1 className="reader__title">{article.title_zh || article.title}</h1>
          {article.title_zh && article.title_zh !== article.title && (
            <p className="reader__subtitle">{article.title}</p>
          )}
          <div className="reader__meta">
            {article.published_at && (
              <span className="reader__meta-item mono">
                {dayjs(article.published_at).format('YYYY-MM-DD HH:mm')}
              </span>
            )}
            {article.author && <span className="reader__meta-item">作者 · {article.author}</span>}
          </div>
        </header>

        {brief && (
          <section className="reader__section">
            <div className="reader__section-head">
              <span className="eyebrow">
                <RobotOutlined /> {article.detailed_summary ? 'AI 精读' : '摘要'}
              </span>
            </div>
            <div className="reader__brief">
              <Markdown>{brief}</Markdown>
            </div>
          </section>
        )}

        <section className="reader__section">
          <div className="reader__section-head">
            {article.content ? (
              <button
                type="button"
                className="reader__toggle"
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                aria-expanded={isContentExpanded}
              >
                <span className="eyebrow">文章内容</span>
                <DownOutlined
                  style={{
                    fontSize: 10,
                    color: 'var(--c-text-tertiary)',
                    transform: isContentExpanded ? 'rotate(180deg)' : undefined,
                    transition: 'transform 0.15s ease',
                  }}
                />
              </button>
            ) : (
              <span className="eyebrow">文章内容</span>
            )}
          </div>
          {article.content ? (
            isContentExpanded && (
              <div className="reader__content">
                <Markdown compact>{article.content}</Markdown>
              </div>
            )
          ) : (
            <p className="u-muted" style={{ fontSize: 13 }}>
              文章内容未保存，请查看原文链接
            </p>
          )}
        </section>

        {article.tags && article.tags.length > 0 && (
          <section className="reader__section">
            <div className="reader__section-head">
              <span className="eyebrow">标签</span>
            </div>
            <div className="reader__tags">
              {article.tags.map((tag, idx) => (
                <span key={idx} className="chip">
                  # {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="share-actions">
          <div className="share-actions__buttons">
            <Button
              type="primary"
              icon={<ExportOutlined />}
              onClick={() => {
                if (article.url) {
                  window.open(article.url, '_blank');
                }
              }}
            >
              查看原文
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
              返回首页
            </Button>
          </div>
          <span className="share-actions__time">
            采集于 {dayjs(article.collected_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>
      </article>
    );
  } else {
    body = null;
  }

  return <ShareShell label="Shared Article">{body}</ShareShell>;
}
