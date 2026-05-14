import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowUpOutlined,
  BranchesOutlined,
  CommentOutlined,
  FilterOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NodeIndexOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import KnowledgeGraphExplorer from '@/components/KnowledgeGraphExplorer';
import KnowledgeGraphMaintenanceDrawer from '@/components/KnowledgeGraphMaintenanceDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { apiService } from '@/services/api';
import type {
  AIQueryEngine,
  KnowledgeGraphPathResponse,
  KnowledgeGraphQueryResponse,
  KnowledgeGraphSnapshotResponse,
  KnowledgeGraphStructuredQueryResponse,
} from '@/types';
import {
  createMarkdownComponents,
  normalizeMarkdownImageContent,
  remarkGfm,
} from '@/utils/markdown';
import { getThemeColor } from '@/utils/theme';

const { Paragraph, Text } = Typography;
const { TextArea, Search } = Input;

type WorkbenchTabKey = 'qa' | 'structured' | 'path' | 'navigate';

// ─── Sidebar tab button ───────────────────────────────────────────────────────

function SidebarTab({
  active,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  theme: 'light' | 'dark';
}) {
  const borderColor = active
    ? '#1677ff'
    : 'transparent';
  const color = active
    ? '#1677ff'
    : getThemeColor(theme, 'textSecondary');

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 40,
        border: 'none',
        borderBottom: `2px solid ${borderColor}`,
        background: 'transparent',
        cursor: 'pointer',
        color,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'color 0.2s, border-color 0.2s',
      }}
    >
      {children}
    </button>
  );
}

// ─── Q&A tab content ──────────────────────────────────────────────────────────

