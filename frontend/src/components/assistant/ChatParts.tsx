/**
 * AI 对话界面共用片段：助手标识、历史列表、思考中提示、参考来源卡片、输入提示。
 * 样式见 `@/styles/pages/assistant.css`。
 */
import { useMemo } from 'react';
import { Tooltip } from 'antd';
import { DeleteOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { ArticleSearchResult } from '@/types';
import '@/styles/pages/assistant.css';

dayjs.extend(relativeTime);

export function AssistantMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={`ai-mark ai-mark--${size}`} aria-hidden>
      <RobotOutlined />
    </span>
  );
}

export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="ai-thinking">
      <span className="ai-thinking__dots"><i /><i /><i /></span>
      {label}
    </div>
  );
}

export function ComposerHint() {
  return (
    <span className="ai-composer__hint">
      <span><span className="kbd">Enter</span> 发送</span>
      <span><span className="kbd">Shift + Enter</span> 换行</span>
    </span>
  );
}

interface HistoryEntry {
  id: string;
  title: string;
  updatedAt: Date;
  messages: unknown[];
}

function groupHistories<T extends HistoryEntry>(histories: T[]) {
  const today = dayjs().startOf('day');
  const yesterday = today.subtract(1, 'day');
  const lastWeek = today.subtract(7, 'day');
  const groups: Array<{ label: string; items: T[] }> = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '近 7 天', items: [] },
    { label: '更早', items: [] },
  ];

  histories.forEach((history) => {
    const updated = dayjs(history.updatedAt);
    if (!updated.isBefore(today)) {
      groups[0].items.push(history);
    } else if (!updated.isBefore(yesterday)) {
      groups[1].items.push(history);
    } else if (!updated.isBefore(lastWeek)) {
      groups[2].items.push(history);
    } else {
      groups[3].items.push(history);
    }
  });

  return groups.filter((group) => group.items.length > 0);
}

interface HistoryListProps<T extends HistoryEntry> {
  histories: T[];
  currentChatId: string | null;
  onSelect: (chatId: string) => void;
  onDelete: (chatId: string, event: React.MouseEvent) => void;
  /** 在元信息中显示消息条数 */
  showCount?: boolean;
  emptyText?: string;
}

export function HistoryList<T extends HistoryEntry>({
  histories,
  currentChatId,
  onSelect,
  onDelete,
  showCount = false,
  emptyText = '暂无对话历史',
}: HistoryListProps<T>) {
  const groups = useMemo(() => groupHistories(histories), [histories]);

  if (histories.length === 0) {
    return <div className="ai-rail__empty">{emptyText}</div>;
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="ai-rail__group">
          <div className="ai-rail__group-label eyebrow">{group.label}</div>
          {group.items.map((history) => {
            const isActive = currentChatId === history.id;
            return (
              <div
                key={history.id}
                role="button"
                tabIndex={0}
                className={`ai-rail__item${isActive ? ' ai-rail__item--active' : ''}`}
                onClick={() => onSelect(history.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(history.id);
                  }
                }}
              >
                <span className="ai-rail__item-body">
                  <span className="ai-rail__item-title">{history.title}</span>
                  <span className="ai-rail__item-meta mono u-tnum">
                    {dayjs(history.updatedAt).fromNow()}
                    {showCount ? ` · ${history.messages.length} 条消息` : ''}
                  </span>
                </span>
                <Tooltip title="删除对话">
                  <button
                    type="button"
                    className="icon-btn ai-rail__item-delete"
                    aria-label="删除对话"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(history.id, event);
                    }}
                  >
                    <DeleteOutlined />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

interface ReferenceCardsProps {
  articles: ArticleSearchResult[];
  flat?: boolean;
}

export function ReferenceCards({ articles, flat = false }: ReferenceCardsProps) {
  return (
    <div className={`ai-refs__grid${flat ? ' ai-refs__grid--flat' : ''}`}>
      {articles.map((article, index) => {
        const hasRelationCount = 'relation_count' in article;
        const hasSimilarity = 'similarity' in article;
        const card = (
          <a
            key={`${article.id}-${index}`}
            className="ai-ref"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="ai-ref__index mono u-tnum">{index + 1}</span>
            <span className="ai-ref__body">
              <span className="ai-ref__title">{article.title_zh || article.title}</span>
              <span className="ai-ref__meta">
                <span className="ai-ref__source">{article.source}</span>
                {hasRelationCount && (
                  <span className="mono u-tnum">{`关系 ${article.relation_count}`}</span>
                )}
                {hasSimilarity && article.similarity ? (
                  <span className="chip chip--accent mono u-tnum">
                    {Math.round(article.similarity * 100)}%
                  </span>
                ) : null}
              </span>
            </span>
          </a>
        );

        return article.title_zh && article.title_zh !== article.title ? (
          <Tooltip key={`${article.id}-${index}`} title={article.title} placement="top">
            {card}
          </Tooltip>
        ) : (
          card
        );
      })}
    </div>
  );
}
