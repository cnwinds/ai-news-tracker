/**
 * 内容总结阅读器：PC 分栏右侧、手机全屏页共用
 */
import { useMemo, useState } from 'react';
import { Button, Popconfirm, Skeleton, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { DailySummaryListItem, SummaryFieldsResponse } from '@/types';
import ArticleDetailModal from '@/components/ArticleDetailModal';
import SummaryDigest from './SummaryDigest';
import { digestHeadline, parseSummary } from './parse';
import { summaryFullRange, summaryWeekTag, TYPE_LABEL } from './format';

interface SummaryReaderProps {
  summary: DailySummaryListItem;
  details?: SummaryFieldsResponse;
  loading: boolean;
  canEdit: boolean;
  regenerating: boolean;
  deleting: boolean;
  generatingArt: boolean;
  onShare: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onGenerateArt: () => void;
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
  generatingArt,
  onShare,
  onRegenerate,
  onDelete,
  onGenerateArt,
  onRetry,
  onBack,
}: SummaryReaderProps) {
  const [articleId, setArticleId] = useState<number | null>(null);
  const weekTag = summaryWeekTag(summary);
  const content = details?.summary_content ?? '';
  const headline = useMemo(
    () => summary.headline || (content ? digestHeadline(parseSummary(content)) : null),
    [summary.headline, content]
  );

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
              description="将基于最新文章覆盖当前内容，并重新绘制配图。"
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

      <header className="summary-reader__header">
        <div className="summary-reader__eyebrow">
          <span className="mono">{summaryFullRange(summary)}</span>
          <span aria-hidden>·</span>
          <span>{summary.summary_type === 'weekly' ? '每周情报' : '每日情报'}</span>
          {regenerating && (
            <span className="u-accent">
              <span className="dot dot--live" /> 正在重新生成…
            </span>
          )}
        </div>
        <h1 className="reader__title summary-reader__title">{headline || summaryFullRange(summary)}</h1>
        <div className="reader__meta">
          <span className="reader__meta-item">
            生成于 <span className="mono">{dayjs(summary.updated_at || summary.created_at).format('MM-DD HH:mm')}</span>
          </span>
          {details?.illustrations?.model && (
            <span className="reader__meta-item">
              配图 <span className="mono">{details.illustrations.model}</span>
            </span>
          )}
        </div>
      </header>

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
      ) : content ? (
        <SummaryDigest
          content={content}
          stats={{
            total: summary.total_articles,
            high: summary.high_importance_count,
            medium: summary.medium_importance_count,
          }}
          illustrations={details.illustrations}
          art={{ canGenerate: canEdit, generating: generatingArt, onGenerate: onGenerateArt }}
          onOpenArticle={setArticleId}
        />
      ) : (
        <p className="u-muted" style={{ fontSize: 13 }}>
          暂无摘要内容
        </p>
      )}

      <ArticleDetailModal articleId={articleId} open={articleId !== null} onClose={() => setArticleId(null)} />
    </article>
  );
}
