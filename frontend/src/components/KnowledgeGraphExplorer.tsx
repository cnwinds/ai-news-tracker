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

type HoverPreviewState = {
  node: PositionedNode;
  x: number;
  y: number;
};

const SVG_WIDTH = 980;
const SVG_HEIGHT = 620;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const HOVER_CARD_WIDTH = 280;
const MAX_DEFAULT_LABELS = 12;
const MAX_ACTIVE_LABELS = 10;
const LAYOUT_PADDING_X = 72;
const LAYOUT_PADDING_Y = 64;

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


function hasLayoutCoordinates(
  node: KnowledgeGraphNodeSummary
): node is KnowledgeGraphNodeSummary & { layout_x: number; layout_y: number } {
  return Number.isFinite(node.layout_x) && Number.isFinite(node.layout_y);
}

function getNodeRadius(node: KnowledgeGraphNodeSummary) {
  return 10 + Math.min(Math.sqrt(Math.max(node.degree, 1)) * 3, 12);
}

function computeLayout(nodes: KnowledgeGraphNodeSummary[]): PositionedNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const layoutNodes = nodes.filter(hasLayoutCoordinates);
  const fallbackNodes = nodes.filter((node) => !hasLayoutCoordinates(node));

  // 将已有坐标的节点按比例映射到画布，填满左侧约 70% 宽度
  const LAYOUT_AREA_RIGHT = fallbackNodes.length > 0 ? SVG_WIDTH * 0.68 : SVG_WIDTH;

  const positioned: PositionedNode[] = [];

  if (layoutNodes.length > 0) {
    if (layoutNodes.length === 1) {
      positioned.push({
        ...layoutNodes[0],
        x: LAYOUT_AREA_RIGHT / 2,
        y: SVG_HEIGHT / 2,
        radius: getNodeRadius(layoutNodes[0]),
      });
    } else {
      const xValues = layoutNodes.map((node) => node.layout_x);
      const yValues = layoutNodes.map((node) => node.layout_y);
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);
      const spanX = Math.max(maxX - minX, 0.001);
      const spanY = Math.max(maxY - minY, 0.001);
      const scale = Math.min(
        (LAYOUT_AREA_RIGHT - LAYOUT_PADDING_X * 2) / spanX,
        (SVG_HEIGHT - LAYOUT_PADDING_Y * 2) / spanY
      );
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      for (const node of layoutNodes) {
        positioned.push({
          ...node,
          x: LAYOUT_AREA_RIGHT / 2 + (node.layout_x - centerX) * scale,
          y: SVG_HEIGHT / 2 + (node.layout_y - centerY) * scale,
          radius: getNodeRadius(node),
        });
      }
    }
  }

  // 没有后端坐标的节点用社区轨道布局，紧凑排在右侧余量区
  if (fallbackNodes.length > 0) {
    const groups = new Map<number | 'unclustered', KnowledgeGraphNodeSummary[]>();
    for (const node of fallbackNodes) {
      const key = node.community_id ?? 'unclustered';
      const existing = groups.get(key) || [];
      existing.push(node);
      groups.set(key, existing);
    }

    const fallbackAreaWidth = SVG_WIDTH - LAYOUT_AREA_RIGHT;
    const fallbackCenterX = LAYOUT_AREA_RIGHT + fallbackAreaWidth / 2;
    const communities = Array.from(groups.keys());
    const radius = Math.min(fallbackAreaWidth * 0.42, 80 + communities.length * 12);

    const communityCenters = new Map(
      communities.map((community, index) => {
        if (communities.length === 1) {
          return [community, { x: fallbackCenterX, y: SVG_HEIGHT / 2 }] as const;
        }
        const angle = (Math.PI * 2 * index) / communities.length - Math.PI / 2;
        return [community, {
          x: fallbackCenterX + Math.cos(angle) * radius * 0.6,
          y: SVG_HEIGHT / 2 + Math.sin(angle) * radius * 0.5,
        }] as const;
      })
    );

    for (const [groupKey, groupNodes] of groups.entries()) {
      const center = communityCenters.get(groupKey)!;
      const ordered = [...groupNodes].sort((l, r) => r.degree - l.degree || l.label.localeCompare(r.label));
      if (ordered.length === 1) {
        positioned.push({ ...ordered[0], x: center.x, y: center.y, radius: getNodeRadius(ordered[0]) });
        continue;
      }
      ordered.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / ordered.length - Math.PI / 2;
        const orbital = 18 + Math.sqrt(index + 1) * 10;
        const communityScale = 1 + ordered.length / 20;
        positioned.push({
          ...node,
          x: center.x + Math.cos(angle) * orbital * communityScale,
          y: center.y + Math.sin(angle) * orbital * Math.max(0.8, communityScale * 0.75),
          radius: getNodeRadius(node),
        });
      });
    }
  }

  return positioned;
}

