import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  Button,
  Drawer,
  Input,
  InputNumber,
  Popconfirm,
  Popover,
  Space,
  Spin,
  Tooltip,
} from 'antd';
import {
  ApartmentOutlined,
  BulbOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  LineChartOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { token } from '@/utils/theme';
import type {
  IndustryGraphConversation,
  IndustryGraphContentBlock,
  IndustryGraphEvidence,
  IndustryGraphNode,
  IndustryGraphProcessResponse,
  IndustryGraphQueryPlan,
  IndustryGraphStreamChunk,
  IndustryGraphSuggestedQuestion,
  IndustryGraphSubgraph,
  IndustryGraphTrend,
} from '@/types';

import './industryGraph.css';

const { TextArea } = Input;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  blocks: IndustryGraphContentBlock[];
  queryPlan?: IndustryGraphQueryPlan;
  isStreaming?: boolean;
  error?: string;
}

const entityTypeColors: Record<string, string> = {
  Technology: token('chart1'),
  Product: token('chart2'),
  Company: token('chart3'),
  Paper: token('chart5'),
  Concept: token('accentHover'),
  Person: token('chart4'),
  Benchmark: token('info'),
  Feature: token('success'),
  Industry: token('warning'),
  Event: token('danger'),
};

const fallbackEntityColor = token('textTertiary');

function getEntityColor(type: string) {
  return entityTypeColors[type] || fallbackEntityColor;
}

function entityColorStyle(type: string): CSSProperties {
  return { '--ig-type': getEntityColor(type) } as CSSProperties;
}

const entityTypeLabels: Record<string, string> = {
  Technology: '技术',
  Product: '产品',
  Company: '公司',
  Paper: '论文',
  Concept: '概念',
  Person: '人物',
  Benchmark: '评测',
  Feature: '特性',
  Industry: '行业',
  Event: '事件',
};

function shortText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getChunkMessage(chunk: IndustryGraphStreamChunk) {
  const value = chunk.data.message;
  return typeof value === 'string' ? value : '未知错误';
}

function getChunkContent(chunk: IndustryGraphStreamChunk) {
  const value = chunk.data.content;
  return typeof value === 'string' ? value : '';
}

function getDoneConversationId(chunk: IndustryGraphStreamChunk) {
  const value = chunk.data.conversation_id;
  return typeof value === 'number' ? value : null;
}

