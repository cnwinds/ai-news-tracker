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
  Avatar,
  Button,
  Input,
  InputNumber,
  Popconfirm,
  Popover,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
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
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import { useMessage } from '@/hooks/useMessage';
import { getThemeColor } from '@/utils/theme';
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

const { Text } = Typography;
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
  Technology: '#1677ff',
  Product: '#52c41a',
  Company: '#fa8c16',
  Paper: '#722ed1',
  Concept: '#13c2c2',
  Person: '#eb2f96',
  Benchmark: '#2f54eb',
  Feature: '#a0d911',
  Industry: '#faad14',
  Event: '#f5222d',
};

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

function getCardPalette(theme: ThemeMode) {
  if (theme === 'dark') {
    return {
      surface: '#202327',
      surfaceSoft: '#242932',
      surfaceMuted: '#1b1d21',
      border: '#3a414b',
      borderSoft: '#2f353d',
      text: '#f5f7fa',
      textSecondary: '#c7d0dc',
      textMuted: '#95a1b2',
      link: '#79b7ff',
      graphBg: '#171a1f',
      graphGrid: '#252b33',
      metricBg: '#182b44',
      metricText: '#d7e8ff',
      quoteBg: '#181b20',
      shadow: '0 14px 34px rgba(0, 0, 0, 0.28)',
    };
  }
  return {
    surface: '#ffffff',
    surfaceSoft: '#f7f9fc',
    surfaceMuted: '#f2f5f9',
    border: '#d9e2ee',
    borderSoft: '#e7edf5',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    link: '#0958d9',
    graphBg: '#f8fafc',
    graphGrid: '#e8eef7',
    metricBg: '#edf5ff',
    metricText: '#123c69',
    quoteBg: '#f7f9fc',
    shadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
  };
}

const industryPageStyles: Record<string, CSSProperties> = {
  shell: {
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: 16,
    minHeight: 'calc(100vh - 168px)',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  },
  report: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 620,
    overflow: 'hidden',
  },
  reportBody: {
    flex: 1,
    overflowY: 'auto',
    padding: 20,
  },
  composer: {
    padding: 16,
    borderTop: '1px solid transparent',
  },
  messageRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 18,
  },
  userRow: {
    flexDirection: 'row-reverse',
  },
  messageBody: {
    maxWidth: '880px',
    minWidth: 0,
    flex: 1,
  },
  blockStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
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

function CardShell({
  children,
  theme,
  tone = 'default',
}: {
  children: ReactNode;
  theme: ThemeMode;
  tone?: 'default' | 'trend' | 'evidence' | 'graph';
}) {
  const palette = getCardPalette(theme);
  const toneBackground = {
    default: palette.surface,
    trend: theme === 'dark' ? '#1f2730' : '#ffffff',
    evidence: theme === 'dark' ? '#20242a' : '#ffffff',
    graph: palette.surface,
  }[tone];

  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: 16,
        background: toneBackground,
        boxShadow: palette.shadow,
        color: palette.text,
      }}
    >
      {children}
    </div>
  );
}

function SectionEyebrow({ children, theme }: { children: ReactNode; theme: ThemeMode }) {
  const palette = getCardPalette(theme);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: palette.textMuted,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0,
      }}
    >
      {children}
    </span>
  );
}

