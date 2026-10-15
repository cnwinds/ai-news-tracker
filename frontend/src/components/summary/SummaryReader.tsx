/**
 * 内容总结阅读器：PC 分栏右侧、手机全屏页共用
 */
import { Button, Popconfirm, Skeleton, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { DailySummaryListItem, SummaryFieldsResponse } from '@/types';
import { Markdown } from '@/utils/markdown';
import { summaryFullRange, summaryHeading, summaryWeekTag, TYPE_LABEL } from './format';

interface SummaryReaderProps {
  summary: DailySummaryListItem;
  details?: SummaryFieldsResponse;
  loading: boolean;
  canEdit: boolean;
  regenerating: boolean;
  deleting: boolean;
  onShare: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onRetry?: () => void;
  /** 手机端显示返回箭头 */
  onBack?: () => void;
}

export default function SummaryReader({
  summary,
  details,
  loading,
  canEdit,
  regenerating,
  deleting,
  onShare,
  onRegenerate,
  onDelete,
  onRetry,
  onBack,
}: SummaryReaderProps) {
  const weekTag = summaryWeekTag(summary);
  const topics = details?.key_topics ?? [];

  return (
    <article className="reader summary-reader">
      <div className="reader__bar">
        <div className="reader__bar-group">
          {onBack && (
            <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
              <ArrowLeftOutlined />
            </button>
          )}
          <span className={`chip${summary.summary_type === 'weekly' ? ' chip--accent' : ' chip--outline'}`}>
            {TYPE_LABEL[summary.summary_type] || summary.summary_type}
          </span>
          {weekTag && <span className="chip mono">{weekTag}</span>}
        </div>
        <div className="reader__bar-group">
          <Tooltip title="复制分享链接">
            <button type="button" className="icon-btn" onClick={onShare} aria-label="分享">
              <ShareAltOutlined />
            </button>
          </Tooltip>
          {canEdit && (
            <Popconfirm
              title="重新生成这份摘要？"
              description="将基于最新文章覆盖当前内容。"
              okText="重新生成"
              cancelText="取消"
              onConfirm={onRegenerate}
            >
              <Tooltip title="重新生成">
                <button type="button" className="icon-btn" aria-label="重新生成" disabled={regenerating}>
                  <ReloadOutlined spin={regenerating} />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
          {canEdit && (
            <Popconfirm
              title="删除这份摘要？"
              description="此操作不可恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleting }}
              onConfirm={onDelete}
            >
              <Tooltip title="删除">
                <button type="button" className="icon-btn summary-reader__danger" aria-label="删除">
                  <DeleteOutlined />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </div>

      <header>
        <div className="reader__kicker">
          <span className="eyebrow">{summaryHeading(summary)}</span>
        </div>
        <h1 className="reader__title mono summary-reader__title">{summaryFullRange(summary)}</h1>
        <div className="reader__meta">
          <span className="reader__meta-item">
            生成于 <span className="mono">{dayjs(summary.updated_at || summary.created_at).format('YYYY-MM-DD HH:mm')}</span>
          </span>
          {regenerating && (
            <span className="reader__meta-item u-accent">
              <span className="dot dot--live" />
              正在重新生成…
            </span>
          )}
        </div>
      </header>

      <div className="summary-stats" role="list">
        <div className="summary-stats__cell" role="listitem">
          <span className="summary-stats__label">文章</span>
          <span className="summary-stats__value">{summary.total_articles}</span>
        </div>
        <div className="summary-stats__cell" role="listitem">
          <span className="summary-stats__label">
            <span className="dot dot--high" />
            高重要
          </span>
          <span className="summary-stats__value summary-stats__value--high">{summary.high_importance_count}</span>
        </div>
        <div className="summary-stats__cell" role="listitem">
          <span className="summary-stats__label">
            <span className="dot dot--medium" />
            中重要
          </span>
          <span className="summary-stats__value summary-stats__value--medium">{summary.medium_importance_count}</span>
        </div>
      </div>

      {!details ? (
        loading ? (
          <Skeleton active title={false} paragraph={{ rows: 10 }} />
        ) : (
          <div className="reader__empty" style={{ minHeight: 200 }}>
            <div>摘要内容加载失败</div>
            {onRetry && (
              <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        )
      ) : (
        <>
          {topics.length > 0 && (
            <section className="reader__section">
              <div className="reader__section-head">
                <span className="eyebrow">关键主题</span>
                <span className="eyebrow">{topics.length}</span>
              </div>
              <div className="reader__tags">
                {topics.map((topic, index) => (
                  <span key={`${topic}-${index}`} className="chip">
                    # {topic}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="reader__section">
            <div className="reader__section-head">
              <span className="eyebrow">摘要正文</span>
            </div>
            {details.summary_content ? (
              <Markdown>{details.summary_content}</Markdown>
            ) : (
              <p className="u-muted" style={{ fontSize: 13 }}>
                暂无摘要内容
              </p>
            )}
          </section>
        </>
      )}
    </article>
  );
}
