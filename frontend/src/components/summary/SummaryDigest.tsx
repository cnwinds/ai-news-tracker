/**
 * 结构化简报：封面图 → 数据条 → 导语 → 趋势卡片 → 重点文章 → 展望
 * 应用内与分享页共用
 */
import { Fragment, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import {
  AimOutlined,
  BgColorsOutlined,
  BulbOutlined,
  EyeOutlined,
  ReloadOutlined,
  RightOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import type { SummaryIllustrations } from '@/types';
import { Markdown } from '@/utils/markdown';
import SvgArt, { PatternArt } from './SvgArt';
import {
  isStructured,
  parseRefIds,
  parseSummary,
  sourceBreakdown,
  type DigestArticle,
  type DigestPartKind,
  type DigestTrend,
} from './parse';

export interface DigestArtControl {
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
}

interface SummaryDigestProps {
  content: string;
  stats: { total: number; high: number; medium: number };
  illustrations?: SummaryIllustrations | null;
  art?: DigestArtControl;
  /** 不传时文章链接跳转到公开分享页 */
  onOpenArticle?: (id: number) => void;
}

const PART_ICON: Record<DigestPartKind, ReactNode> = {
  what: <EyeOutlined />,
  why: <BulbOutlined />,
  impact: <AimOutlined />,
  other: <RightOutlined />,
};

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;

function sourceTone(source: string | null): number {
  if (!source) return 0;
  let h = 0;
  for (let i = 0; i < source.length; i += 1) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  return (h % 5) + 1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ArticleLink({
  id,
  className,
  onOpenArticle,
  children,
}: {
  id: number;
  className: string;
  onOpenArticle?: (id: number) => void;
  children: ReactNode;
}) {
  // 始终渲染为 <a>：button 是 inline-block，长链接会在段落里独占一行并居中
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenArticle || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpenArticle(id);
  };
  return (
    <a className={className} href={`/share/${id}`} target="_blank" rel="noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

function Inline({ text, onOpenArticle }: { text: string; onOpenArticle?: (id: number) => void }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const key = `${index}`;
    if (m[1] !== undefined) {
      nodes.push(<mark key={key} className="sd-hl">{m[1]}</mark>);
    } else if (m[2] !== undefined) {
      const label = m[2].replace(/\*\*/g, '');
      const ids = parseRefIds(m[3]);
      if (ids.length) {
        nodes.push(
          <ArticleLink key={key} id={ids[0]} className="sd-ref" onOpenArticle={onOpenArticle}>
            {label}
          </ArticleLink>
        );
      } else if (/^https?:\/\//.test(m[3])) {
        nodes.push(
          <a key={key} className="sd-ref" href={m[3]} target="_blank" rel="noreferrer">
            {label}
          </a>
        );
      } else {
        nodes.push(label);
      }
    } else if (m[4] !== undefined) {
      nodes.push(<code key={key}>{m[4]}</code>);
    }
    last = index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

function SectionHead({ label, count }: { label: string; count?: number }) {
  return (
    <div className="sd-head">
      <span className="eyebrow">{label}</span>
      {count !== undefined && <span className="sd-head__count">{count}</span>}
      <span className="sd-head__rule" />
    </div>
  );
}

function Metrics({
  stats,
  articles,
}: {
  stats: SummaryDigestProps['stats'];
  articles: DigestArticle[];
}) {
  const other = Math.max(stats.total - stats.high - stats.medium, 0);
  const sources = sourceBreakdown(articles).slice(0, 4);
  const maxSource = sources[0]?.count ?? 1;
  const segments = [
    { key: 'high', label: '高', value: stats.high },
    { key: 'medium', label: '中', value: stats.medium },
    { key: 'low', label: '其他', value: other },
  ].filter((s) => s.value > 0);

  return (
    <div className="sd-metrics">
      <div className="sd-metric">
        <span className="eyebrow">收录</span>
        <span className="sd-metric__value">{stats.total}</span>
        <span className="sd-metric__unit">篇文章</span>
      </div>
      <div className="sd-metric sd-metric--grow">
        <span className="eyebrow">重要度分布</span>
        <div className="sd-bar" role="img" aria-label={`高 ${stats.high}，中 ${stats.medium}，其他 ${other}`}>
          {segments.map((s) => (
            <span key={s.key} className={`sd-bar__seg sd-bar__seg--${s.key}`} style={{ flexGrow: s.value }} />
          ))}
        </div>
        <div className="sd-legend">
          {segments.map((s) => (
            <span key={s.key} className="sd-legend__item">
              <span className={`dot dot--${s.key}`} />
              {s.label}
              <span className="mono">{s.value}</span>
            </span>
          ))}
        </div>
      </div>
      {sources.length > 1 && (
        <div className="sd-metric sd-metric--grow">
          <span className="eyebrow">重点来源</span>
          <div className="sd-sources">
            {sources.map((s) => (
              <div key={s.source} className="sd-sources__row">
                <span className="sd-sources__name">{s.source}</span>
                <span className="sd-sources__track">
                  <span
                    className={`sd-sources__fill sd-tone--${sourceTone(s.source)}`}
                    style={{ width: `${(s.count / maxSource) * 100}%` }}
                  />
                </span>
                <span className="sd-sources__count mono">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendCard({
  trend,
  index,
  svg,
  onOpenArticle,
}: {
  trend: DigestTrend;
  index: number;
  svg?: string | null;
  onOpenArticle?: (id: number) => void;
}) {
  const refs = trend.refs.slice(0, 6);
  return (
    <article className="sd-trend">
      <div className="sd-trend__art">
        {svg ? <SvgArt svg={svg} label={`${trend.title} 示意图`} /> : <PatternArt seed={trend.title} />}
      </div>
      <div className="sd-trend__body">
        <span className="sd-trend__index">趋势 {pad(index + 1)}</span>
        <h3 className="sd-trend__title">{trend.title}</h3>
        {trend.text && (
          <p className="sd-trend__text">
            <Inline text={trend.text} onOpenArticle={onOpenArticle} />
          </p>
        )}
        {trend.parts.length > 0 && (
          <dl className="sd-parts">
            {trend.parts.map((part, i) => (
              <div key={`${part.label}-${i}`} className={`sd-part sd-part--${part.kind}`}>
                <dt>
                  {PART_ICON[part.kind]}
                  <span>{part.label}</span>
                </dt>
                <dd>
                  <Inline text={part.text} onOpenArticle={onOpenArticle} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {refs.length > 0 && (
          <div className="sd-refs">
            <span className="sd-refs__label">关联报道</span>
            {refs.map((ref) => (
              <ArticleLink
                key={`${ref.label}-${ref.ids[0]}`}
                id={ref.ids[0]}
                className="sd-refs__chip"
                onOpenArticle={onOpenArticle}
              >
                {ref.label}
              </ArticleLink>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ArticleCard({
  article,
  index,
  lead,
  onOpenArticle,
}: {
  article: DigestArticle;
  index: number;
  lead: boolean;
  onOpenArticle?: (id: number) => void;
}) {
  const tone = sourceTone(article.source);
  const body = (
    <>
      {lead ? (
        <span className="sd-article__source">
          <span className={`sd-article__badge sd-tone--${tone}`}>{(article.source || '?').slice(0, 1)}</span>
          {article.source || '未知来源'}
        </span>
      ) : (
        <span className="sd-article__num mono">{pad(index + 1)}</span>
      )}
      <span className="sd-article__main">
        <span className="sd-article__title">{article.title}</span>
        {article.text && <span className="sd-article__text">{article.text}</span>}
      </span>
      {!lead && article.source && <span className="sd-article__tag">{article.source}</span>}
    </>
  );
  const className = `sd-article${lead ? ' sd-article--lead' : ''}`;
  if (article.id === null) return <div className={className}>{body}</div>;
  return (
    <ArticleLink id={article.id} className={className} onOpenArticle={onOpenArticle}>
      {body}
    </ArticleLink>
  );
}

export default function SummaryDigest({ content, stats, illustrations, art, onOpenArticle }: SummaryDigestProps) {
  const digest = useMemo(() => parseSummary(content), [content]);
  const structured = isStructured(digest);
  const cover = illustrations?.cover;
  const trendArt = illustrations?.trends ?? [];
  const leads = digest.articles.slice(0, 3);
  const rest = digest.articles.slice(3);

  const coverBlock = cover ? (
    <figure className="sd-cover">
      <SvgArt svg={cover} label="本期封面信息图" />
      {art?.canGenerate && (
        <Tooltip title="重新绘制配图">
          <button
            type="button"
            className="icon-btn sd-cover__redo"
            onClick={art.onGenerate}
            disabled={art.generating}
            aria-label="重新绘制配图"
          >
            <ReloadOutlined spin={art.generating} />
          </button>
        </Tooltip>
      )}
    </figure>
  ) : art?.canGenerate ? (
    <figure className="sd-cover sd-cover--empty">
      <PatternArt seed={digest.title || content.slice(0, 40)} variant="cover" />
      <figcaption className="sd-cover__cta">
        <Button type="primary" icon={<BgColorsOutlined />} loading={art.generating} onClick={art.onGenerate}>
          {art.generating ? '正在绘制配图…' : 'AI 绘制配图'}
        </Button>
        <span>为封面和每个趋势生成信息图，约需数分钟，可先阅读正文</span>
      </figcaption>
    </figure>
  ) : null;

  return (
    <div className="sd">
      {coverBlock}

      <Metrics stats={stats} articles={digest.articles} />

      {digest.lede.map((text, i) => (
        <p key={i} className="sd-lede">
          <Inline text={text} onOpenArticle={onOpenArticle} />
        </p>
      ))}

      {digest.trends.length > 0 && (
        <section className="sd-section">
          <SectionHead label="趋势洞察" count={digest.trends.length} />
          <div className="sd-trends">
            {digest.trends.map((trend, i) => (
              <TrendCard
                key={`${trend.title}-${i}`}
                trend={trend}
                index={i}
                svg={trendArt[i]?.svg}
                onOpenArticle={onOpenArticle}
              />
            ))}
          </div>
        </section>
      )}

      {digest.articles.length > 0 && (
        <section className="sd-section">
          <SectionHead label="重点文章" count={digest.articles.length} />
          <div className="sd-leads">
            {leads.map((article, i) => (
              <ArticleCard key={`${article.id}-${i}`} article={article} index={i} lead onOpenArticle={onOpenArticle} />
            ))}
          </div>
          {rest.length > 0 && (
            <div className="sd-list">
              {rest.map((article, i) => (
                <ArticleCard
                  key={`${article.id}-${i}`}
                  article={article}
                  index={i + leads.length}
                  lead={false}
                  onOpenArticle={onOpenArticle}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {digest.outlook.length > 0 && (
        <aside className="sd-outlook">
          <span className="sd-outlook__icon">
            <RocketOutlined />
          </span>
          <div>
            <span className="eyebrow">未来展望</span>
            {digest.outlook.map((text, i) => (
              <p key={i}>
                <Inline text={text} onOpenArticle={onOpenArticle} />
              </p>
            ))}
          </div>
        </aside>
      )}

      {digest.extras.map((block, i) => (
        <Fragment key={`${block.title}-${i}`}>
          <section className="sd-section">
            {block.title && <SectionHead label={block.title} />}
            <Markdown compact>{block.markdown}</Markdown>
          </section>
        </Fragment>
      ))}

      {structured && (
        <details className="sd-raw">
          <summary>查看原始报告</summary>
          <Markdown compact>{content}</Markdown>
        </details>
      )}
    </div>
  );
}
