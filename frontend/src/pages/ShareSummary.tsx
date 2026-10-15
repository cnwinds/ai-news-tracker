/**
 * 摘要分享页
 * 外部用户可直接访问，独立展示摘要内容
 */
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Skeleton } from 'antd';
import { ArrowLeftOutlined, FileSearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import ShareShell from '@/components/share/ShareShell';
import SummaryDigest from '@/components/summary/SummaryDigest';
import { digestHeadline, parseSummary } from '@/components/summary/parse';
import '@/styles/pages/summary.css';

export default function ShareSummary() {
  const { id } = useParams();
  const summaryId = Number(id);
  const navigate = useNavigate();
  const isValidId = Number.isFinite(summaryId) && summaryId > 0;

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['share-summary', summaryId],
    queryFn: () => apiService.getSummary(summaryId),
    enabled: isValidId,
    staleTime: 60 * 1000,
  });

  const isDaily = summary?.summary_type === 'daily';

  const headline = useMemo(
    () => (summary?.summary_content ? digestHeadline(parseSummary(summary.summary_content)) : null),
    [summary?.summary_content]
  );
  const summaryTitle = summary
    ? headline ||
      (isDaily
        ? `每日摘要 - ${dayjs(summary.summary_date).format('YYYY-MM-DD')}`
        : `每周摘要 - ${dayjs(summary.start_date).format('YYYY-MM-DD')} 至 ${dayjs(summary.end_date).format('YYYY-MM-DD')}`)
    : '';

  const summaryRange = summary
    ? isDaily
      ? dayjs(summary.summary_date).format('YYYY-MM-DD')
      : `${dayjs(summary.start_date).format('YYYY-MM-DD')} 至 ${dayjs(summary.end_date).format('YYYY-MM-DD')}`
    : '';

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
        <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 12 }} />
      </div>
    );
  } else if (error) {
    body = renderState('加载摘要失败');
  } else if (summary) {
    body = (
      <article className="reader share-summary">
        <header>
          <div className="reader__kicker">
            <span className="chip chip--accent">{isDaily ? '日报' : '周报'}</span>
            <span className="chip chip--outline mono">{summaryRange}</span>
          </div>
          <h1 className="reader__title">{summaryTitle}</h1>
          <div className="reader__meta">
            <span className="reader__meta-item">
              覆盖范围 <span className="mono">{summaryRange}</span>
            </span>
          </div>
        </header>

        <section className="reader__section">
          {summary.summary_content ? (
            <SummaryDigest
              content={summary.summary_content}
              stats={{
                total: summary.total_articles,
                high: summary.high_importance_count,
                medium: summary.medium_importance_count,
              }}
              illustrations={summary.illustrations}
            />
          ) : (
            <p className="u-muted" style={{ fontSize: 13 }}>
              摘要内容为空
            </p>
          )}
        </section>

        {summary.key_topics && summary.key_topics.length > 0 && (
          <section className="reader__section">
            <div className="reader__section-head">
              <span className="eyebrow">关键主题</span>
            </div>
            <div className="reader__tags">
              {summary.key_topics.map((topic, idx) => (
                <span key={`${topic}-${idx}`} className="chip">
                  # {topic}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="share-actions">
          <div className="share-actions__buttons">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
              返回首页
            </Button>
          </div>
          <span className="share-actions__time">
            生成于 {dayjs(summary.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>
      </article>
    );
  } else {
    body = null;
  }

  return <ShareShell label={isDaily ? 'Daily Brief' : 'Shared Brief'}>{body}</ShareShell>;
}
