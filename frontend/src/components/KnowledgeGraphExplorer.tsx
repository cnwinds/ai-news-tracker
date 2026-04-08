import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  AimOutlined,
  ApartmentOutlined,
  BgColorsOutlined,
  CommentOutlined,
  MinusOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { apiService } from '@/services/api';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import {
  buildKnowledgeGraphEdgeKey,
  buildNodeQuestion,
} from '@/utils/knowledgeGraph';
import type {
  AIQueryEngine,
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphNodeDetail,
  KnowledgeGraphNodeSummary,
} from '@/types';

const { Search } = Input;
const { Paragraph, Text, Title } = Typography;

type PositionedNode = KnowledgeGraphNodeSummary & {
  x: number;
  y: number;
  radius: number;
};

type ViewportState = {
  scale: number;
  x: number;
  y: number;
};

const SVG_WIDTH = 980;
const SVG_HEIGHT = 620;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;

const PALETTE = ['#0f766e', '#2563eb', '#dc2626', '#ca8a04', '#7c3aed', '#ea580c', '#0891b2', '#4f46e5'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNodeTypeColor(nodeType: string) {
  const normalized = String(nodeType || 'concept');
  const index = normalized
    .split('')
    .reduce((accumulator, char) => accumulator + char.charCodeAt(0), 0) % PALETTE.length;
  return PALETTE[index];
}

function buildCommunityCenters(communities: Array<number | 'unclustered'>) {
  const radius = Math.min(250, 110 + communities.length * 18);
  const centerX = SVG_WIDTH / 2;
  const centerY = SVG_HEIGHT / 2;

  return new Map(
    communities.map((community, index) => {
      if (communities.length === 1) {
        return [community, { x: centerX, y: centerY }] as const;
      }
      const angle = (Math.PI * 2 * index) / communities.length - Math.PI / 2;
      return [
        community,
        {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * Math.max(120, radius * 0.68),
        },
      ] as const;
    })
  );
}

function computeLayout(nodes: KnowledgeGraphNodeSummary[]): PositionedNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const groups = new Map<number | 'unclustered', KnowledgeGraphNodeSummary[]>();
  for (const node of nodes) {
    const key = node.community_id ?? 'unclustered';
    const existing = groups.get(key) || [];
    existing.push(node);
    groups.set(key, existing);
  }

  const centers = buildCommunityCenters(Array.from(groups.keys()));
  const positioned: PositionedNode[] = [];

  for (const [groupKey, groupNodes] of groups.entries()) {
    const center = centers.get(groupKey)!;
    const ordered = [...groupNodes].sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label));
    if (ordered.length === 1) {
      const node = ordered[0];
      positioned.push({
        ...node,
        x: center.x,
        y: center.y,
        radius: 10 + Math.min(Math.sqrt(Math.max(node.degree, 1)) * 3, 12),
      });
      continue;
    }

    ordered.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / ordered.length - Math.PI / 2;
      const orbital = 42 + Math.sqrt(index + 1) * 22;
      const communityScale = 1 + ordered.length / 18;
      positioned.push({
        ...node,
        x: center.x + Math.cos(angle) * orbital * communityScale,
        y: center.y + Math.sin(angle) * orbital * Math.max(0.85, communityScale * 0.78),
        radius: 10 + Math.min(Math.sqrt(Math.max(node.degree, 1)) * 3, 12),
      });
    });
  }

  return positioned;
}

function getDefaultViewport(): ViewportState {
  return { scale: 1, x: 0, y: 0 };
}