function getDoneFollowups(chunk: IndustryGraphStreamChunk) {
  const value = chunk.data.followup_questions;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getTextFromBlock(block: IndustryGraphContentBlock) {
  if (block.type !== 'text') {
    return '';
  }
  const value = block.data.text;
  return typeof value === 'string' ? value : '';
}

function conversationToChatMessages(conversation: IndustryGraphConversation): ChatMessage[] {
  return conversation.messages.map((item) => {
    const storedBlocks = item.content_blocks || [];
    const textFromBlock = storedBlocks.map(getTextFromBlock).find(Boolean) || '';
    const text = item.content_text || textFromBlock;
    return {
      id: `conversation-${item.id}`,
      role: item.role === 'user' ? 'user' : 'assistant',
      text: text || '',
      blocks: storedBlocks.filter((block) => block.type !== 'text'),
      queryPlan: item.query_plan || undefined,
    };
  });
}

function getEvidenceBlocks(blocks: IndustryGraphContentBlock[]) {
  return blocks
    .filter((block) => block.type === 'evidence_card')
    .map((block) => block.data as IndustryGraphEvidence);
}

function CardShell({ children }: { children: ReactNode }) {
  return <div className="ig-card">{children}</div>;
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow ig-section-label">{children}</span>;
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="ig-stat">
      <div className="ig-stat__label">{label}</div>
      <div className="ig-stat__value">{value}</div>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  return (
    <span className={`ig-conf${score >= 0.9 ? ' ig-conf--high' : ''}`}>
      {Math.round(score * 100)}%
    </span>
  );
}

function EntityTypeBadge({ type }: { type: string }) {
  return (
    <span className="ig-type" style={entityColorStyle(type)}>
      {entityTypeLabels[type] || type || '实体'}
    </span>
  );
}

function TrendCard({ trend }: { trend: IndustryGraphTrend }) {
  return (
    <CardShell>
      <div className="ig-card__head">
        <div>
          <SectionEyebrow>
            <LineChartOutlined />
            趋势信号
          </SectionEyebrow>
          <div className="ig-card__title">{trend.technology}</div>
        </div>
        <div className="ig-score">
          <span className="eyebrow">趋势分</span>
          <span className="ig-score__value">{trend.trend_score.toFixed(2)}</span>
        </div>
      </div>
      {trend.summary && <div className="ig-card__text">{trend.summary}</div>}
      <div className="ig-stats">
        <StatCell label="证据" value={trend.evidence_count} />
        <StatCell label="文档" value={trend.document_count} />
        <StatCell label="论文" value={trend.paper_count} />
        <StatCell label="产品" value={trend.product_count} />
        <StatCell label="公司" value={trend.company_count} />
      </div>
    </CardShell>
  );
}

function EvidenceCard({
  evidence,
  indexLabel,
}: {
  evidence: IndustryGraphEvidence;
  indexLabel?: string;
}) {
  const title = evidence.title_zh || evidence.title;
  const hasPath = Boolean(evidence.source_entity || evidence.target_entity || evidence.relation_type);
  return (
    <CardShell>
      <div className="ig-card__head">
        <div>
          <SectionEyebrow>
            <FileSearchOutlined />
            {indexLabel || '证据来源'}
          </SectionEyebrow>
          {evidence.url ? (
            <a className="ig-card__title" href={evidence.url} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            <div className="ig-card__title">{title}</div>
          )}
        </div>
        <ConfidenceBadge score={evidence.confidence_score} />
      </div>
      {(evidence.source || evidence.published_at) && (
        <div className="ig-card__meta">
          {evidence.source && <span>{evidence.source}</span>}
          {evidence.published_at && (
            <span className="mono">{dayjs(evidence.published_at).format('YYYY-MM-DD')}</span>
          )}
        </div>
      )}
      {hasPath && (
        <div className="ig-path">
          {evidence.source_entity && <span>{evidence.source_entity}</span>}
          {evidence.relation_type && <span className="ig-path__rel">—{evidence.relation_type}→</span>}
          {evidence.target_entity && <span>{evidence.target_entity}</span>}
        </div>
      )}
      {evidence.evidence_snippet && <div className="ig-quote">{evidence.evidence_snippet}</div>}
    </CardShell>
  );
}

function EvidencePreviewCard({ evidence }: { evidence: IndustryGraphEvidence }) {
  return (
    <div className="ig-preview">
      <div className="ig-preview__title">{evidence.title_zh || evidence.title}</div>
      <div className="ig-preview__meta">
        {evidence.source && <span>{evidence.source}</span>}
        {evidence.published_at && (
          <span className="mono">{dayjs(evidence.published_at).format('YYYY-MM-DD')}</span>
        )}
        <span className="mono">置信 {Math.round(evidence.confidence_score * 100)}%</span>
      </div>
      {evidence.evidence_snippet && <div className="ig-preview__quote">{evidence.evidence_snippet}</div>}
    </div>
  );
}

function AnswerText({
  text,
  evidence,
}: {
  text: string;
  evidence: IndustryGraphEvidence[];
}) {
  const parts = text.split(/(\[证据\d+\])/g);

  if (parts.length === 1) {
    return <div className="ig-answer">{text}</div>;
  }

  return (
    <div className="ig-answer">
      {parts.map((part, index) => {
        if (!part) {
          return null;
        }
        const matched = part.match(/^\[证据(\d+)\]$/);
        if (!matched) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        const evidenceIndex = Number(matched[1]);
        const item = evidence[evidenceIndex - 1];
        if (!item) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        return (
          <Tooltip
            key={`${part}-${index}`}
            title={<EvidencePreviewCard evidence={item} />}
            placement="top"
            mouseEnterDelay={0.15}
            styles={{ root: { maxWidth: 380 } }}
          >
            <span className="ig-cite">{part}</span>
          </Tooltip>
        );
      })}
    </div>
  );
}

function LocalGraph({ subgraph }: { subgraph: IndustryGraphSubgraph }) {
  const rawPatternId = useId();
  const patternId = useMemo(() => `industry-graph-grid-${rawPatternId.replace(/:/g, '')}`, [rawPatternId]);
  const visibleNodes = useMemo(() => subgraph.nodes.slice(0, 18), [subgraph.nodes]);
  const nodeIdSet = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => subgraph.edges.filter((edge) => nodeIdSet.has(edge.source_id) && nodeIdSet.has(edge.target_id)).slice(0, 36),
    [nodeIdSet, subgraph.edges]
  );
  const centerNode = useMemo(
    () => visibleNodes.find((node) => node.entity_type === 'Technology') || visibleNodes[0],
    [visibleNodes]
  );
  const nodePositions = useMemo(() => {
    const centerX = 310;
    const centerY = 172;
    const radiusX = visibleNodes.length <= 8 ? 165 : 205;
    const radiusY = visibleNodes.length <= 8 ? 108 : 132;
    const outerNodes = visibleNodes.filter((node) => node.id !== centerNode?.id);
    const positions = new Map<number, { node: IndustryGraphNode; x: number; y: number; isCenter: boolean }>();
    if (centerNode) {
      positions.set(centerNode.id, { node: centerNode, x: centerX, y: centerY, isCenter: true });
    }
    outerNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(outerNodes.length, 1) - Math.PI / 2;
      positions.set(node.id, {
        node,
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
        isCenter: false,
      });
    });
    return positions;
  }, [centerNode, visibleNodes]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    visibleNodes.forEach((node) => counts.set(node.entity_type, (counts.get(node.entity_type) || 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [visibleNodes]);

  if (visibleNodes.length === 0) {
    return null;
  }

  const showOuterLabels = visibleNodes.length <= 10;

  return (
    <CardShell>
      <div className="ig-card__head">
        <div>
          <SectionEyebrow>
            <ApartmentOutlined />
            图谱解释
          </SectionEyebrow>
          <div className="ig-card__title">局部解释图</div>
        </div>
        <span className="chip mono">
          {subgraph.nodes.length} 节点 / {subgraph.edges.length} 边
        </span>
      </div>
      <div className="ig-graph">
        <div className="ig-graph__canvas">
          <svg
            className="ig-graph__svg"
            viewBox="0 0 620 344"
            role="img"
            aria-label="行业图谱局部解释图"
          >
            <defs>
              <pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse">
                <path className="ig-graph__grid" d="M 28 0 L 0 0 0 28" fill="none" strokeWidth="1" opacity="0.6" />
              </pattern>
            </defs>
            <rect x="0" y="0" width="620" height="344" fill={`url(#${patternId})`} />
            {visibleEdges.map((edge) => {
              const source = nodePositions.get(edge.source_id);
              const target = nodePositions.get(edge.target_id);
              if (!source || !target) {
                return null;
              }
              return (
                <g key={edge.id}>
                  <line
                    className="ig-graph__edge"
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    strokeWidth={Math.max(1, Math.min(3.5, edge.evidence_count + 1))}
                    strokeLinecap="round"
                  />
                  <title>{edge.relation_type}</title>
                </g>
              );
            })}
            {visibleNodes.map((node: IndustryGraphNode, index) => {
              const position = nodePositions.get(node.id);
              if (!position) {
                return null;
              }
              const color = getEntityColor(node.entity_type);
              const radius = position.isCenter ? 22 : 13;
              const labelAbove = !position.isCenter && position.y < 172;
              return (
                <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
                  <g className="ig-graph__node" style={{ animationDelay: `${index * 24}ms` }}>
                    <circle className="ig-graph__halo" r={radius + (position.isCenter ? 12 : 7)} style={{ fill: color }} />
                    <circle r={radius} style={{ fill: color }} />
                    <circle className="ig-graph__ring" r={radius} />
                    {position.isCenter ? (
                      <>
                        <text className="ig-graph__label" y={radius + 24} textAnchor="middle">
                          {shortText(node.label, 18)}
                        </text>
                        <text className="ig-graph__sublabel" y={radius + 39} textAnchor="middle">
                          {entityTypeLabels[node.entity_type] || node.entity_type}
                        </text>
                      </>
                    ) : showOuterLabels ? (
                      <text
                        className="ig-graph__label ig-graph__label--minor"
                        y={labelAbove ? -radius - 8 : radius + 16}
                        textAnchor="middle"
                      >
                        {shortText(node.label, 12)}
                      </text>
                    ) : null}
                  </g>
                  <title>{`${node.label} / ${node.entity_type}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="ig-graph__legend">
          <span className="eyebrow">节点摘要</span>
          <div className="ig-graph__types">
            {typeCounts.map(([type, count]) => (
              <span key={type} className="ig-graph__type" style={entityColorStyle(type)}>
                <span className="ig-swatch" />
                {entityTypeLabels[type] || type}
                <span className="mono">{count}</span>
              </span>
            ))}
          </div>
          <div className="ig-graph__nodes">
            {visibleNodes.slice(0, 8).map((node) => (
              <div key={node.id} className="ig-graph__node-row">
                <span className="ig-graph__node-name" title={node.label}>
                  {node.label}
                </span>
                <EntityTypeBadge type={node.entity_type} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function ReportBlock({
  block,
  onAsk,
  evidenceIndex,
}: {
  block: IndustryGraphContentBlock;
  onAsk: (question: string) => void;
  evidenceIndex?: number;
}) {
  if (block.type === 'text') {
    const text = 'text' in block.data && typeof block.data.text === 'string' ? block.data.text : '';
    return text ? <div className="ig-card__text">{text}</div> : null;
  }

  if (block.type === 'report_section') {
    const title = 'title' in block.data && typeof block.data.title === 'string' ? block.data.title : '';
    const summary = 'summary' in block.data && typeof block.data.summary === 'string' ? block.data.summary : '';
    return (
      <CardShell>
        {title && <div className="ig-card__title">{title}</div>}
        {summary && <div className="ig-card__text">{summary}</div>}
      </CardShell>
    );
  }

  if (block.type === 'trend_card') {
    return <TrendCard trend={block.data as IndustryGraphTrend} />;
  }

  if (block.type === 'evidence_card') {
    return (
      <EvidenceCard
        evidence={block.data as IndustryGraphEvidence}
        indexLabel={evidenceIndex ? `证据${evidenceIndex}` : undefined}
      />
    );
  }

  if (block.type === 'local_graph') {
    return <LocalGraph subgraph={block.data as IndustryGraphSubgraph} />;
  }

  if (block.type === 'followup_questions') {
    const questions = 'questions' in block.data && Array.isArray(block.data.questions)
      ? block.data.questions.filter((item): item is string => typeof item === 'string')
      : [];
    if (!questions.length) {
      return null;
    }
    return (
      <div className="ig-followups">
        {questions.map((question) => (
          <button key={question} type="button" className="ig-followup" onClick={() => onAsk(question)}>
            {question}
          </button>
        ))}
      </div>
    );
  }

  return null;
}

function isReferenceBlock(block: IndustryGraphContentBlock) {
  return block.type === 'report_section'
    || block.type === 'trend_card'
    || block.type === 'evidence_card'
    || block.type === 'local_graph';
}

function isFollowupBlock(block: IndustryGraphContentBlock) {
  return block.type === 'followup_questions';
}

function ReferenceMaterials({
  blocks,
  onAsk,
}: {
  blocks: IndustryGraphContentBlock[];
  onAsk: (question: string) => void;
}) {
  const [openSections, setOpenSections] = useState({
    trends: false,
    evidence: false,
    graph: false,
  });
  const groupedBlocks = useMemo(() => {
    const groups = {
      trends: [] as IndustryGraphContentBlock[],
      evidence: [] as IndustryGraphContentBlock[],
      graph: [] as IndustryGraphContentBlock[],
    };
    let currentGroup: keyof typeof groups = 'trends';

    blocks.forEach((block) => {
      if (block.type === 'report_section') {
        const title = typeof block.data.title === 'string' ? block.data.title : '';
        currentGroup = title.includes('证据') ? 'evidence' : 'trends';
        return;
      }
      if (block.type === 'trend_card') {
        groups.trends.push(block);
        return;
      }
      if (block.type === 'evidence_card') {
        groups.evidence.push(block);
        return;
      }
      if (block.type === 'local_graph') {
        groups.graph.push(block);
        return;
      }
      groups[currentGroup].push(block);
    });

    return groups;
  }, [blocks]);
  const sectionMeta = [
    { key: 'trends' as const, label: '趋势', count: groupedBlocks.trends.length, icon: <LineChartOutlined /> },
    { key: 'evidence' as const, label: '证据', count: groupedBlocks.evidence.length, icon: <FileSearchOutlined /> },
    { key: 'graph' as const, label: '图谱', count: groupedBlocks.graph.length, icon: <NodeIndexOutlined /> },
  ];

  if (!blocks.length) {
    return null;
  }

  return (
    <div className="ig-refs">
      <div className="ig-refs__tabs">
        {sectionMeta.map((section) => {
          const isOpen = openSections[section.key];
          return (
            <button
              key={section.key}
              type="button"
              className="ig-refs__tab"
              aria-label={`${section.label} ${section.count}`}
              aria-pressed={isOpen}
              disabled={section.count === 0}
              onClick={() => setOpenSections((previous) => ({
                ...previous,
                [section.key]: !previous[section.key],
              }))}
            >
              {section.icon}
              <span>{section.label}</span>
              <span className="ig-refs__count">{section.count}</span>
            </button>
          );
        })}
      </div>

      {sectionMeta.some((section) => openSections[section.key]) && (
        <div className="ig-refs__content">
          {openSections.trends && groupedBlocks.trends.map((block, index) => (
            <ReportBlock
              key={`reference-trend-${index}`}
              block={block}
              onAsk={onAsk}
            />
          ))}
          {openSections.evidence && groupedBlocks.evidence.map((block, index) => (
            <ReportBlock
              key={`reference-evidence-${index}`}
              block={block}
              onAsk={onAsk}
              evidenceIndex={index + 1}
            />
          ))}
          {openSections.graph && groupedBlocks.graph.map((block, index) => (
            <ReportBlock
              key={`reference-graph-${index}`}
              block={block}
              onAsk={onAsk}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestedQuestionPrompt({
  items,
  loading,
  isStreaming,
  onAsk,
}: {
  items: IndustryGraphSuggestedQuestion[];
  loading: boolean;
  isStreaming: boolean;
  onAsk: (question: string) => void;
}) {
  return (
    <div className="ig-empty">
      <div className="ig-empty__inner">
        <div className="ig-empty__head">
          <span className="ig-mark ig-empty__mark">
            <BulbOutlined />
          </span>
          <span className="eyebrow">Industry graph · last 3 months</span>
          <div className="ig-empty__title">今日可问</div>
          <div className="ig-empty__desc">基于行业知识图谱追问技术演进、技术融合与论文到产品的路径</div>
        </div>

        {loading ? (
          <div className="ig-empty__loading">
            <Spin />
          </div>
        ) : items.length > 0 ? (
          <div className="ig-suggest">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ig-suggest__item"
                onClick={() => onAsk(item.question)}
                disabled={isStreaming}
              >
                {item.question}
              </button>
            ))}
          </div>
        ) : (
          <div className="ig-empty__none">暂无推荐问题，可以直接输入你的分析问题</div>
        )}
      </div>
    </div>
  );
}

export default function TechnologyEvolutionPage() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const message = useMessage();
  const { isMobile } = useBreakpoint();
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [processBatchSize, setProcessBatchSize] = useState(5);
  const [processResult, setProcessResult] = useState<IndustryGraphProcessResponse | null>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['industry-graph-stats'],
    queryFn: () => apiService.getIndustryGraphStats(),
    staleTime: 30000,
  });

  const { data: suggestedQuestions, isLoading: questionsLoading } = useQuery({
    queryKey: ['industry-graph-suggested-questions'],
    queryFn: () => apiService.getIndustryGraphSuggestedQuestions(6),
    staleTime: 5 * 60 * 1000,
  });

  const PAGE_SIZE = 5;
  const [conversationItems, setConversationItems] = useState<IndustryGraphConversation[]>([]);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const loadConversations = useCallback(async (append: boolean = false) => {
    if (conversationLoading) return;
    setConversationLoading(true);
    try {
      const offset = append ? conversationItems.length : 0;
      const result = await apiService.listIndustryGraphConversations(PAGE_SIZE, offset);
      const newItems = result.items || [];
      if (append) {
        setConversationItems((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          const unique = newItems.filter((c) => !existing.has(c.id));
          return [...prev, ...unique];
        });
      } else {
        setConversationItems(newItems);
      }
      setHasMoreConversations(newItems.length >= PAGE_SIZE);
      setConversationLoaded(true);
    } catch {
      if (!append) setConversationLoaded(true);
    } finally {
      setConversationLoading(false);
    }
  }, [conversationLoading, conversationItems.length]);

  useEffect(() => {
    if (isAuthenticated) {
      loadConversations();
    } else {
      setConversationItems([]);
      setConversationLoaded(false);
      setHasMoreConversations(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      apiService.renameIndustryGraphConversation(id, title),
    onSuccess: (_result, { id, title }) => {
      setConversationItems((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
      setRenamingId(null);
      setRenameValue('');
      message.success('已重命名');
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || '重命名失败';
      message.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteIndustryGraphConversation(id),
    onSuccess: (_result, deletedId) => {
      setConversationItems((prev) => prev.filter((c) => c.id !== deletedId));
      if (conversationId === deletedId) {
        setConversationId(null);
        setMessages([]);
      }
      message.success('已删除');
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : (error as { message?: string })?.message || '删除失败';
      message.error(msg);
    },
  });

  const conversationGroups = useMemo(() => {
    const items = conversationItems;
    if (!items.length) return [];
    const now = dayjs();
    const todayStart = now.startOf('day');
    const weekStart = now.startOf('week');
    const monthStart = now.startOf('month');
    const groups: { label: string; items: typeof items }[] = [];
    const todayItems: typeof items = [];
    const weekItems: typeof items = [];
    const monthItems: typeof items = [];
    const olderItems: typeof items = [];
    for (const item of items) {
      const updatedAt = dayjs(item.updated_at);
      if (updatedAt.isAfter(todayStart)) {
        todayItems.push(item);
      } else if (updatedAt.isAfter(weekStart)) {
        weekItems.push(item);
      } else if (updatedAt.isAfter(monthStart)) {
        monthItems.push(item);
      } else {
        olderItems.push(item);
      }
    }
    if (todayItems.length) groups.push({ label: '今天', items: todayItems });
    if (weekItems.length) groups.push({ label: '本周', items: weekItems });
    if (monthItems.length) groups.push({ label: '本月', items: monthItems });
    if (olderItems.length) groups.push({ label: '更早', items: olderItems });
    return groups;
  }, [conversationItems]);

  const refreshGraphData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['industry-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['industry-graph-suggested-questions'] });
  }, [queryClient]);

  const importMutation = useMutation({
    mutationFn: () => apiService.importArticlesToIndustryGraph(50),
    onSuccess: (result) => {
      refreshGraphData();
      message.success(`导入完成：新增 ${result.imported} 篇，跳过 ${result.skipped} 篇`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '导入失败');
    },
  });

  const processMutation = useMutation({
    mutationFn: (force: boolean) => apiService.processIndustryGraphArticles({
      limit: processBatchSize,
      import_first: true,
      force,
    }),
    onSuccess: (result) => {
      setProcessResult(result);
      refreshGraphData();
      message.success(`解析完成：处理 ${result.processed} 篇，失败 ${result.failed} 篇`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '解析失败');
    },
  });

  useEffect(() => {
    if (!reportBodyRef.current) {
      return;
    }
    reportBodyRef.current.scrollTop = reportBodyRef.current.scrollHeight;
  }, [messages]);

  const updateAssistantMessage = useCallback((messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) =>
      previous.map((message) => (message.id === messageId ? updater(message) : message))
    );
  }, []);

  const handleNewConversation = useCallback(() => {
    if (isStreaming) {
      return;
    }
    setConversationId(null);
    setMessages([]);
    setInputValue('');
  }, [isStreaming]);

  const handleLoadConversation = useCallback(async (nextConversationId: number) => {
    if (isStreaming) {
      return;
    }
    if (!isAuthenticated) {
      message.warning('请先登录后查看历史会话');
      return;
    }
    try {
      const conversation = await apiService.getIndustryGraphConversation(nextConversationId);
      setConversationId(conversation.id);
      setMessages(conversationToChatMessages(conversation));
      setInputValue('');
      if (isMobile) {
        setHistoryDrawerOpen(false);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话失败');
    }
  }, [isAuthenticated, isMobile, isStreaming, message]);

  const handleAsk = useCallback((question: string) => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || isStreaming) {
      return;
    }
    if (!isAuthenticated) {
      message.warning('请先登录后再提问');
      return;
    }

    const timestamp = Date.now();
    const userMessage: ChatMessage = {
      id: `${timestamp}-user`,
      role: 'user',
      text: normalizedQuestion,
      blocks: [],
    };
    const assistantMessageId = `${timestamp}-assistant`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      blocks: [],
      isStreaming: true,
    };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInputValue('');
    setIsStreaming(true);

    apiService.queryIndustryGraphStream(
      {
        question: normalizedQuestion,
        conversation_id: conversationId,
        scenario: 'technology_evolution',
        time_range: { preset: 'last_3_months' },
        top_k: 10,
      },
      (chunk) => {
        if (chunk.type === 'query_plan') {
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            queryPlan: chunk.data as unknown as IndustryGraphQueryPlan,
          }));
          return;
        }

        if (chunk.type === 'text_delta') {
          const content = getChunkContent(chunk);
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            text: `${message.text}${content}`,
          }));
          return;
        }

        if (
          chunk.type === 'report_section'
          || chunk.type === 'trend_card'
          || chunk.type === 'evidence_card'
          || chunk.type === 'local_graph'
          || chunk.type === 'followup_questions'
        ) {
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            blocks: [...message.blocks, { type: chunk.type, data: chunk.data } as IndustryGraphContentBlock],
          }));
          return;
        }

        if (chunk.type === 'done') {
          const nextConversationId = getDoneConversationId(chunk);
          const followups = getDoneFollowups(chunk);
          if (nextConversationId) {
            setConversationId(nextConversationId);
          }
          queryClient.invalidateQueries({ queryKey: ['industry-graph-stats'] });
          loadConversations();
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            isStreaming: false,
            blocks: followups.length
              ? [...message.blocks, { type: 'followup_questions', data: { questions: followups } }]
              : message.blocks,
          }));
          setIsStreaming(false);
          return;
        }

        if (chunk.type === 'error') {
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            isStreaming: false,
            error: getChunkMessage(chunk),
          }));
          setIsStreaming(false);
        }
      }
    ).catch((error) => {
      updateAssistantMessage(assistantMessageId, (message) => ({
        ...message,
        isStreaming: false,
        error: error instanceof Error ? error.message : '未知错误',
      }));
      setIsStreaming(false);
    });
  }, [conversationId, isAuthenticated, isStreaming, message, queryClient, updateAssistantMessage]);

  const submitInput = useCallback(() => {
    handleAsk(inputValue);
  }, [handleAsk, inputValue]);

  const handleKeyPress = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitInput();
    }
  };

  const overviewMetrics: { label: string; value: number; icon?: ReactNode; wide?: boolean }[] = [
    { label: '文档', value: stats?.total_documents ?? 0, icon: <DatabaseOutlined /> },
    { label: '已解析', value: stats?.processed_documents ?? 0 },
    { label: '待解析', value: stats?.pending_documents ?? 0 },
    { label: '失败', value: stats?.failed_documents ?? 0 },
    { label: '实体', value: stats?.total_entities ?? 0, icon: <NodeIndexOutlined /> },
    { label: '关系', value: stats?.total_relations ?? 0, icon: <ApartmentOutlined /> },
    { label: '证据', value: stats?.total_evidence ?? 0, icon: <FileSearchOutlined />, wide: true },
  ];

  const statsOverview = (
    <div className="ig-overview">
      <div className="ig-overview__head">
        <span className="ig-mark">
          <LineChartOutlined />
        </span>
        <div>
          <div className="ig-overview__title">技术演进分析</div>
          <div className="eyebrow">最近 3 个月</div>
        </div>
      </div>
      {statsLoading ? (
        <Spin size="small" />
      ) : (
        <div className="ig-overview__grid">
          {overviewMetrics.map((item) => (
            <div key={item.label} className={`metric${item.wide ? ' metric--wide' : ''}`}>
              <span className="metric__label">
                {item.icon}
                {item.label}
              </span>
              <span className="metric__value">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const dataPreparationPanel = (
    <div className="ig-prep">
      <div className="ig-prep__desc">
        先少量解析文章，确认实体和关系质量后再扩大批量。
      </div>
      <Space.Compact style={{ width: '100%' }}>
        <InputNumber
          aria-label="解析批量"
          min={1}
          max={50}
          value={processBatchSize}
          onChange={(value) => setProcessBatchSize(value || 1)}
          disabled={processMutation.isPending}
          style={{ width: 88 }}
        />
        <Button
          type="primary"
          onClick={() => processMutation.mutate(false)}
          loading={processMutation.isPending}
          disabled={importMutation.isPending}
          style={{ flex: 1 }}
        >
          解析下一批
        </Button>
      </Space.Compact>
      <div className="ig-prep__row">
        <Button
          onClick={() => importMutation.mutate()}
          loading={importMutation.isPending}
          disabled={processMutation.isPending}
        >
          导入最近 50 篇
        </Button>
        <Button
          danger
          onClick={() => processMutation.mutate(true)}
          loading={processMutation.isPending}
          disabled={importMutation.isPending}
        >
          重析
        </Button>
      </div>
      {processResult && (
        <Alert
          type={processResult.failed > 0 ? 'warning' : 'success'}
          showIcon
          message={`本次处理 ${processResult.processed} 篇，新增实体 ${processResult.entities_upserted}，新增关系 ${processResult.relations_upserted}`}
          description={
            processResult.processed_documents.length > 0
              ? processResult.processed_documents
                  .slice(0, 3)
                  .map((item) => `${item.title_zh || item.title}：${item.entities} 实体 / ${item.relations} 关系`)
                  .join('；')
              : processResult.errors[0]?.error || '没有新的待解析文章'
          }
        />
      )}
    </div>
  );

  const historyPanel = (
    <div className={isMobile ? 'ig-history ig-history--sheet' : 'panel ig-history'}>
      <div className="ig-history__head">
        <span className="ig-history__title">
          <HistoryOutlined />
          历史会话
        </span>
        <div className="ig-history__actions">
          <Popover
            content={statsOverview}
            trigger={isMobile ? 'click' : 'hover'}
            placement={isMobile ? 'bottom' : 'rightTop'}
          >
            <Button aria-label="技术演进概览" type="text" size="small" icon={<LineChartOutlined />} />
          </Popover>
          {isAuthenticated && (
            <Popover
              title="数据准备"
              content={dataPreparationPanel}
              trigger="click"
              placement={isMobile ? 'bottom' : 'rightTop'}
            >
              <Button aria-label="数据准备设置" type="text" size="small" icon={<SettingOutlined />} />
            </Popover>
          )}
          <span className="ig-history__divider" aria-hidden />
          <Tooltip title="新建会话">
            <Button
              aria-label="新建会话"
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewConversation}
              disabled={isStreaming || (!conversationId && messages.length === 0)}
              size="small"
            />
          </Tooltip>
        </div>
      </div>
      <div className="ig-history__body">
        {!isAuthenticated ? (
          <div className="ig-history__empty">登录后显示历史会话</div>
        ) : conversationLoading && !conversationLoaded ? (
          <div className="ig-history__empty">
            <Spin size="small" />
          </div>
        ) : conversationGroups.length > 0 ? (
          <>
            {conversationGroups.map((group) => (
              <div key={group.label} className="ig-history__group">
                <div className="eyebrow ig-history__group-label">{group.label}</div>
                <div className="ig-history__list">
                  {group.items.map((conversation) => {
                    const active = conversation.id === conversationId;
                    const isRenaming = renamingId === conversation.id;
                    return (
                      <div key={conversation.id} className={`ig-conv${active ? ' ig-conv--active' : ''}`}>
                        {isRenaming ? (
                          <div className="ig-conv__rename">
                            <Input
                              size="small"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onPressEnter={() => {
                                if (renameValue.trim()) {
                                  renameMutation.mutate({ id: conversation.id, title: renameValue.trim() });
                                }
                              }}
                              style={{ flex: 1, fontSize: 13 }}
                              autoFocus
                            />
                            <Button
                              size="small"
                              type="primary"
                              disabled={!renameValue.trim()}
                              loading={renameMutation.isPending}
                              onClick={() => {
                                if (renameValue.trim()) {
                                  renameMutation.mutate({ id: conversation.id, title: renameValue.trim() });
                                }
                              }}
                            >
                              确定
                            </Button>
                            <Button
                              size="small"
                              onClick={() => { setRenamingId(null); setRenameValue(''); }}
                            >
                              取消
                            </Button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ig-conv__main"
                              onClick={() => handleLoadConversation(conversation.id)}
                              disabled={isStreaming}
                              aria-current={active ? 'true' : undefined}
                            >
                              <div className="ig-conv__title">{shortText(conversation.title, 32)}</div>
                              <div className="ig-conv__meta">
                                {dayjs(conversation.updated_at).format('MM-DD HH:mm')}
                                {conversation.messages.length > 0 ? ` · ${conversation.messages.length} 条` : ''}
                              </div>
                            </button>
                            <div className="ig-conv__actions">
                              <Tooltip title="重命名">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingId(conversation.id);
                                    setRenameValue(conversation.title);
                                  }}
                                />
                              </Tooltip>
                              <Popconfirm
                                title="确定删除该会话？"
                                description="删除后不可恢复"
                                onConfirm={() => deleteMutation.mutate(conversation.id)}
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                              >
                                <Tooltip title="删除">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={(e) => e.stopPropagation()}
                                    loading={deleteMutation.isPending && deleteMutation.variables === conversation.id}
                                  />
                                </Tooltip>
                              </Popconfirm>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {hasMoreConversations && (
              <div className="ig-history__more">
                <Button
                  type="link"
                  size="small"
                  loading={conversationLoading}
                  onClick={() => loadConversations(true)}
                >
                  显示更多会话
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="ig-history__empty">暂无历史会话</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className={isMobile ? 'ig-shell ig-shell--mobile' : 'ig-shell'}>
        {!isMobile && <aside className="ig-aside">{historyPanel}</aside>}

        <main className="panel ig-chat">
          {isMobile ? (
            <div className="ig-mtoolbar">
              <Button icon={<HistoryOutlined />} onClick={() => setHistoryDrawerOpen(true)}>
                历史会话
              </Button>
              {conversationId ? (
                <span className="chip chip--accent mono">会话 #{conversationId}</span>
              ) : (
                <span className="chip mono">
                  <ClockCircleOutlined />
                  last_3_months
                </span>
              )}
            </div>
          ) : (
            <div className="ig-chat__head">
              <div className="ig-chat__brand">
                <span className="ig-mark">
                  <ApartmentOutlined />
                </span>
                <div>
                  <div className="ig-chat__title">行业趋势图谱报告</div>
                  <div className="ig-chat__desc">流式输出文本、趋势卡片、证据和局部图</div>
                </div>
              </div>
              <div className="ig-chat__meta">
                {isStreaming && <span className="dot dot--live" aria-hidden />}
                <span className="chip chip--outline">
                  <ClockCircleOutlined />
                  last_3_months
                </span>
                {conversationId && <span className="chip chip--accent">会话 {conversationId}</span>}
              </div>
            </div>
          )}

          <div ref={reportBodyRef} className="ig-chat__body">
            {messages.length === 0 ? (
              <SuggestedQuestionPrompt
                items={suggestedQuestions?.items || []}
                loading={questionsLoading}
                isStreaming={isStreaming}
                onAsk={handleAsk}
              />
            ) : (
              <div className="ig-thread">
                {messages.map((message) => {
                  const isUser = message.role === 'user';
                  if (isUser) {
                    return (
                      <div key={message.id} className="ig-msg ig-msg--user">
                        <div className="ig-bubble">{message.text}</div>
                      </div>
                    );
                  }
                  const referenceBlocks = message.blocks.filter(isReferenceBlock);
                  const followupBlocks = message.blocks.filter(isFollowupBlock);
                  const inlineBlocks = message.blocks.filter((block) => !isReferenceBlock(block) && !isFollowupBlock(block));
                  const evidenceBlocks = getEvidenceBlocks(referenceBlocks);
                  return (
                    <div key={message.id} className="ig-msg">
                      <span className="ig-mark ig-msg__avatar" aria-hidden>
                        <ApartmentOutlined />
                      </span>
                      <div className="ig-msg__body">
                        {message.queryPlan && (
                          <div className="ig-plan">
                            <span className="chip chip--accent">{message.queryPlan.primary_scenario}</span>
                            {message.queryPlan.analysis_tasks.map((task) => (
                              <span key={task} className="chip chip--outline">
                                {task}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="ig-blocks">
                          {inlineBlocks.map((block, index) => (
                            <ReportBlock
                              key={`${message.id}-${block.type}-${index}`}
                              block={block}
                              onAsk={handleAsk}
                            />
                          ))}
                          <ReferenceMaterials blocks={referenceBlocks} onAsk={handleAsk} />
                          {message.isStreaming && referenceBlocks.length > 0 && !message.text && (
                            <div className="ig-status">正在基于参考资料生成分析...</div>
                          )}
                          {message.text && <AnswerText text={message.text} evidence={evidenceBlocks} />}
                          {followupBlocks.map((block, index) => (
                            <ReportBlock
                              key={`${message.id}-${block.type}-followup-${index}`}
                              block={block}
                              onAsk={handleAsk}
                            />
                          ))}
                        </div>
                        {message.isStreaming && (
                          <div className="ig-status">
                            <span className="dot dot--live" aria-hidden />
                            生成中...
                          </div>
                        )}
                        {message.error && <Alert type="error" showIcon message={message.error} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ig-composer">
            <div className="ig-composer__box">
              <TextArea
                className="ig-composer__input"
                variant="borderless"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onPressEnter={handleKeyPress}
                placeholder="追问技术演进、技术融合、论文到产品路径..."
                autoSize={{ minRows: 1, maxRows: 5 }}
                disabled={!isAuthenticated || isStreaming}
              />
              <Tooltip title="发送">
                <Button
                  className="ig-composer__send"
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={submitInput}
                  loading={isStreaming}
                  disabled={!isAuthenticated || !inputValue.trim() || isStreaming}
                />
              </Tooltip>
            </div>
            <div className="ig-composer__hint">
              <span className="kbd">Enter</span>
              发送
              <span className="kbd">Shift</span>
              <span className="kbd">Enter</span>
              换行
            </div>
          </div>
        </main>
      </div>

      {isMobile && (
        <Drawer
          title="历史会话"
          placement="bottom"
          height="78vh"
          className="m-sheet"
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
        >
          {historyPanel}
        </Drawer>
      )}
    </>
  );
}