function MetricPill({
  label,
  value,
  theme,
}: {
  label: string;
  value: number | string;
  theme: ThemeMode;
}) {
  const palette = getCardPalette(theme);
  return (
    <div
      style={{
        minWidth: 96,
        padding: '9px 11px',
        borderRadius: 6,
        background: palette.metricBg,
        border: `1px solid ${palette.borderSoft}`,
      }}
    >
      <div style={{ color: palette.textMuted, fontSize: 12 }}>
        {label}
      </div>
      <div style={{ color: palette.metricText, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ConfidenceBadge({
  score,
  theme,
}: {
  score: number;
  theme: ThemeMode;
}) {
  const palette = getCardPalette(theme);
  const isHigh = score >= 0.9;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        padding: '0 8px',
        borderRadius: 6,
        background: isHigh
          ? (theme === 'dark' ? 'rgba(82, 196, 26, 0.18)' : '#f0f9eb')
          : palette.surfaceMuted,
        color: isHigh
          ? (theme === 'dark' ? '#95de64' : '#237804')
          : palette.textSecondary,
        border: `1px solid ${isHigh ? 'rgba(82, 196, 26, 0.35)' : palette.borderSoft}`,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {Math.round(score * 100)}%
    </span>
  );
}

function EntityTypeBadge({ type, theme }: { type: string; theme: ThemeMode }) {
  const color = entityTypeColors[type] || '#64748b';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 7px',
        borderRadius: 6,
        background: theme === 'dark' ? `${color}26` : `${color}14`,
        color: theme === 'dark' ? '#f5f7fa' : color,
        border: `1px solid ${theme === 'dark' ? `${color}55` : `${color}33`}`,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {entityTypeLabels[type] || type || '实体'}
    </span>
  );
}

function TrendCard({ trend, theme }: { trend: IndustryGraphTrend; theme: ThemeMode }) {
  const palette = getCardPalette(theme);
  return (
    <CardShell theme={theme} tone="trend">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space align="start" style={{ justifyContent: 'space-between', width: '100%', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <SectionEyebrow theme={theme}>
              <LineChartOutlined />
              趋势信号
            </SectionEyebrow>
            <div style={{ color: palette.text, fontSize: 17, fontWeight: 700, marginTop: 4 }}>
              {trend.technology}
            </div>
            {trend.summary && (
              <div style={{ color: palette.textSecondary, lineHeight: 1.6, marginTop: 6 }}>
                {trend.summary}
              </div>
            )}
          </div>
          <div
            style={{
              flexShrink: 0,
              minWidth: 78,
              padding: '7px 10px',
              borderRadius: 8,
              background: theme === 'dark' ? '#0f355f' : '#e6f4ff',
              border: `1px solid ${theme === 'dark' ? '#1d5f9f' : '#bae0ff'}`,
              color: theme === 'dark' ? '#d6ebff' : '#0958d9',
              textAlign: 'center',
              fontWeight: 800,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600 }}>趋势分</div>
            <div>{trend.trend_score.toFixed(2)}</div>
          </div>
        </Space>
        <Space size={[8, 8]} wrap>
          <MetricPill theme={theme} label="证据" value={trend.evidence_count} />
          <MetricPill theme={theme} label="文档" value={trend.document_count} />
          <MetricPill theme={theme} label="论文" value={trend.paper_count} />
          <MetricPill theme={theme} label="产品" value={trend.product_count} />
          <MetricPill theme={theme} label="公司" value={trend.company_count} />
        </Space>
      </Space>
    </CardShell>
  );
}

function EvidenceCard({
  evidence,
  theme,
  indexLabel,
}: {
  evidence: IndustryGraphEvidence;
  theme: ThemeMode;
  indexLabel?: string;
}) {
  const palette = getCardPalette(theme);
  return (
    <CardShell theme={theme} tone="evidence">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="start" style={{ justifyContent: 'space-between', width: '100%', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <SectionEyebrow theme={theme}>
              <FileSearchOutlined />
              {indexLabel || '证据来源'}
            </SectionEyebrow>
          </div>
          <ConfidenceBadge score={evidence.confidence_score} theme={theme} />
        </Space>
        <div style={{ minWidth: 0 }}>
          {evidence.url ? (
            <a
              href={evidence.url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: palette.link,
                fontWeight: 700,
                lineHeight: 1.5,
                textDecoration: 'none',
              }}
            >
              {evidence.title_zh || evidence.title}
            </a>
          ) : (
            <div style={{ color: palette.text, fontWeight: 700, lineHeight: 1.5 }}>
              {evidence.title_zh || evidence.title}
            </div>
          )}
        </div>
        <Space size={8} wrap>
          {evidence.source && (
            <span style={{ color: palette.textMuted, fontSize: 13 }}>{evidence.source}</span>
          )}
          {evidence.published_at && (
            <span style={{ color: palette.textMuted, fontSize: 13 }}>
              {dayjs(evidence.published_at).format('YYYY-MM-DD')}
            </span>
          )}
        </Space>
        {(evidence.source_entity || evidence.target_entity || evidence.relation_type) && (
          <div style={{ color: palette.textMuted, fontSize: 13 }}>
            {[evidence.source_entity, evidence.relation_type, evidence.target_entity].filter(Boolean).join('  →  ')}
          </div>
        )}
        {evidence.evidence_snippet && (
          <div
            style={{
              color: palette.textSecondary,
              background: palette.quoteBg,
              border: `1px solid ${palette.borderSoft}`,
              borderRadius: 8,
              padding: '10px 12px',
              lineHeight: 1.65,
            }}
          >
            {evidence.evidence_snippet}
          </div>
        )}
      </Space>
    </CardShell>
  );
}

function EvidencePreviewCard({ evidence, theme }: { evidence: IndustryGraphEvidence; theme: ThemeMode }) {
  const palette = getCardPalette(theme);
  return (
    <div
      style={{
        width: 360,
        color: palette.text,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        {evidence.title_zh || evidence.title}
      </div>
      <Space size={8} wrap style={{ marginBottom: evidence.evidence_snippet ? 8 : 0 }}>
        {evidence.source && <span style={{ color: palette.textMuted }}>{evidence.source}</span>}
        {evidence.published_at && (
          <span style={{ color: palette.textMuted }}>{dayjs(evidence.published_at).format('YYYY-MM-DD')}</span>
        )}
        <ConfidenceBadge score={evidence.confidence_score} theme={theme} />
      </Space>
      {evidence.evidence_snippet && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: `1px solid ${palette.borderSoft}`,
            background: palette.quoteBg,
            color: palette.textSecondary,
          }}
        >
          {evidence.evidence_snippet}
        </div>
      )}
    </div>
  );
}

function AnswerText({
  text,
  evidence,
  theme,
}: {
  text: string;
  evidence: IndustryGraphEvidence[];
  theme: ThemeMode;
}) {
  const palette = getCardPalette(theme);
  const parts = text.split(/(\[证据\d+\])/g);

  if (parts.length === 1) {
    return (
      <div
        style={{
          color: palette.text,
          lineHeight: 1.75,
          fontSize: 15,
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <div
      style={{
        color: palette.text,
        lineHeight: 1.75,
        fontSize: 15,
        whiteSpace: 'pre-wrap',
      }}
    >
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
            title={<EvidencePreviewCard evidence={item} theme={theme} />}
            placement="top"
            mouseEnterDelay={0.15}
            styles={{ root: { maxWidth: 420 } }}
          >
            <span
              style={{
                color: palette.link,
                cursor: 'help',
                fontWeight: 800,
                borderBottom: `1px dotted ${palette.link}`,
              }}
            >
              {part}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

function LocalGraph({ subgraph, theme }: { subgraph: IndustryGraphSubgraph; theme: ThemeMode }) {
  const palette = getCardPalette(theme);
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

  return (
    <CardShell theme={theme} tone="graph">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Space align="start" style={{ justifyContent: 'space-between', width: '100%', gap: 14 }}>
          <div>
            <SectionEyebrow theme={theme}>
              <ApartmentOutlined />
              图谱解释
            </SectionEyebrow>
            <div style={{ color: palette.text, fontSize: 16, fontWeight: 800, marginTop: 4 }}>
              局部解释图
            </div>
          </div>
          <div style={{ color: palette.textMuted, fontSize: 13, whiteSpace: 'nowrap' }}>
            {subgraph.nodes.length} 节点 / {subgraph.edges.length} 边
          </div>
        </Space>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(180px, 220px)',
            gap: 14,
            alignItems: 'stretch',
          }}
        >
          <svg
            viewBox="0 0 620 344"
            role="img"
            aria-label="行业图谱局部解释图"
            style={{
              width: '100%',
              minHeight: 320,
              display: 'block',
              borderRadius: 8,
              border: `1px solid ${palette.borderSoft}`,
              background: palette.graphBg,
            }}
          >
            <defs>
              <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke={palette.graphGrid} strokeWidth="1" opacity="0.55" />
              </pattern>
            </defs>
            <rect x="0" y="0" width="620" height="344" rx="8" fill={palette.graphBg} />
            <rect x="0" y="0" width="620" height="344" rx="8" fill={`url(#${patternId})`} />
            {visibleEdges.map((edge) => {
              const source = nodePositions.get(edge.source_id);
              const target = nodePositions.get(edge.target_id);
              if (!source || !target) {
                return null;
              }
              return (
                <g key={edge.id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={theme === 'dark' ? '#708195' : '#9aa9bd'}
                    strokeWidth={Math.max(1, Math.min(3.5, edge.evidence_count + 1))}
                    opacity="0.48"
                  />
                  <title>{edge.relation_type}</title>
                </g>
              );
            })}
            {visibleNodes.map((node: IndustryGraphNode) => {
              const position = nodePositions.get(node.id);
              if (!position) {
                return null;
              }
              const color = entityTypeColors[node.entity_type] || '#64748b';
              const radius = position.isCenter ? 26 : 18;
              return (
                <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
                  <circle r={radius + 8} fill={color} opacity={theme === 'dark' ? '0.18' : '0.16'} />
                  <circle r={radius} fill={color} opacity="0.95" />
                  <circle r={radius} fill="none" stroke={theme === 'dark' ? '#f8fafc' : '#ffffff'} opacity="0.75" strokeWidth="2" />
                  {position.isCenter && (
                    <>
                      <text
                        y="48"
                        textAnchor="middle"
                        fill={palette.text}
                        fontSize="12"
                        fontWeight="800"
                      >
                        {shortText(node.label, 18)}
                      </text>
                      <text y="64" textAnchor="middle" fill={palette.textMuted} fontSize="11">
                        {entityTypeLabels[node.entity_type] || node.entity_type}
                      </text>
                    </>
                  )}
                  <title>{`${node.label} / ${node.entity_type}`}</title>
                </g>
              );
            })}
          </svg>
          <div
            style={{
              border: `1px solid ${palette.borderSoft}`,
              borderRadius: 8,
              background: palette.surfaceSoft,
              padding: 12,
              minWidth: 0,
            }}
          >
            <div style={{ color: palette.text, fontWeight: 800, marginBottom: 10 }}>节点摘要</div>
            <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
              {typeCounts.map(([type, count]) => (
                <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: entityTypeColors[type] || '#64748b',
                    }}
                  />
                  <span style={{ color: palette.textMuted, fontSize: 12 }}>
                    {entityTypeLabels[type] || type} {count}
                  </span>
                </span>
              ))}
            </Space>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {visibleNodes.slice(0, 8).map((node) => (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    title={node.label}
                    style={{
                      color: palette.textSecondary,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13,
                    }}
                  >
                    {node.label}
                  </span>
                  <EntityTypeBadge type={node.entity_type} theme={theme} />
                </div>
              ))}
            </Space>
          </div>
        </div>
      </Space>
    </CardShell>
  );
}

function ReportBlock({
  block,
  onAsk,
  theme,
  evidenceIndex,
}: {
  block: IndustryGraphContentBlock;
  onAsk: (question: string) => void;
  theme: ThemeMode;
  evidenceIndex?: number;
}) {
  const palette = getCardPalette(theme);
  if (block.type === 'text') {
    const text = 'text' in block.data && typeof block.data.text === 'string' ? block.data.text : '';
    return text ? <div style={{ color: palette.textSecondary, lineHeight: 1.7 }}>{text}</div> : null;
  }

  if (block.type === 'report_section') {
    const title = 'title' in block.data && typeof block.data.title === 'string' ? block.data.title : '';
    const summary = 'summary' in block.data && typeof block.data.summary === 'string' ? block.data.summary : '';
    return (
      <CardShell theme={theme}>
        {title && (
          <div style={{ color: palette.text, fontSize: 16, fontWeight: 800, marginBottom: summary ? 6 : 0 }}>
            {title}
          </div>
        )}
        {summary && <div style={{ color: palette.textSecondary, lineHeight: 1.65 }}>{summary}</div>}
      </CardShell>
    );
  }

  if (block.type === 'trend_card') {
    return <TrendCard trend={block.data as IndustryGraphTrend} theme={theme} />;
  }

  if (block.type === 'evidence_card') {
    return (
      <EvidenceCard
        evidence={block.data as IndustryGraphEvidence}
        theme={theme}
        indexLabel={evidenceIndex ? `证据${evidenceIndex}` : undefined}
      />
    );
  }

  if (block.type === 'local_graph') {
    return <LocalGraph subgraph={block.data as IndustryGraphSubgraph} theme={theme} />;
  }

  if (block.type === 'followup_questions') {
    const questions = 'questions' in block.data && Array.isArray(block.data.questions)
      ? block.data.questions.filter((item): item is string => typeof item === 'string')
      : [];
    if (!questions.length) {
      return null;
    }
    return (
      <Space size={[8, 8]} wrap style={{ paddingTop: 2 }}>
        {questions.map((question) => (
          <Button
            key={question}
            size="small"
            onClick={() => onAsk(question)}
            style={{
              height: 30,
              borderRadius: 6,
              background: palette.surfaceSoft,
              borderColor: palette.border,
              color: palette.text,
              fontWeight: 600,
            }}
          >
            {question}
          </Button>
        ))}
      </Space>
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
  theme,
}: {
  blocks: IndustryGraphContentBlock[];
  onAsk: (question: string) => void;
  theme: ThemeMode;
}) {
  const palette = getCardPalette(theme);
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
    <div
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        background: theme === 'dark' ? '#1d2025' : '#fbfcfe',
        padding: 10,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {sectionMeta.map((section) => {
          const isOpen = openSections[section.key];
          return (
            <Button
              key={section.key}
              aria-label={`${section.label} ${section.count}`}
              icon={section.icon}
              disabled={section.count === 0}
              type={isOpen ? 'primary' : 'default'}
              onClick={() => setOpenSections((previous) => ({
                ...previous,
                [section.key]: !previous[section.key],
              }))}
              style={{
                height: 34,
                borderRadius: 6,
                fontWeight: 700,
              }}
            >
              {section.label} {section.count}
            </Button>
          );
        })}
      </div>

      {sectionMeta.some((section) => openSections[section.key]) && (
        <Space
          direction="vertical"
          size={12}
          style={{
            width: '100%',
            borderTop: `1px solid ${palette.borderSoft}`,
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          {openSections.trends && groupedBlocks.trends.map((block, index) => (
            <ReportBlock
              key={`reference-trend-${index}`}
              block={block}
              onAsk={onAsk}
              theme={theme}
            />
          ))}
          {openSections.evidence && groupedBlocks.evidence.map((block, index) => (
            <ReportBlock
              key={`reference-evidence-${index}`}
              block={block}
              onAsk={onAsk}
              theme={theme}
              evidenceIndex={index + 1}
            />
          ))}
          {openSections.graph && groupedBlocks.graph.map((block, index) => (
            <ReportBlock
              key={`reference-graph-${index}`}
              block={block}
              onAsk={onAsk}
              theme={theme}
            />
          ))}
        </Space>
      )}
    </div>
  );
}

function SuggestedQuestionPrompt({
  items,
  loading,
  isStreaming,
  onAsk,
  theme,
}: {
  items: IndustryGraphSuggestedQuestion[];
  loading: boolean;
  isStreaming: boolean;
  onAsk: (question: string) => void;
  theme: ThemeMode;
}) {
  const palette = getCardPalette(theme);

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '72px 24px',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <Space size={10} style={{ justifyContent: 'center' }}>
          <Avatar
            icon={<BulbOutlined />}
            style={{ background: theme === 'dark' ? '#0f355f' : '#1677ff' }}
          />
          <Text strong style={{ fontSize: 17, color: palette.text }}>
            今日可问
          </Text>
        </Space>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 18 }}>
            <Spin />
          </div>
        ) : items.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 10,
            }}
          >
            {items.map((item) => (
              <Button
                key={item.id}
                onClick={() => onAsk(item.question)}
                disabled={isStreaming}
                style={{
                  height: 'auto',
                  minHeight: 52,
                  whiteSpace: 'normal',
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: palette.surfaceSoft,
                  borderColor: palette.border,
                  color: palette.text,
                  fontWeight: 650,
                  lineHeight: 1.45,
                }}
              >
                {item.question}
              </Button>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ textAlign: 'center' }}>
            暂无推荐问题，可以直接输入你的分析问题
          </Text>
        )}
      </div>
    </div>
  );
}

export default function TechnologyEvolutionPage() {
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const message = useMessage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [processBatchSize, setProcessBatchSize] = useState(5);
  const [processResult, setProcessResult] = useState<IndustryGraphProcessResponse | null>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);
  const chatPalette = getCardPalette(theme);

  const panelStyle: CSSProperties = {
    border: `1px solid ${getThemeColor(theme, 'borderSecondary')}`,
    borderRadius: 8,
    background: getThemeColor(theme, 'bgElevated'),
  };

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
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载会话失败');
    }
  }, [isAuthenticated, isStreaming, message]);

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

  const statsOverview = (
    <div style={{ width: 260 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space>
          <Avatar icon={<LineChartOutlined />} style={{ background: '#1677ff' }} />
          <div>
            <Text strong>技术演进分析</Text>
            <div>
              <Text type="secondary">最近 3 个月</Text>
            </div>
          </div>
        </Space>
        {statsLoading ? (
          <Spin size="small" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            <Statistic title="文档" value={stats?.total_documents ?? 0} prefix={<DatabaseOutlined />} />
            <Statistic title="已解析" value={stats?.processed_documents ?? 0} />
            <Statistic title="待解析" value={stats?.pending_documents ?? 0} />
            <Statistic title="失败" value={stats?.failed_documents ?? 0} />
            <Statistic title="实体" value={stats?.total_entities ?? 0} prefix={<NodeIndexOutlined />} />
            <Statistic title="关系" value={stats?.total_relations ?? 0} prefix={<ApartmentOutlined />} />
            <Statistic title="证据" value={stats?.total_evidence ?? 0} prefix={<FileSearchOutlined />} />
          </div>
        )}
      </Space>
    </div>
  );

  const dataPreparationPanel = (
    <div style={{ width: 300 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space>
          <FileSearchOutlined />
          <Text strong>数据准备</Text>
        </Space>
        <Text type="secondary">
          先少量解析文章，确认实体和关系质量后再扩大批量。
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <InputNumber
            min={1}
            max={50}
            value={processBatchSize}
            onChange={(value) => setProcessBatchSize(value || 1)}
            disabled={processMutation.isPending}
            style={{ width: 88 }}
          />
          <Button
            onClick={() => processMutation.mutate(false)}
            loading={processMutation.isPending}
            disabled={importMutation.isPending}
            style={{ flex: 1 }}
          >
            解析下一批
          </Button>
        </Space.Compact>
        <Space style={{ width: '100%' }}>
          <Button
            block
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
        </Space>
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
      </Space>
    </div>
  );

  return (
    <div style={industryPageStyles.shell}>
      <aside style={industryPageStyles.sidebar}>
        <div
          style={{
            ...panelStyle,
            padding: 14,
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Space direction="vertical" size={12} style={{ width: '100%', minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Space>
                <HistoryOutlined />
                <Text strong>历史会话</Text>
              </Space>
              <Space size={6}>
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
                <span style={{ display: 'inline-flex', width: 6 }} />
                <Tooltip title={statsOverview} placement="right">
                  <Button
                    aria-label="技术演进概览"
                    icon={<LineChartOutlined />}
                    shape="circle"
                    size="small"
                  />
                </Tooltip>
                {isAuthenticated && (
                  <Popover
                    title="数据准备"
                    content={dataPreparationPanel}
                    trigger="click"
                    placement="rightTop"
                  >
                    <Button
                      aria-label="数据准备设置"
                      icon={<SettingOutlined />}
                      shape="circle"
                      size="small"
                    />
                  </Popover>
                )}
              </Space>
            </div>
            {!isAuthenticated ? (
              <Text type="secondary">登录后显示历史会话</Text>
            ) : conversationLoading && !conversationLoaded ? (
              <Spin size="small" />
            ) : conversationGroups.length > 0 ? (
              <div
                style={{
                  width: '100%',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: 0,
                  paddingRight: 2,
                }}
              >
                <Space
                  direction="vertical"
                  size={10}
                  style={{ width: '100%' }}
                >
                  {conversationGroups.map((group) => (
                    <div key={group.label}>
                      <div
                        style={{
                          color: getThemeColor(theme, 'textSecondary'),
                          fontSize: 12,
                          fontWeight: 700,
                          marginBottom: 6,
                          paddingLeft: 2,
                        }}
                      >
                        {group.label}
                      </div>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {group.items.map((conversation) => {
                          const active = conversation.id === conversationId;
                          const isRenaming = renamingId === conversation.id;
                          return (
                            <div
                              key={conversation.id}
                              style={{
                                position: 'relative',
                                border: `1px solid ${active ? getThemeColor(theme, 'primary') : getThemeColor(theme, 'borderSecondary')}`,
                                borderRadius: 8,
                                background: active
                                  ? (theme === 'dark' ? '#0f355f' : '#e6f4ff')
                                  : getThemeColor(theme, 'bgContainer'),
                                overflow: 'hidden',
                              }}
                            >
                              {isRenaming ? (
                                <div style={{ padding: '6px 8px', display: 'flex', gap: 4 }}>
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
                                    onClick={() => handleLoadConversation(conversation.id)}
                                    disabled={isStreaming}
                                    style={{
                                      width: '100%',
                                      cursor: isStreaming ? 'not-allowed' : 'pointer',
                                      border: 'none',
                                      background: 'transparent',
                                      color: getThemeColor(theme, 'text'),
                                      padding: '9px 10px',
                                      textAlign: 'left',
                                      display: 'block',
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, lineHeight: 1.4, paddingRight: 48 }}>
                                      {shortText(conversation.title, 32)}
                                    </div>
                                    <div style={{ color: getThemeColor(theme, 'textSecondary'), fontSize: 12, marginTop: 3 }}>
                                      {dayjs(conversation.updated_at).format('MM-DD HH:mm')}
                                      {conversation.messages.length > 0 ? ` · ${conversation.messages.length} 条` : ''}
                                    </div>
                                  </button>
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: 6,
                                      right: 6,
                                      display: 'flex',
                                      gap: 2,
                                      opacity: 0.5,
                                      transition: 'opacity 0.15s',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
                                  >
                                    <Tooltip title="重命名">
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<EditOutlined />}
                                        style={{ color: getThemeColor(theme, 'textSecondary'), fontSize: 12 }}
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
                                          style={{ color: getThemeColor(theme, 'textSecondary'), fontSize: 12 }}
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
                      </Space>
                    </div>
                  ))}
                  {hasMoreConversations && (
                    <div style={{ textAlign: 'center', padding: '4px 0' }}>
                      <Button
                        type="link"
                        size="small"
                        loading={conversationLoading}
                        onClick={() => loadConversations(true)}
                        style={{ fontSize: 13 }}
                      >
                        显示更多会话
                      </Button>
                    </div>
                  )}
                </Space>
              </div>
            ) : (
              <Text type="secondary">暂无历史会话</Text>
            )}
          </Space>
        </div>

      </aside>

      <main style={{ ...industryPageStyles.report, ...panelStyle }}>
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${getThemeColor(theme, 'borderSecondary')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Space>
            <Avatar icon={<ApartmentOutlined />} style={{ background: '#13c2c2' }} />
            <div>
              <Text strong>行业趋势图谱报告</Text>
              <div>
                <Text type="secondary">流式输出文本、趋势卡片、证据和局部图</Text>
              </div>
            </div>
          </Space>
          <Space size={8} wrap>
            <Tag icon={<ClockCircleOutlined />}>last_3_months</Tag>
            {conversationId && <Tag color="blue">会话 {conversationId}</Tag>}
          </Space>
        </div>

        <div ref={reportBodyRef} style={industryPageStyles.reportBody}>
          {messages.length === 0 ? (
            <SuggestedQuestionPrompt
              items={suggestedQuestions?.items || []}
              loading={questionsLoading}
              isStreaming={isStreaming}
              onAsk={handleAsk}
              theme={theme}
            />
          ) : (
            messages.map((message) => {
              const isUser = message.role === 'user';
              const referenceBlocks = message.blocks.filter(isReferenceBlock);
              const followupBlocks = message.blocks.filter(isFollowupBlock);
              const inlineBlocks = message.blocks.filter((block) => !isReferenceBlock(block) && !isFollowupBlock(block));
              const evidenceBlocks = getEvidenceBlocks(referenceBlocks);
              return (
                <div
                  key={message.id}
                  style={{
                    ...industryPageStyles.messageRow,
                    ...(isUser ? industryPageStyles.userRow : {}),
                  }}
                >
                  <Avatar
                    icon={isUser ? <BulbOutlined /> : <LineChartOutlined />}
                    style={{ background: isUser ? getThemeColor(theme, 'primary') : '#52c41a', flexShrink: 0 }}
                  />
                  <div
                    style={{
                      ...industryPageStyles.messageBody,
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        padding: isUser ? '10px 12px' : '0',
                        borderRadius: 8,
                        background: isUser ? getThemeColor(theme, 'userMessageBg') : 'transparent',
                        color: isUser ? getThemeColor(theme, 'userMessageText') : getThemeColor(theme, 'text'),
                        marginLeft: isUser ? 'auto' : 0,
                        maxWidth: isUser ? 720 : '100%',
                      }}
                    >
                      {isUser ? (
                        <Text style={{ color: getThemeColor(theme, 'userMessageText') }}>{message.text}</Text>
                      ) : (
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          {message.queryPlan && (
                            <Space size={[6, 6]} wrap>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  height: 24,
                                  padding: '0 8px',
                                  borderRadius: 6,
                                  background: theme === 'dark' ? '#0f355f' : '#e6f4ff',
                                  border: `1px solid ${theme === 'dark' ? '#1d5f9f' : '#bae0ff'}`,
                                  color: theme === 'dark' ? '#d6ebff' : '#0958d9',
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {message.queryPlan.primary_scenario}
                              </span>
                              {message.queryPlan.analysis_tasks.map((task) => (
                                <span
                                  key={task}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    height: 24,
                                    padding: '0 8px',
                                    borderRadius: 6,
                                    background: chatPalette.surfaceSoft,
                                    border: `1px solid ${chatPalette.borderSoft}`,
                                    color: chatPalette.textMuted,
                                    fontSize: 12,
                                    fontWeight: 600,
                                  }}
                                >
                                  {task}
                                </span>
                              ))}
                            </Space>
                          )}
                          <div style={industryPageStyles.blockStack}>
                            {inlineBlocks.map((block, index) => (
                              <ReportBlock
                                key={`${message.id}-${block.type}-${index}`}
                                block={block}
                                onAsk={handleAsk}
                                theme={theme}
                              />
                            ))}
                            <ReferenceMaterials
                              blocks={referenceBlocks}
                              onAsk={handleAsk}
                              theme={theme}
                            />
                            {message.isStreaming && referenceBlocks.length > 0 && !message.text && (
                              <div
                                style={{
                                  color: chatPalette.textMuted,
                                  fontSize: 13,
                                  padding: '2px 0 0 2px',
                                }}
                              >
                                正在基于参考资料生成分析...
                              </div>
                            )}
                            {message.text && (
                              <AnswerText
                                text={message.text}
                                evidence={evidenceBlocks}
                                theme={theme}
                              />
                            )}
                            {followupBlocks.map((block, index) => (
                              <ReportBlock
                                key={`${message.id}-${block.type}-followup-${index}`}
                                block={block}
                                onAsk={handleAsk}
                                theme={theme}
                              />
                            ))}
                          </div>
                          {message.isStreaming && (
                            <Space>
                              <Spin size="small" />
                              <Text type="secondary">生成中...</Text>
                            </Space>
                          )}
                          {message.error && (
                            <Alert type="error" showIcon message={message.error} />
                          )}
                        </Space>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            ...industryPageStyles.composer,
            borderTopColor: getThemeColor(theme, 'borderSecondary'),
          }}
        >
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onPressEnter={handleKeyPress}
              placeholder="追问技术演进、技术融合、论文到产品路径..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={!isAuthenticated || isStreaming}
            />
            <Tooltip title="发送">
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={submitInput}
                loading={isStreaming}
                disabled={!isAuthenticated || !inputValue.trim() || isStreaming}
                style={{ height: 'auto', width: 56 }}
              />
            </Tooltip>
          </Space.Compact>
        </div>
      </main>
    </div>
  );
}