export default function KnowledgeGraphExplorer() {
  const { theme } = useTheme();
  const { openModal, setSelectedEngine } = useAIConversation();
  const { graphCommand, focusArticle, focusCommunity } = useKnowledgeGraphView();
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>();
  const [communityFilter, setCommunityFilter] = useState<number>();
  const [limitNodes, setLimitNodes] = useState(80);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>();
  const [focusNodeKeys, setFocusNodeKeys] = useState<string[]>([]);
  const [expandDepth, setExpandDepth] = useState(0);
  const [highlightedNodeKeys, setHighlightedNodeKeys] = useState<string[]>([]);
  const [highlightedEdgeKeys, setHighlightedEdgeKeys] = useState<string[]>([]);
  const [viewport, setViewport] = useState<ViewportState>(getDefaultViewport);

  const resetViewport = useCallback(() => {
    setViewport(getDefaultViewport());
  }, []);

  useEffect(() => {
    if (!graphCommand?.id) {
      return;
    }
    setSearchTerm(graphCommand.searchTerm ?? '');
    setNodeTypeFilter(graphCommand.nodeType);
    setCommunityFilter(graphCommand.communityId);
    setSelectedNodeKey(graphCommand.selectedNodeKey);
    setFocusNodeKeys(graphCommand.focusNodeKeys);
    setExpandDepth(graphCommand.expandDepth);
    setHighlightedNodeKeys(graphCommand.highlightedNodeKeys);
    setHighlightedEdgeKeys(graphCommand.highlightedEdgeKeys);
    resetViewport();
  }, [graphCommand?.id, resetViewport]);

  const { data: snapshot, isLoading, refetch, isFetching } = useQuery({
    queryKey: [
      'knowledge-graph-snapshot',
      searchTerm,
      nodeTypeFilter,
      communityFilter,
      limitNodes,
      focusNodeKeys.join('|'),
      expandDepth,
    ],
    queryFn: () =>
      apiService.getKnowledgeGraphSnapshot({
        q: searchTerm.trim() || undefined,
        node_type: nodeTypeFilter || undefined,
        community_id: communityFilter,
        limit_nodes: limitNodes,
        focus_node_keys: focusNodeKeys.length > 0 ? focusNodeKeys : undefined,
        expand_depth: focusNodeKeys.length > 0 ? expandDepth : undefined,
      }),
  });

  const { data: nodeDetail, isLoading: nodeDetailLoading } = useQuery({
    queryKey: ['knowledge-graph-node-detail', selectedNodeKey],
    queryFn: () => apiService.getKnowledgeGraphNode(selectedNodeKey!),
    enabled: Boolean(selectedNodeKey),
  });

  const nodes = snapshot?.nodes || [];
  const links = snapshot?.links || [];
  const communities = snapshot?.communities || [];

  useEffect(() => {
    if (!selectedNodeKey || !snapshot) {
      return;
    }
    const existsInSnapshot = nodes.some((node) => node.node_key === selectedNodeKey);
    if (!existsInSnapshot) {
      setSelectedNodeKey(undefined);
    }
  }, [nodes, selectedNodeKey, snapshot]);

  const positionedNodes = useMemo(() => computeLayout(nodes), [nodes]);

  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.node_key, node])),
    [positionedNodes]
  );

  const highlightedNodeKeySet = useMemo(
    () => new Set(highlightedNodeKeys),
    [highlightedNodeKeys]
  );

  const highlightedEdgeKeySet = useMemo(
    () => new Set(highlightedEdgeKeys),
    [highlightedEdgeKeys]
  );

  const selectedNeighborKeys = useMemo(() => {
    if (!selectedNodeKey) {
      return new Set<string>();
    }
    const neighborKeys = new Set<string>([selectedNodeKey]);
    for (const link of links) {
      if (link.source === selectedNodeKey) {
        neighborKeys.add(link.target);
      }
      if (link.target === selectedNodeKey) {
        neighborKeys.add(link.source);
      }
    }
    return neighborKeys;
  }, [links, selectedNodeKey]);

  const labelKeys = useMemo(() => {
    const topNodes = [...positionedNodes]
      .sort((left, right) => right.degree - left.degree)
      .slice(0, 12)
      .map((node) => node.node_key);
    return new Set(topNodes);
  }, [positionedNodes]);

  const communityOptions = useMemo(
    () =>
      communities.map((community) => ({
        label: `${community.label} (${community.node_count})`,
        value: community.community_id,
      })),
    [communities]
  );

  const selectedCommunity = useMemo(
    () => communities.find((community) => community.community_id === communityFilter),
    [communities, communityFilter]
  );

  const clearExplorerState = useCallback(() => {
    setSearchTerm('');
    setNodeTypeFilter(undefined);
    setCommunityFilter(undefined);
    setSelectedNodeKey(undefined);
    setFocusNodeKeys([]);
    setExpandDepth(0);
    setHighlightedNodeKeys([]);
    setHighlightedEdgeKeys([]);
    resetViewport();
  }, [resetViewport]);

  const handleNodeClick = useCallback((nodeKey: string) => {
    setSelectedNodeKey(nodeKey);
    setHighlightedNodeKeys([]);
    setHighlightedEdgeKeys([]);
    if (expandDepth > 0) {
      setFocusNodeKeys([nodeKey]);
    }
  }, [expandDepth]);

  const handleNeighborhoodChange = useCallback((value: number) => {
    setExpandDepth(value);
    if (value > 0) {
      const anchorNodeKey = selectedNodeKey || focusNodeKeys[0];
      if (anchorNodeKey) {
        setFocusNodeKeys([anchorNodeKey]);
      }
    }
  }, [focusNodeKeys, selectedNodeKey]);

  const handleAskAboutNode = useCallback((mode: AIQueryEngine) => {
    if (!nodeDetail?.node) {
      return;
    }
    setSelectedEngine(mode);
    openModal(buildNodeQuestion(nodeDetail.node, mode));
  }, [nodeDetail?.node, openModal, setSelectedEngine]);

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setViewport((previous) => ({
      ...previous,
      scale: clamp(previous.scale + (event.deltaY < 0 ? 0.14 : -0.14), MIN_SCALE, MAX_SCALE),
    }));
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
  }, [viewport.x, viewport.y]);

  const handleMouseMove = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (!dragStateRef.current.active) {
      return;
    }
    const deltaX = (event.clientX - dragStateRef.current.startX) / viewport.scale;
    const deltaY = (event.clientY - dragStateRef.current.startY) / viewport.scale;
    setViewport((previous) => ({
      ...previous,
      x: dragStateRef.current.originX + deltaX,
      y: dragStateRef.current.originY + deltaY,
    }));
  }, [viewport.scale]);

  const stopDragging = useCallback(() => {
    dragStateRef.current.active = false;
  }, []);

  return (
    <Card
      title="图谱画布"
      extra={
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
            刷新画布
          </Button>
          <Button onClick={resetViewport}>重置视图</Button>
        </Space>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space wrap>
          <Search
            allowClear
            placeholder="搜索实体名称或 node key"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            placeholder="筛选节点类型"
            value={nodeTypeFilter}
            onChange={setNodeTypeFilter}
            style={{ width: 180 }}
            options={(snapshot?.available_node_types || []).map((nodeType) => ({
              label: nodeType,
              value: nodeType,
            }))}
          />
          <Select
            allowClear
            placeholder="筛选社区"
            value={communityFilter}
            onChange={setCommunityFilter}
            style={{ width: 220 }}
            options={communityOptions}
          />
          <Select<number>
            value={limitNodes}
            onChange={setLimitNodes}
            style={{ width: 140 }}
            options={[40, 80, 120, 160].map((value) => ({
              label: `${value} 节点`,
              value,
            }))}
          />
          <Select<number>
            value={expandDepth}
            onChange={handleNeighborhoodChange}
            style={{ width: 150 }}
            options={[
              { label: '聚焦子图', value: 0 },
              { label: '1 跳邻域', value: 1 },
              { label: '2 跳邻域', value: 2 },
            ]}
          />
          <Space size={4}>
            <Button
              icon={<MinusOutlined />}
              onClick={() => setViewport((previous) => ({ ...previous, scale: clamp(previous.scale - 0.12, MIN_SCALE, MAX_SCALE) }))}
            />
            <Button
              icon={<PlusOutlined />}
              onClick={() => setViewport((previous) => ({ ...previous, scale: clamp(previous.scale + 0.12, MIN_SCALE, MAX_SCALE) }))}
            />
          </Space>
          <Button onClick={clearExplorerState}>恢复全图</Button>
          {selectedCommunity && (
            <Button
              icon={<ApartmentOutlined />}
              onClick={() =>
                focusCommunity(selectedCommunity.community_id, {
                  selectedNodeKey: selectedCommunity.top_nodes[0]?.node_key,
                })
              }
            >
              打开社区
            </Button>
          )}
        </Space>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <div
              style={{
                border: `1px solid ${getThemeColor(theme, 'border')}`,
                borderRadius: 16,
                overflow: 'hidden',
                background:
                  theme === 'dark'
                    ? 'radial-gradient(circle at top, rgba(37,99,235,0.18), transparent 45%), #121212'
                    : 'radial-gradient(circle at top, rgba(37,99,235,0.12), transparent 45%), #f8fafc',
              }}
            >
              {isLoading ? (
                <div style={{ height: SVG_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spin size="large" />
                </div>
              ) : positionedNodes.length === 0 ? (
                <div style={{ height: SVG_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty description="当前筛选条件下没有可展示的节点" />
                </div>
              ) : (
                <svg
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: dragStateRef.current.active ? 'grabbing' : 'grab' }}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={stopDragging}
                  onMouseLeave={stopDragging}
                >
                  <defs>
                    <pattern id="kg-grid" width="36" height="36" patternUnits="userSpaceOnUse">
                      <path
                        d="M 36 0 L 0 0 0 36"
                        fill="none"
                        stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.06)'}
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>
                  <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#kg-grid)" />

                  {selectedCommunity && (
                    <text x="28" y="34" fontSize="18" fill={theme === 'dark' ? '#e5e7eb' : '#0f172a'}>
                      社区视图: {selectedCommunity.label}
                    </text>
                  )}

                  <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
                    {links.map((link) => {
                      const source = nodeMap.get(link.source);
                      const target = nodeMap.get(link.target);
                      if (!source || !target) {
                        return null;
                      }

                      const edgeKey = buildKnowledgeGraphEdgeKey(link.source, link.target);
                      const isPathEdge = highlightedEdgeKeySet.has(edgeKey);
                      const isSelectedEdge =
                        !highlightedEdgeKeySet.size &&
                        selectedNodeKey &&
                        (link.source === selectedNodeKey || link.target === selectedNodeKey);
                      const opacity = highlightedEdgeKeySet.size
                        ? (isPathEdge ? 0.95 : 0.08)
                        : selectedNodeKey
                          ? (isSelectedEdge ? 0.85 : 0.12)
                          : 0.35;

                      return (
                        <line
                          key={`${link.source}-${link.target}`}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke={
                            isPathEdge
                              ? (theme === 'dark' ? '#fb923c' : '#ea580c')
                              : theme === 'dark'
                                ? 'rgba(148,163,184,0.55)'
                                : 'rgba(71,85,105,0.35)'
                          }
                          strokeWidth={(isPathEdge ? 3 : 1) + Math.min(link.weight, 4)}
                          opacity={opacity}
                        />
                      );
                    })}

                    {positionedNodes.map((node) => {
                      const color = getNodeTypeColor(node.node_type);
                      const isSelected = selectedNodeKey === node.node_key;
                      const isPathNode = highlightedNodeKeySet.has(node.node_key);
                      const isRelated = highlightedNodeKeySet.size
                        ? highlightedNodeKeySet.has(node.node_key)
                        : selectedNodeKey
                          ? selectedNeighborKeys.has(node.node_key)
                          : true;
                      const opacity = selectedNodeKey || highlightedNodeKeySet.size ? (isRelated ? 1 : 0.16) : 1;
                      const showLabel = isSelected || isPathNode || labelKeys.has(node.node_key);

                      return (
                        <g
                          key={node.node_key}
                          transform={`translate(${node.x}, ${node.y})`}
                          style={{ cursor: 'pointer', opacity }}
                          onClick={() => handleNodeClick(node.node_key)}
                        >
                          <circle
                            r={node.radius + (isSelected ? 7 : isPathNode ? 5 : 0)}
                            fill={isSelected ? `${color}22` : isPathNode ? '#fb923c22' : `${color}18`}
                            stroke="none"
                          />
                          <circle
                            r={node.radius}
                            fill={color}
                            stroke={
                              isPathNode
                                ? (theme === 'dark' ? '#fdba74' : '#ea580c')
                                : isSelected
                                  ? '#f8fafc'
                                  : theme === 'dark'
                                    ? '#020617'
                                    : '#ffffff'
                            }
                            strokeWidth={isSelected || isPathNode ? 3 : 1.5}
                          />
                          {showLabel && (
                            <text
                              x={node.radius + 8}
                              y={4}
                              fontSize={12}
                              fontWeight={isSelected || isPathNode ? 700 : 500}
                              fill={theme === 'dark' ? '#f8fafc' : '#0f172a'}
                            >
                              {node.label.length > 24 ? `${node.label.slice(0, 24)}...` : node.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
            </div>
          </Col>

          <Col xs={24} xl={8}>
            <Card
              size="small"
              title={
                <Space>
                  <NodeIndexOutlined />
                  <span>节点详情</span>
                </Space>
              }
              styles={{ body: { maxHeight: SVG_HEIGHT - 40, overflowY: 'auto' } }}
            >
              {!selectedNodeKey ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="点击图谱中的节点，这里会展示详细关系和相关文章"
                />
              ) : nodeDetailLoading ? (
                <div style={{ padding: '48px 0', textAlign: 'center' }}>
                  <Spin />
                </div>
              ) : (
                <NodeDetailCard
                  detail={nodeDetail}
                  theme={theme}
                  onAsk={handleAskAboutNode}
                  onCommunityClick={(communityId) => focusCommunity(communityId)}
                  onFocusNeighborhood={(depth) => {
                    if (!selectedNodeKey) {
                      return;
                    }
                    setFocusNodeKeys([selectedNodeKey]);
                    setExpandDepth(depth);
                    setHighlightedNodeKeys([]);
                    setHighlightedEdgeKeys([]);
                  }}
                  onNeighborClick={handleNodeClick}
                  onArticleFocus={(articleId) => focusArticle(articleId)}
                />
              )}
            </Card>
          </Col>
        </Row>

        <Space wrap size={[8, 8]}>
          <Tag icon={<BgColorsOutlined />}>节点 {snapshot?.total_nodes || 0}</Tag>
          <Tag>边 {snapshot?.total_links || 0}</Tag>
          <Tag>缩放 {Math.round(viewport.scale * 100)}%</Tag>
          {focusNodeKeys.length > 0 && <Tag icon={<AimOutlined />}>聚焦节点 {focusNodeKeys.length}</Tag>}
          {highlightedEdgeKeys.length > 0 && <Tag color="orange">路径高亮</Tag>}
          <Tag>生成时间 {snapshot?.generated_at ? new Date(snapshot.generated_at).toLocaleString() : '-'}</Tag>
          {snapshot?.build?.sync_mode && <Tag>构建模式 {snapshot.build.sync_mode}</Tag>}
        </Space>
      </Space>
    </Card>
  );
}

function NodeDetailCard({
  detail,
  theme,
  onAsk,
  onCommunityClick,
  onFocusNeighborhood,
  onNeighborClick,
  onArticleFocus,
}: {
  detail?: KnowledgeGraphNodeDetail;
  theme: 'light' | 'dark';
  onAsk: (mode: AIQueryEngine) => void;
  onCommunityClick: (communityId: number) => void;
  onFocusNeighborhood: (depth: number) => void;
  onNeighborClick: (nodeKey: string) => void;
  onArticleFocus: (articleId: number) => void;
}) {
  if (!detail) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="当前节点详情不可用"
      />
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
          {detail.node.label}
        </Title>
        <Text type="secondary">{detail.node.node_key}</Text>
      </div>

      <Space wrap size={[8, 8]}>
        <Tag color="blue">{detail.node.node_type}</Tag>
        <Tag>度数 {detail.node.degree}</Tag>
        <Tag>文章 {detail.node.article_count}</Tag>
        {detail.node.community_id !== null && detail.node.community_id !== undefined && (
          <Tag>社区 {detail.node.community_id}</Tag>
        )}
      </Space>

      <Space wrap>
        <Button type="primary" icon={<CommentOutlined />} onClick={() => onAsk('graph')}>
          Graph 问答
        </Button>
        <Button onClick={() => onAsk('hybrid')}>Hybrid 问答</Button>
        <Button icon={<AimOutlined />} onClick={() => onFocusNeighborhood(1)}>
          1 跳邻域
        </Button>
        <Button onClick={() => onFocusNeighborhood(2)}>2 跳邻域</Button>
      </Space>

      {detail.matched_communities.length > 0 && (
        <div>
          <Text strong>所在社区</Text>
          <div style={{ marginTop: 8 }}>
            {detail.matched_communities.map((community: KnowledgeGraphCommunitySummary) => (
              <Tag
                key={community.community_id}
                color="purple"
                style={{ cursor: 'pointer' }}
                onClick={() => onCommunityClick(community.community_id)}
              >
                {community.label}
              </Tag>
            ))}
          </div>
        </div>
      )}

      <div>
        <Text strong>邻居节点</Text>
        <List
          size="small"
          dataSource={detail.neighbors}
          locale={{ emptyText: '暂无邻居节点' }}
          renderItem={(neighbor) => (
            <List.Item
              actions={[
                <Button
                  key="focus-neighbor"
                  type="link"
                  size="small"
                  onClick={() => onNeighborClick(neighbor.node_key)}
                >
                  聚焦
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text>{neighbor.label}</Text>
                <Text type="secondary">{neighbor.node_type}</Text>
              </Space>
            </List.Item>
          )}
        />
      </div>

      <div>
        <Text strong>关系</Text>
        <List
          size="small"
          dataSource={detail.edges}
          locale={{ emptyText: '暂无边关系' }}
          renderItem={(edge) => (
            <List.Item>
              <Paragraph style={{ marginBottom: 0 }}>
                {edge.source_node_key} --{edge.relation_type}--&gt; {edge.target_node_key}
              </Paragraph>
            </List.Item>
          )}
        />
      </div>

      <div>
        <Text strong>相关文章</Text>
        <List
          size="small"
          dataSource={detail.related_articles}
          locale={{ emptyText: '暂无相关文章' }}
          renderItem={(article) => (
            <List.Item
              actions={[
                <Button
                  key="focus-article"
                  type="link"
                  size="small"
                  onClick={() => onArticleFocus(article.id)}
                >
                  图谱定位
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <a href={article.url} target="_blank" rel="noreferrer">
                  {article.title_zh || article.title}
                </a>
                <Text type="secondary">
                  {article.source} · 关系数 {article.relation_count}
                </Text>
              </Space>
            </List.Item>
          )}
        />
      </div>
    </Space>
  );
}