function getDefaultViewport(): ViewportState {
  return { scale: 1, x: 0, y: 0 };
}

function formatCentrality(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function selectVisibleLabelKeys(
  nodes: PositionedNode[],
  {
    selectedNodeKey,
    focusNodeKeys,
    highlightedNodeKeys,
    selectedNeighborKeys,
  }: {
    selectedNodeKey?: string;
    focusNodeKeys: string[];
    highlightedNodeKeys: string[];
    selectedNeighborKeys: Set<string>;
  }
) {
  if (nodes.length === 0) {
    return new Set<string>();
  }

  const highlightedSet = new Set(highlightedNodeKeys);
  const focusSet = new Set(focusNodeKeys);
  const pinnedKeys = new Set<string>();

  if (selectedNodeKey) {
    pinnedKeys.add(selectedNodeKey);
  }
  if (focusNodeKeys.length > 0) {
    pinnedKeys.add(focusNodeKeys[0]);
    pinnedKeys.add(focusNodeKeys[focusNodeKeys.length - 1]);
  }

  const scoreNode = (node: PositionedNode) => {
    let score = node.centrality * 100 + node.degree * 6 + node.article_count * 4;
    if (node.node_key === selectedNodeKey) score += 2000;
    if (highlightedSet.has(node.node_key)) score += 1200;
    if (focusSet.has(node.node_key)) score += 900;
    if (selectedNeighborKeys.has(node.node_key)) score += 280;
    if (pinnedKeys.has(node.node_key)) score += 1600;
    return score;
  };

  const compareNodes = (left: PositionedNode, right: PositionedNode) =>
    scoreNode(right) - scoreNode(left)
      || right.degree - left.degree
      || right.centrality - left.centrality
      || left.label.localeCompare(right.label);

  const activeNodeKeys = new Set<string>([
    ...focusNodeKeys,
    ...highlightedNodeKeys,
    ...Array.from(selectedNeighborKeys),
    ...(selectedNodeKey ? [selectedNodeKey] : []),
  ]);

  if (activeNodeKeys.size > 0) {
    const activeNodes = nodes.filter((node) => activeNodeKeys.has(node.node_key));
    const labelBudget = activeNodes.length <= 6
      ? activeNodes.length
      : Math.min(MAX_ACTIVE_LABELS, Math.max(5, Math.ceil(Math.sqrt(activeNodes.length) * 2)));
    const labelKeys = new Set<string>(pinnedKeys);

    activeNodes
      .sort(compareNodes)
      .slice(0, labelBudget)
      .forEach((node) => labelKeys.add(node.node_key));

    return labelKeys;
  }

  return new Set(
    [...nodes]
      .sort(compareNodes)
      .slice(0, MAX_DEFAULT_LABELS)
      .map((node) => node.node_key)
  );
}

function getNodeMetadataPreview(node: PositionedNode) {
  const metadataEntries = Object.entries(node.metadata || {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .filter(([, value]) => String(value).trim().length > 0);

  const preferredKeys = ['title', 'summary', 'description', 'source', 'published_at', 'author'];
  const preferredEntries = preferredKeys
    .map((key) => metadataEntries.find(([entryKey]) => entryKey === key))
    .filter((entry): entry is [string, string | number | boolean] => Boolean(entry));
  const remainingEntries = metadataEntries.filter(
    ([key]) => !preferredKeys.includes(key)
  );

  return [...preferredEntries, ...remainingEntries].slice(0, 3);
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
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

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
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);

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
    setHoverPreview(null);
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

  const labelKeys = useMemo(
    () =>
      selectVisibleLabelKeys(positionedNodes, {
        selectedNodeKey,
        focusNodeKeys,
        highlightedNodeKeys,
        selectedNeighborKeys,
      }),
    [focusNodeKeys, highlightedNodeKeys, positionedNodes, selectedNeighborKeys, selectedNodeKey]
  );

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
    setHoverPreview(null);
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

  const handleWheelZoom = useCallback((deltaY: number) => {
    setViewport((previous) => ({
      ...previous,
      scale: clamp(previous.scale + (deltaY < 0 ? 0.14 : -0.14), MIN_SCALE, MAX_SCALE),
    }));
  }, []);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container || isLoading || positionedNodes.length === 0) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handleWheelZoom(event.deltaY);
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, [handleWheelZoom, isLoading, positionedNodes.length]);

  const handleMouseDown = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    setHoverPreview(null);
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

  const updateHoverPreview = useCallback((
    event: React.MouseEvent<SVGGElement>,
    node: PositionedNode
  ) => {
    const container = canvasContainerRef.current;
    if (!container || dragStateRef.current.active) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left + 18, 12, Math.max(12, rect.width - HOVER_CARD_WIDTH - 12));
    const y = clamp(event.clientY - rect.top + 18, 12, Math.max(12, rect.height - 168));

    setHoverPreview({
      node,
      x,
      y,
    });
  }, []);

  const clearHoverPreview = useCallback(() => {
    setHoverPreview(null);
  }, []);

  const hoverMetadataPreview = hoverPreview ? getNodeMetadataPreview(hoverPreview.node) : [];

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
              ref={canvasContainerRef}
              style={{
                position: 'relative',
                border: `1px solid ${getThemeColor(theme, 'border')}`,
                borderRadius: 16,
                overflow: 'hidden',
                overscrollBehavior: 'contain',
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
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={stopDragging}
                  onMouseLeave={() => {
                    stopDragging();
                    clearHoverPreview();
                  }}
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
                          data-node-key={node.node_key}
                          transform={`translate(${node.x}, ${node.y})`}
                          style={{ cursor: 'pointer', opacity }}
                          onClick={() => handleNodeClick(node.node_key)}
                          onMouseEnter={(event) => updateHoverPreview(event, node)}
                          onMouseMove={(event) => updateHoverPreview(event, node)}
                          onMouseLeave={clearHoverPreview}
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

              {hoverPreview && (
                <div
                  style={{
                    position: 'absolute',
                    left: hoverPreview.x,
                    top: hoverPreview.y,
                    width: HOVER_CARD_WIDTH,
                    padding: 14,
                    borderRadius: 14,
                    border: `1px solid ${getThemeColor(theme, 'border')}`,
                    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.96)' : 'rgba(255, 255, 255, 0.96)',
                    boxShadow: theme === 'dark'
                      ? '0 18px 40px rgba(0, 0, 0, 0.36)'
                      : '0 18px 40px rgba(15, 23, 42, 0.16)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <div>
                      <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                        节点预览
                      </Text>
                      <Title level={5} style={{ margin: '6px 0 0', color: getThemeColor(theme, 'text') }}>
                        {hoverPreview.node.label}
                      </Title>
                    </div>

                    <Space wrap size={[8, 8]}>
                      <Tag color="blue">{hoverPreview.node.node_type}</Tag>
                      <Tag>度数 {hoverPreview.node.degree}</Tag>
                      <Tag>文章 {hoverPreview.node.article_count}</Tag>
                      {hoverPreview.node.community_id !== null && hoverPreview.node.community_id !== undefined && (
                        <Tag>社区 {hoverPreview.node.community_id}</Tag>
                      )}
                    </Space>

                    <Text type="secondary">{hoverPreview.node.node_key}</Text>
                    <Text type="secondary">中心性 {formatCentrality(hoverPreview.node.centrality)}</Text>

                    {hoverPreview.node.aliases.length > 0 && (
                      <div>
                        <Text strong>别名</Text>
                        <div style={{ marginTop: 6 }}>
                          {hoverPreview.node.aliases.slice(0, 4).map((alias) => (
                            <Tag key={alias}>{alias}</Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {hoverMetadataPreview.length > 0 && (
                      <div>
                        <Text strong>内容摘要</Text>
                        <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                          {hoverMetadataPreview.map(([key, value]) => (
                            <Text key={key} type="secondary">
                              {key}: {String(value)}
                            </Text>
                          ))}
                        </Space>
                      </div>
                    )}
                  </Space>
                </div>
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
          {snapshot?.layout_mode && <Tag color="geekblue">距离布局</Tag>}
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