function QATabContent({
  theme,
  question,
  setQuestion,
  queryMode,
  setQueryMode,
  queryResult,
  isPending,
  onAsk,
  onFocusNode,
  onFocusArticle,
  enabled,
}: {
  theme: 'light' | 'dark';
  question: string;
  setQuestion: (v: string) => void;
  queryMode: AIQueryEngine;
  setQueryMode: (v: AIQueryEngine) => void;
  queryResult: KnowledgeGraphQueryResponse | null;
  isPending: boolean;
  onAsk: () => void;
  onFocusNode: (nodeKey: string) => void;
  onFocusArticle: (articleId: number) => void;
  enabled: boolean;
}) {
  const markdownComponents = useMemo(() => createMarkdownComponents(theme), [theme]);
  const normalizedAnswer = normalizeMarkdownImageContent(queryResult?.answer || '');
  const borderColor = getThemeColor(theme, 'border');
  const textColor = getThemeColor(theme, 'text');
  const canAsk = enabled || queryMode === 'rag';
  const surfaceStyle = {
    borderRadius: 14,
    border: `1px solid ${borderColor}`,
    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.56)' : 'rgba(255, 255, 255, 0.94)',
    padding: 12,
    boxShadow: theme === 'dark' ? '0 8px 20px rgba(0, 0, 0, 0.20)' : '0 8px 20px rgba(15, 23, 42, 0.05)',
  };
  const composerStyle = {
    borderRadius: 18,
    border: `1px solid ${borderColor}`,
    background: theme === 'dark' ? 'rgba(15, 23, 42, 0.88)' : '#ffffff',
    padding: '10px 12px',
    boxShadow: theme === 'dark' ? '0 8px 20px rgba(0, 0, 0, 0.24)' : '0 8px 20px rgba(15, 23, 42, 0.06)',
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={composerStyle}>
        <TextArea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder="请输入问题..."
          onPressEnter={(e) => {
            if (e.shiftKey) {
              return;
            }
            e.preventDefault();
            if (!isPending && canAsk) {
              onAsk();
            }
          }}
          style={{
            padding: 0,
            marginBottom: 8,
            border: 'none',
            background: 'transparent',
            boxShadow: 'none',
            color: textColor,
            fontSize: 14,
            lineHeight: 1.6,
            resize: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Select<AIQueryEngine>
            value={queryMode}
            onChange={setQueryMode}
            size="small"
            style={{ width: 118, flexShrink: 0 }}
            options={[
              { label: 'Hybrid', value: 'hybrid', disabled: !enabled },
              { label: 'Graph', value: 'graph', disabled: !enabled },
              { label: 'RAG', value: 'rag' },
              { label: 'Auto', value: 'auto', disabled: !enabled },
            ]}
          />
          <div style={{ flex: 1 }} />
          <Button
            type="primary"
            shape="circle"
            aria-label="开始问答"
            icon={<ArrowUpOutlined />}
            onClick={onAsk}
            loading={isPending}
            disabled={!canAsk}
            style={{
              flexShrink: 0,
              boxShadow: isPending || !canAsk
                ? 'none'
                : theme === 'dark'
                  ? '0 8px 18px rgba(64, 150, 255, 0.28)'
                  : '0 8px 18px rgba(24, 144, 255, 0.22)',
            }}
          />
        </div>
      </div>

      {queryResult ? (
        <div style={surfaceStyle}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              模式：{queryResult.resolved_mode} · 检索：{queryResult.query_strategy === 'structured' ? '结构化检索' : '通用图检索'} · 节点 {queryResult.context_node_count} · 边 {queryResult.context_edge_count}
            </Text>
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {normalizedAnswer}
            </ReactMarkdown>

            {queryResult.matched_nodes.length > 0 && (
              <div>
                <Text strong style={{ fontSize: 12 }}>命中节点</Text>
                <div style={{ marginTop: 6 }}>
                  {queryResult.matched_nodes.map((node) => (
                    <Tag
                      key={node.node_key}
                      color="geekblue"
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      onClick={() => onFocusNode(node.node_key)}
                    >
                      {node.label} / {node.node_type}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {queryResult.related_articles.length > 0 && (
              <div>
                <Text strong style={{ fontSize: 12 }}>相关文章</Text>
                <List
                  size="small"
                  style={{ marginTop: 4 }}
                  dataSource={queryResult.related_articles.slice(0, 6)}
                  locale={{ emptyText: '' }}
                  renderItem={(article) => (
                    <List.Item
                      style={{ padding: '4px 0' }}
                      actions={[
                        <Button
                          key="focus"
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={() => onFocusArticle(article.id)}
                        >
                          定位
                        </Button>,
                      ]}
                    >
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <a href={article.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          {article.title_zh || article.title}
                        </a>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {article.source} · 关系 {article.relation_count}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Space>
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              输入问题后，回答结果和命中节点会出现在这里，点击节点标签可直接在图谱中聚焦
            </Text>
          }
        />
      )}
    </Space>
  );
}

function StructuredQueryTabContent({
  theme,
  question,
  setQuestion,
  result,
  isPending,
  onQuery,
  onFocusNode,
  onFocusArticle,
  enabled,
}: {
  theme: 'light' | 'dark';
  question: string;
  setQuestion: (v: string) => void;
  result: KnowledgeGraphStructuredQueryResponse | null;
  isPending: boolean;
  onQuery: () => void;
  onFocusNode: (nodeKey: string) => void;
  onFocusArticle: (articleId: number) => void;
  enabled: boolean;
}) {
  const markdownComponents = useMemo(() => createMarkdownComponents(theme), [theme]);
  const surfaceStyle = {
    borderRadius: 10,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.44)' : 'rgba(255, 255, 255, 0.84)',
    padding: 14,
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        适合查“满足哪些关系条件的产品/组织/技术”。例如：帮我找基于 Agent-to-UI，并解决跨平台的应用。
      </Paragraph>
      <Space wrap size={[8, 8]}>
        <Button type="primary" onClick={onQuery} loading={isPending} disabled={!enabled}>
          执行结构化查询
        </Button>
      </Space>
      <TextArea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        placeholder="请输入更明确的条件型问题，例如：帮我找基于 Agent-to-UI，并解决跨平台的应用"
        onPressEnter={(e) => {
          if (e.ctrlKey || e.metaKey) onQuery();
        }}
      />
      {result ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={surfaceStyle}>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                目标类型：{result.parsed_query.target_type} · 条件 {result.parsed_query.conditions.length} · 命中 {result.results.length}
              </Text>
              {result.answer ? (
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownImageContent(result.answer)}
                </ReactMarkdown>
              ) : (
                <Text type="secondary">当前问题还没有解析出可执行的结构化条件。</Text>
              )}
            </Space>
          </div>

          <div style={surfaceStyle}>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 12 }}>解析条件</Text>
              {result.parsed_query.conditions.length > 0 ? (
                result.parsed_query.conditions.map((condition, index) => (
                  <Text key={`${condition.relation_type}-${condition.target_type}-${index}`} style={{ fontSize: 12 }}>
                    条件 {index + 1}：{condition.relation_type} → {condition.target_type} / {condition.target_terms.join('、')}
                  </Text>
                ))
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="未解析出结构化条件"
                  description="请把问题写得更明确一些，最好包含目标对象和关系条件。"
                />
              )}
            </Space>
          </div>

          {result.results.length > 0 ? (
            result.results.map((item) => (
              <div key={item.node.node_key} style={surfaceStyle}>
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color="geekblue" style={{ cursor: 'pointer' }} onClick={() => onFocusNode(item.node.node_key)}>
                      {item.node.label}
                    </Tag>
                    <Tag>{item.node.node_type}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      命中关系 {item.matched_edges.length} · 相关文章 {item.related_articles.length}
                    </Text>
                  </Space>
                  {item.matched_edges.map((edge, index) => (
                    <div key={`${item.node.node_key}-${edge.relation_type}-${edge.target_node_key}-${index}`}>
                      <Text style={{ fontSize: 12 }}>
                        {(edge.source_label || item.node.label)} -[{edge.relation_type}]-&gt; {(edge.target_label || edge.target_node_key)}
                      </Text>
                      {edge.evidence_snippet ? (
                        <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
                          证据：{edge.evidence_snippet}
                        </Paragraph>
                      ) : null}
                    </div>
                  ))}
                  {item.related_articles.length > 0 ? (
                    <List
                      size="small"
                      dataSource={item.related_articles.slice(0, 3)}
                      renderItem={(article) => (
                        <List.Item
                          style={{ padding: '4px 0' }}
                          actions={[
                            <Button
                              key="focus"
                              type="link"
                              size="small"
                              style={{ padding: 0 }}
                              onClick={() => onFocusArticle(article.id)}
                            >
                              定位
                            </Button>,
                          ]}
                        >
                          <Space direction="vertical" size={0} style={{ width: '100%' }}>
                            <a href={article.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                              {article.title_zh || article.title}
                            </a>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {article.source} · 关系 {article.relation_count}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  ) : null}
                </Space>
              </div>
            ))
          ) : result.parsed_query.conditions.length > 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<Text type="secondary" style={{ fontSize: 12 }}>没有找到同时满足全部条件的结果</Text>}
            />
          ) : null}
        </Space>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              这里会展示结构化条件、命中实体、关系证据和相关文章
            </Text>
          }
        />
      )}
    </Space>
  );
}

// ─── Path tab content ─────────────────────────────────────────────────────────

function PathTabContent({
  theme,
  pathSource,
  pathTarget,
  pathNodeSearch,
  setPathNodeSearch,
  pathNodeOptions,
  pathNodesLoading,
  pathResult,
  isPending,
  onSetSource,
  onSetTarget,
  onQuery,
  onFocusNode,
  onHighlightPath,
}: {
  theme: 'light' | 'dark';
  pathSource?: string;
  pathTarget?: string;
  pathNodeSearch: string;
  setPathNodeSearch: (v: string) => void;
  pathNodeOptions: { label: string; value: string }[];
  pathNodesLoading: boolean;
  pathResult: KnowledgeGraphPathResponse | null;
  isPending: boolean;
  onSetSource: (v: string) => void;
  onSetTarget: (v: string) => void;
  onQuery: () => void;
  onFocusNode: (nodeKey: string) => void;
  onHighlightPath: () => void;
}) {
  const surfaceStyle = {
    borderRadius: 10,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.44)' : 'rgba(255, 255, 255, 0.84)',
    padding: 14,
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        选定两个实体，查询它们之间的最短关系路径，结果直接在图谱中高亮。
      </Paragraph>
      <Search
        placeholder="搜索节点名称"
        allowClear
        value={pathNodeSearch}
        onChange={(e) => setPathNodeSearch(e.target.value)}
      />
      <div>
        <Text style={{ fontSize: 12 }}>起点</Text>
        <Select
          showSearch
          value={pathSource}
          onChange={onSetSource}
          onSearch={setPathNodeSearch}
          filterOption={false}
          placeholder="选择起点节点"
          options={pathNodeOptions}
          style={{ width: '100%', marginTop: 4 }}
          notFoundContent={pathNodesLoading ? <Spin size="small" /> : null}
        />
      </div>
      <div>
        <Text style={{ fontSize: 12 }}>终点</Text>
        <Select
          showSearch
          value={pathTarget}
          onChange={onSetTarget}
          onSearch={setPathNodeSearch}
          filterOption={false}
          placeholder="选择终点节点"
          options={pathNodeOptions}
          style={{ width: '100%', marginTop: 4 }}
          notFoundContent={pathNodesLoading ? <Spin size="small" /> : null}
        />
      </div>
      <Button type="primary" block onClick={onQuery} loading={isPending}>
        查询最短路径
      </Button>

      {pathResult && (
        <div style={surfaceStyle}>
          {pathResult.found ? (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text strong>路径长度：{pathResult.distance}</Text>
              <div>
                {pathResult.nodes.map((node, index) => (
                  <span key={node.node_key}>
                    <Tag
                      color="orange"
                      style={{ cursor: 'pointer', marginBottom: 4 }}
                      onClick={() => onFocusNode(node.node_key)}
                    >
                      {node.label}
                    </Tag>
                    {index < pathResult.nodes.length - 1 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {' '}—{pathResult.edges[index]?.relation_type || '→'}—{' '}
                      </Text>
                    )}
                  </span>
                ))}
              </div>
              <Button size="small" onClick={onHighlightPath}>
                在图谱中重新高亮
              </Button>
            </Space>
          ) : (
            <Text type="secondary">未找到路径，两实体之间可能没有直接连接</Text>
          )}
        </div>
      )}

      {!pathResult && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              选定起点和终点后，这里会展示关系路径并在图谱中高亮
            </Text>
          }
        />
      )}
    </Space>
  );
}

// ─── Navigate tab content ─────────────────────────────────────────────────────

function NavigateTabContent({
  theme,
  navigationSearch,
  setNavigationSearch,
  navigationNodes,
  navigationNodesLoading,
  onFocusNode,
}: {
  theme: 'light' | 'dark';
  navigationSearch: string;
  setNavigationSearch: (v: string) => void;
  navigationNodes: KnowledgeGraphSnapshotResponse['nodes'];
  navigationNodesLoading: boolean;
  onFocusNode: (nodeKey: string) => void;
}) {
  const textColor = getThemeColor(theme, 'text');

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Search
        placeholder="搜索实体名称或 node key"
        allowClear
        value={navigationSearch}
        onChange={(e) => setNavigationSearch(e.target.value)}
      />

      <List
        size="small"
        loading={navigationNodesLoading}
        dataSource={navigationNodes}
        locale={{ emptyText: '暂无节点' }}
        renderItem={(node) => (
          <List.Item
            style={{ padding: '6px 0', cursor: 'pointer' }}
            onClick={() => onFocusNode(node.node_key)}
            actions={[
              <Button
                key="focus"
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={(e) => { e.stopPropagation(); onFocusNode(node.node_key); }}
              >
                定位
              </Button>,
            ]}
          >
            <Space direction="vertical" size={0} style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 12, color: textColor }}>{node.label}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {node.node_type} · 度数 {node.degree}
              </Text>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function KnowledgeGraphPanel() {
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showWarning } = useErrorHandler();
  const { graphCommand, focusArticle, focusNode, focusPath } = useKnowledgeGraphView();

  // Layout state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkbenchTabKey>('qa');

  // Filter state (used by Explorer + top bar)
  const [searchTerm, setSearchTerm] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>();
  const [limitNodes, setLimitNodes] = useState(160);

  // Available options from snapshot (passed up from Explorer)
  const [availableNodeTypes, setAvailableNodeTypes] = useState<string[]>([]);

  // Q&A state
  const [question, setQuestion] = useState('');
  const [structuredQuestion, setStructuredQuestion] = useState('');
  const [queryMode, setQueryMode] = useState<AIQueryEngine>('hybrid');
  const [queryResult, setQueryResult] = useState<KnowledgeGraphQueryResponse | null>(null);
  const [structuredQueryResult, setStructuredQueryResult] = useState<KnowledgeGraphStructuredQueryResponse | null>(null);

  // Path state
  const [pathSource, setPathSource] = useState<string>();
  const [pathTarget, setPathTarget] = useState<string>();
  const [pathNodeSearch, setPathNodeSearch] = useState('');
  const [pathResult, setPathResult] = useState<KnowledgeGraphPathResponse | null>(null);

  // Navigation state
  const [navigationSearch, setNavigationSearch] = useState('');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['knowledge-graph-stats'],
    queryFn: () => apiService.getKnowledgeGraphStats(),
    refetchInterval: 30000,
  });

  const { data: settings } = useQuery({
    queryKey: ['knowledge-graph-settings'],
    queryFn: () => apiService.getKnowledgeGraphSettings(),
  });

  const { data: pathNodeResults, isLoading: pathNodesLoading } = useQuery({
    queryKey: ['knowledge-graph-nodes', 'path', pathNodeSearch],
    queryFn: () => apiService.getKnowledgeGraphNodes({ q: pathNodeSearch.trim() || undefined, limit: 20 }),
    enabled: Boolean(pathNodeSearch.trim()),
  });

  const { data: navigationNodeResults, isLoading: navigationNodesLoading } = useQuery({
    queryKey: ['knowledge-graph-nodes', 'navigation', navigationSearch],
    queryFn: () => apiService.getKnowledgeGraphNodes({ q: navigationSearch.trim() || undefined, limit: 20 }),
    enabled: Boolean(navigationSearch.trim()),
  });

  // Handle graph navigation commands
  useEffect(() => {
    if (!graphCommand?.id) return;
    // Update filter state from command
    if (graphCommand.searchTerm !== undefined) setSearchTerm(graphCommand.searchTerm);
    if (graphCommand.nodeType !== undefined) setNodeTypeFilter(graphCommand.nodeType);
    // Switch sidebar tab based on reason
    if (graphCommand.reason === 'path') setActiveTab('path');
    else if (graphCommand.reason === 'node' || graphCommand.reason === 'article') setActiveTab('navigate');
  }, [graphCommand?.id]);

  const handleSnapshotChange = useCallback((snapshot: KnowledgeGraphSnapshotResponse | undefined) => {
    if (!snapshot) return;
    setAvailableNodeTypes(snapshot.available_node_types || []);
  }, []);

  const refreshGraphQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-settings'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-builds'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-nodes'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-snapshot'] });
  }, [queryClient]);

  // Q&A mutation
  const queryMutation = useMutation({
    mutationFn: async () => {
      const currentQuestion = question.trim();
      let accumulatedAnswer = '';
      let streamError: Error | null = null;
      let latestResult: KnowledgeGraphQueryResponse = {
        question: currentQuestion,
        mode: queryMode,
        resolved_mode: queryMode,
        query_strategy: 'generic_graph',
        answer: '',
        matched_nodes: [],
        related_articles: [],
        context_node_count: 0,
        context_edge_count: 0,
      };

      setQueryResult(latestResult);

      await apiService.queryKnowledgeGraphStream(
        { question: currentQuestion, mode: queryMode, top_k: 6, query_depth: settings?.query_depth },
        (chunk) => {
          if (chunk.type === 'graph_context') {
            latestResult = {
              ...latestResult,
              mode: chunk.data.mode || queryMode,
              resolved_mode: chunk.data.resolved_mode || queryMode,
              query_strategy: chunk.data.query_strategy || latestResult.query_strategy,
              matched_nodes: chunk.data.matched_nodes || [],
              related_articles: chunk.data.related_articles || [],
              context_node_count: chunk.data.context_node_count || 0,
              context_edge_count: chunk.data.context_edge_count || 0,
            };
            setQueryResult(latestResult);
            return;
          }
          if (chunk.type === 'content') {
            accumulatedAnswer += chunk.data.content || '';
            latestResult = { ...latestResult, answer: accumulatedAnswer };
            setQueryResult(latestResult);
            return;
          }
          if (chunk.type === 'error') {
            streamError = new Error(chunk.data.message || '图谱问答流式响应失败');
          }
        }
      );

      if (streamError) throw streamError;
      return latestResult;
    },
    onSuccess: (response) => {
      setQueryResult(response);
    },
    onError: createErrorHandler({ operationName: '执行图谱问答' }),
  });

  const structuredQueryMutation = useMutation({
    mutationFn: () =>
      apiService.structuredQueryKnowledgeGraph({
        question: structuredQuestion.trim(),
        top_k: 6,
      }),
    onSuccess: (response) => {
      setStructuredQueryResult(response);
    },
    onError: createErrorHandler({ operationName: '执行结构化图谱查询' }),
  });

  // Path mutation
  const pathMutation = useMutation({
    mutationFn: () =>
      apiService.findKnowledgeGraphPath({
        source_node_key: pathSource || '',
        target_node_key: pathTarget || '',
      }),
    onSuccess: (response) => {
      setPathResult(response);
      if (response.found) {
        focusPath(
          response.nodes.map((node) => node.node_key),
          response.edges.map((edge) => ({ source: edge.source_node_key, target: edge.target_node_key }))
        );
        setActiveTab('path');
      }
    },
    onError: createErrorHandler({ operationName: '查询知识图谱路径' }),
  });

  const handleAsk = () => {
    if (!question.trim()) { showWarning('请输入问题'); return; }
    queryMutation.mutate();
  };

  const handleStructuredQuery = () => {
    if (!structuredQuestion.trim()) { showWarning('请输入结构化查询问题'); return; }
    structuredQueryMutation.mutate();
  };

  const handlePathQuery = () => {
    if (!pathSource || !pathTarget) { showWarning('请选择起点和终点节点'); return; }
    pathMutation.mutate();
  };

  const highlightPath = useCallback(() => {
    if (!pathResult?.found) return;
    focusPath(
      pathResult.nodes.map((node) => node.node_key),
      pathResult.edges.map((edge) => ({ source: edge.source_node_key, target: edge.target_node_key }))
    );
  }, [focusPath, pathResult]);

  const pathNodeOptions = useMemo(() => {
    const items = pathNodeSearch.trim() ? (pathNodeResults?.items || []) : (stats?.top_nodes || []);
    return items.map((node) => ({ label: `${node.label} (${node.node_key})`, value: node.node_key }));
  }, [pathNodeResults?.items, pathNodeSearch, stats?.top_nodes]);

  const navigationNodes = useMemo(
    () => (navigationSearch.trim() ? navigationNodeResults?.items || [] : stats?.top_nodes || []),
    [navigationNodeResults?.items, navigationSearch, stats?.top_nodes]
  );

  const coveragePercent = Number(((stats?.coverage ?? 0) * 100).toFixed(1));

  // Theme-derived colors
  const borderColor = getThemeColor(theme, 'border');
  const textColor = getThemeColor(theme, 'text');
  const textSecondary = getThemeColor(theme, 'textSecondary');
  const sidebarBg = theme === 'dark' ? '#0f1117' : '#ffffff';
  const topBarBg = theme === 'dark' ? '#0f1117' : '#ffffff';

  // ─── Top bar ───────────────────────────────────────────────────────────────
  const topBar = (
    <div
      style={{
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        borderBottom: `1px solid ${borderColor}`,
        background: topBarBg,
        overflow: 'hidden',
      }}
    >
      {/* Title */}
      <Text strong style={{ fontSize: 14, color: textColor, whiteSpace: 'nowrap' }}>
        知识图谱
      </Text>

      {/* Status badge */}
      <Tooltip title={stats?.enabled ? '图谱已启用' : '图谱未启用（请在设置中开启）'}>
        <Badge
          status={stats?.enabled ? 'success' : 'warning'}
          style={{ flexShrink: 0 }}
        />
      </Tooltip>

      {/* Mini stats */}
      {!statsLoading && stats && (
        <Space size={6} wrap={false} style={{ flexShrink: 0 }}>
          <Tag style={{ margin: 0 }}>节点 {stats.total_nodes.toLocaleString()}</Tag>
          <Tag style={{ margin: 0 }}>边 {stats.total_edges.toLocaleString()}</Tag>
          <Tag style={{ margin: 0 }}>文章 {stats.total_articles.toLocaleString()}</Tag>
          <Tag style={{ margin: 0 }}>覆盖 {coveragePercent}%</Tag>
        </Space>
      )}

      {/* Snapshot time */}
      {!statsLoading && stats?.snapshot_updated_at && (
        <Tooltip title="图谱快照更新时间">
          <Text style={{ fontSize: 11, color: textSecondary, flexShrink: 0, whiteSpace: 'nowrap' }}>
            快照 {dayjs(stats.snapshot_updated_at).format('MM-DD HH:mm')}
          </Text>
        </Tooltip>
      )}

      <div style={{ flex: 1 }} />

      {/* Search */}
      <Search
        allowClear
        placeholder="搜索实体..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{ width: 180, flexShrink: 0 }}
        size="small"
      />

      {/* Node type filter */}
      <Select
        allowClear
        placeholder="节点类型"
        value={nodeTypeFilter}
        onChange={setNodeTypeFilter}
        style={{ width: 120, flexShrink: 0 }}
        size="small"
        options={availableNodeTypes.map((t) => ({ label: t, value: t }))}
      />

      {/* Node limit */}
      <Select<number>
        value={limitNodes}
        onChange={setLimitNodes}
        style={{ width: 90, flexShrink: 0 }}
        size="small"
        options={[80, 160, 300, 500].map((v) => ({ label: `${v}节点`, value: v }))}
      />

      {/* Maintenance gear (authenticated only) */}
      {isAuthenticated && (
        <Tooltip title="运维管理">
          <Button
            aria-label="打开运维管理"
            type="text"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setMaintenanceOpen(true)}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
      )}
    </div>
  );

  // ─── Collapsed sidebar ────────────────────────────────────────────────────
  const collapsedSidebar = (
    <div
      style={{
        width: 40,
        flexShrink: 0,
        borderRight: `1px solid ${borderColor}`,
        background: sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 6,
      }}
    >
      <Tooltip title="展开侧栏" placement="right">
        <Button
          type="text"
          size="small"
          icon={<MenuUnfoldOutlined />}
          onClick={() => setSidebarCollapsed(false)}
          style={{ color: textSecondary }}
        />
      </Tooltip>
      <div style={{ width: 24, height: 1, background: borderColor, margin: '2px 0' }} />
      <Tooltip title="图谱问答" placement="right">
        <Button
          type="text"
          size="small"
          icon={<CommentOutlined />}
          onClick={() => { setSidebarCollapsed(false); setActiveTab('qa'); }}
          style={{ color: activeTab === 'qa' ? '#1677ff' : textSecondary }}
        />
      </Tooltip>
      <Tooltip title="结构化查询" placement="right">
        <Button
          type="text"
          size="small"
          icon={<FilterOutlined />}
          onClick={() => { setSidebarCollapsed(false); setActiveTab('structured'); }}
          style={{ color: activeTab === 'structured' ? '#1677ff' : textSecondary }}
        />
      </Tooltip>
      <Tooltip title="关系路径" placement="right">
        <Button
          type="text"
          size="small"
          icon={<BranchesOutlined />}
          onClick={() => { setSidebarCollapsed(false); setActiveTab('path'); }}
          style={{ color: activeTab === 'path' ? '#1677ff' : textSecondary }}
        />
      </Tooltip>
      <Tooltip title="实体导航" placement="right">
        <Button
          type="text"
          size="small"
          icon={<NodeIndexOutlined />}
          onClick={() => { setSidebarCollapsed(false); setActiveTab('navigate'); }}
          style={{ color: activeTab === 'navigate' ? '#1677ff' : textSecondary }}
        />
      </Tooltip>
    </div>
  );

  // ─── Expanded sidebar ─────────────────────────────────────────────────────
  const expandedSidebar = (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        borderRight: `1px solid ${borderColor}`,
        background: sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <SidebarTab active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} theme={theme}>
          <CommentOutlined />
          <span>问答</span>
        </SidebarTab>
        <SidebarTab active={activeTab === 'structured'} onClick={() => setActiveTab('structured')} theme={theme}>
          <FilterOutlined />
          <span>结构化</span>
        </SidebarTab>
        <SidebarTab active={activeTab === 'path'} onClick={() => setActiveTab('path')} theme={theme}>
          <BranchesOutlined />
          <span>路径</span>
        </SidebarTab>
        <SidebarTab active={activeTab === 'navigate'} onClick={() => setActiveTab('navigate')} theme={theme}>
          <NodeIndexOutlined />
          <span>导航</span>
        </SidebarTab>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}>
          <Tooltip title="收起侧栏">
            <Button
              type="text"
              size="small"
              icon={<MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(true)}
              style={{ color: textSecondary }}
            />
          </Tooltip>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {activeTab === 'qa' && (
          <QATabContent
            theme={theme}
            question={question}
            setQuestion={setQuestion}
            queryMode={queryMode}
            setQueryMode={setQueryMode}
            queryResult={queryResult}
            isPending={queryMutation.isPending}
            onAsk={handleAsk}
            onFocusNode={(nodeKey) => focusNode(nodeKey)}
            onFocusArticle={(id) => focusArticle(id)}
            enabled={stats?.enabled ?? false}
          />
        )}
        {activeTab === 'structured' && (
          <StructuredQueryTabContent
            theme={theme}
            question={structuredQuestion}
            setQuestion={setStructuredQuestion}
            result={structuredQueryResult}
            isPending={structuredQueryMutation.isPending}
            onQuery={handleStructuredQuery}
            onFocusNode={(nodeKey) => focusNode(nodeKey)}
            onFocusArticle={(id) => focusArticle(id)}
            enabled={stats?.enabled ?? false}
          />
        )}
        {activeTab === 'path' && (
          <PathTabContent
            theme={theme}
            pathSource={pathSource}
            pathTarget={pathTarget}
            pathNodeSearch={pathNodeSearch}
            setPathNodeSearch={setPathNodeSearch}
            pathNodeOptions={pathNodeOptions}
            pathNodesLoading={pathNodesLoading}
            pathResult={pathResult}
            isPending={pathMutation.isPending}
            onSetSource={setPathSource}
            onSetTarget={setPathTarget}
            onQuery={handlePathQuery}
            onFocusNode={(nodeKey) => focusNode(nodeKey)}
            onHighlightPath={highlightPath}
          />
        )}
        {activeTab === 'navigate' && (
          <NavigateTabContent
            theme={theme}
            navigationSearch={navigationSearch}
            setNavigationSearch={setNavigationSearch}
            navigationNodes={navigationNodes}
            navigationNodesLoading={navigationNodesLoading}
            onFocusNode={(nodeKey) => focusNode(nodeKey)}
          />
        )}
      </div>
    </div>
  );

  // ─── Disabled state ───────────────────────────────────────────────────────
  const disabledCanvas = (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme === 'dark' ? '#090b0f' : '#f6f8fb',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <Empty description="知识图谱未启用" />
        <Alert
          type="warning"
          showIcon
          message="知识图谱当前已关闭"
          description="请在系统设置中启用知识图谱，再执行同步、问答、路径查询和图谱探索。"
          style={{ marginTop: 16, maxWidth: 400 }}
        />
      </div>
    </div>
  );

  return (
    <Spin spinning={statsLoading && !stats}>
      {/* Full-height layout container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 158px)',
          minHeight: 500,
          border: `1px solid ${borderColor}`,
          borderRadius: 12,
          overflow: 'hidden',
          background: theme === 'dark' ? '#090b0f' : '#f6f8fb',
        }}
      >
        {/* Top bar */}
        {topBar}

        {/* Body: sidebar + canvas */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left sidebar */}
          {sidebarCollapsed ? collapsedSidebar : expandedSidebar}

          {/* Canvas area */}
          {stats?.enabled === false ? (
            disabledCanvas
          ) : (
            <KnowledgeGraphExplorer
              searchTerm={searchTerm}
              nodeTypeFilter={nodeTypeFilter}
              limitNodes={limitNodes}
              onSnapshotChange={handleSnapshotChange}
            />
          )}
        </div>
      </div>

      <KnowledgeGraphMaintenanceDrawer
        open={maintenanceOpen}
        onClose={() => setMaintenanceOpen(false)}
        enabled={stats?.enabled ?? false}
        snapshotUpdatedAt={stats?.snapshot_updated_at}
        onRefresh={refreshGraphQueries}
      />
    </Spin>
  );
}
