import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AimOutlined,
  BgColorsOutlined,
  CloseOutlined,
  CommentOutlined,
  FullscreenExitOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import KnowledgeGraphCanvas, {
  COMMUNITY_PALETTE,
  type KnowledgeGraphViewportState,
} from '@/components/KnowledgeGraphCanvas';
import { apiService } from '@/services/api';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import {
  buildNodeQuestion,
  selectVisibleKnowledgeGraphLabelKeys,
} from '@/utils/knowledgeGraph';
import type {
  AIQueryEngine,
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphNodeDetail,
  KnowledgeGraphSnapshotResponse,
} from '@/types';

const { Text, Title } = Typography;

const MIN_SCALE = 0.45;
const MAX_SCALE = 3.2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDefaultViewport(): KnowledgeGraphViewportState {
  return { scale: 1, x: 0, y: 0 };
}

export interface KnowledgeGraphExplorerProps {
  searchTerm: string;
  nodeTypeFilter?: string;
  communityFilter?: number;
  limitNodes: number;
  onSnapshotChange?: (snapshot: KnowledgeGraphSnapshotResponse | undefined) => void;
}

export default function KnowledgeGraphExplorer({
  searchTerm,
  nodeTypeFilter,
  communityFilter,
  limitNodes,
  onSnapshotChange,
}: KnowledgeGraphExplorerProps) {
  const { theme } = useTheme();
  const { openModal, setSelectedEngine } = useAIConversation();
  const { graphCommand, focusArticle, focusCommunity } = useKnowledgeGraphView();

  const [selectedNodeKey, setSelectedNodeKey] = useState<string>();
  const [focusNodeKeys, setFocusNodeKeys] = useState<string[]>([]);
  const [expandDepth, setExpandDepth] = useState(0);
  const [highlightedNodeKeys, setHighlightedNodeKeys] = useState<string[]>([]);
  const [highlightedEdgeKeys, setHighlightedEdgeKeys] = useState<string[]>([]);
  const [viewport, setViewport] = useState<KnowledgeGraphViewportState>(getDefaultViewport);
  const [showLegend, setShowLegend] = useState(false);

  const resetViewport = useCallback(() => setViewport(getDefaultViewport()), []);

  // Apply graph navigation commands (canvas-related state only)
  useEffect(() => {
    if (!graphCommand?.id) return;
    setSelectedNodeKey(graphCommand.selectedNodeKey);
    setFocusNodeKeys(graphCommand.focusNodeKeys);
    setExpandDepth(graphCommand.expandDepth);
    setHighlightedNodeKeys(graphCommand.highlightedNodeKeys);
    setHighlightedEdgeKeys(graphCommand.highlightedEdgeKeys);
    resetViewport();
  }, [graphCommand?.id, resetViewport]);

  const { data: snapshot, isLoading, isFetching } = useQuery({
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

  useEffect(() => {
    onSnapshotChange?.(snapshot);
  }, [onSnapshotChange, snapshot]);

  const { data: nodeDetail, isLoading: nodeDetailLoading } = useQuery({
    queryKey: ['knowledge-graph-node-detail', selectedNodeKey],
    queryFn: () => apiService.getKnowledgeGraphNode(selectedNodeKey!),
    enabled: Boolean(selectedNodeKey),
  });

  const nodes = snapshot?.nodes || [];
  const links = snapshot?.links || [];
  const communities = snapshot?.communities || [];

  // Clear selection when node disappears from snapshot
  useEffect(() => {
    if (!selectedNodeKey || !snapshot) return;
    const exists = nodes.some((node) => node.node_key === selectedNodeKey);
    if (!exists) setSelectedNodeKey(undefined);
  }, [nodes, selectedNodeKey, snapshot]);

  const highlightedEdgeKeySet = useMemo(() => new Set(highlightedEdgeKeys), [highlightedEdgeKeys]);

  const selectedNeighborKeys = useMemo(() => {
    if (!selectedNodeKey) return new Set<string>();
    const keys = new Set<string>([selectedNodeKey]);
    for (const link of links) {
      if (link.source === selectedNodeKey) keys.add(link.target);
      if (link.target === selectedNodeKey) keys.add(link.source);
    }
    return keys;
  }, [links, selectedNodeKey]);

  const labelKeys = useMemo(
    () =>
      selectVisibleKnowledgeGraphLabelKeys(nodes, {
        selectedNodeKey,
        focusNodeKeys,
        highlightedNodeKeys,
        selectedNeighborKeys,
        viewportScale: viewport.scale,
      }),
    [focusNodeKeys, highlightedNodeKeys, nodes, selectedNeighborKeys, selectedNodeKey, viewport.scale]
  );

  const selectedCommunity = useMemo(
    () => communities.find((community) => community.community_id === communityFilter),
    [communities, communityFilter]
  );

  const clearExplorerState = useCallback(() => {
    setSelectedNodeKey(undefined);
    setFocusNodeKeys([]);
    setExpandDepth(0);
    setHighlightedNodeKeys([]);
    setHighlightedEdgeKeys([]);
    resetViewport();
  }, [resetViewport]);

  const handleNodeClick = useCallback(
    (nodeKey: string) => {
      setSelectedNodeKey(nodeKey);
      setHighlightedNodeKeys([]);
      setHighlightedEdgeKeys([]);
      if (expandDepth > 0) setFocusNodeKeys([nodeKey]);
    },
    [expandDepth]
  );

  const handleAskAboutNode = useCallback(
    (mode: AIQueryEngine) => {
      if (!nodeDetail?.node) return;
      setSelectedEngine(mode);
      openModal(buildNodeQuestion(nodeDetail.node, mode));
    },
    [nodeDetail?.node, openModal, setSelectedEngine]
  );

  const cycleExpandDepth = useCallback(() => {
    const next = (expandDepth + 1) % 3;
    setExpandDepth(next);
    if (next > 0) {
      const anchor = selectedNodeKey || focusNodeKeys[0];
      if (anchor) setFocusNodeKeys([anchor]);
    }
  }, [expandDepth, focusNodeKeys, selectedNodeKey]);

  // View state label for status bar
  const viewStateLabel = useMemo(() => {
    if (highlightedEdgeKeys.length > 0) return '路径高亮中';
    if (focusNodeKeys.length > 0) {
      if (expandDepth === 1) return `1跳邻域`;
      if (expandDepth === 2) return `2跳邻域`;
      return '节点聚焦';
    }
    if (communityFilter !== undefined) return `社区视图`;
    return '全局视图';
  }, [communityFilter, expandDepth, focusNodeKeys.length, highlightedEdgeKeys.length]);

  const expandDepthLabel = expandDepth === 0 ? '聚焦' : `${expandDepth}跳邻域`;

  const borderColor = getThemeColor(theme, 'border');
  const textColor = getThemeColor(theme, 'text');
  const textSecondary = getThemeColor(theme, 'textSecondary');
  const bgColor = theme === 'dark' ? 'rgba(9, 11, 15, 0.85)' : 'rgba(255, 255, 255, 0.85)';
  const panelBg = theme === 'dark' ? '#0f1117' : '#ffffff';

  const detailPanelOpen = Boolean(selectedNodeKey);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* Canvas area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {isLoading ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: theme === 'dark' ? '#090b0f' : '#f6f8fb',
            }}
          >
            <Spin size="large" tip="加载图谱..." />
          </div>
        ) : nodes.length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: theme === 'dark' ? '#090b0f' : '#f6f8fb',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <Empty description="当前筛选条件下没有可展示的节点" />
              <Button style={{ marginTop: 12 }} onClick={clearExplorerState}>
                恢复全图
              </Button>
            </div>
          </div>
        ) : (
          <KnowledgeGraphCanvas
            nodes={nodes}
            links={links}
            theme={theme}
            selectedNodeKey={selectedNodeKey}
            selectedCommunity={selectedCommunity}
            focusNodeKeys={focusNodeKeys}
            highlightedNodeKeys={highlightedNodeKeys}
            highlightedEdgeKeys={highlightedEdgeKeySet}
            selectedNeighborKeys={selectedNeighborKeys}
            labelKeys={labelKeys}
            viewport={viewport}
            onViewportChange={setViewport}
            onNodeClick={handleNodeClick}
          />
        )}

        {/* Floating toolbar */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '8px 4px',
            borderRadius: 20,
            border: `1px solid ${borderColor}`,
            background: bgColor,
            backdropFilter: 'blur(12px)',
            boxShadow: theme === 'dark'
              ? '0 4px 20px rgba(0,0,0,0.4)'
              : '0 4px 16px rgba(15,23,42,0.12)',
            zIndex: 10,
          }}
        >
          <Tooltip title="放大" placement="left">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() =>
                setViewport((prev) => ({ ...prev, scale: clamp(prev.scale + 0.12, MIN_SCALE, MAX_SCALE) }))
              }
            />
          </Tooltip>
          <Tooltip title="缩小" placement="left">
            <Button
              type="text"
              size="small"
              icon={<MinusOutlined />}
              onClick={() =>
                setViewport((prev) => ({ ...prev, scale: clamp(prev.scale - 0.12, MIN_SCALE, MAX_SCALE) }))
              }
            />
          </Tooltip>
          <Tooltip title="重置视图" placement="left">
            <Button
              type="text"
              size="small"
              icon={<FullscreenExitOutlined />}
              onClick={resetViewport}
            />
          </Tooltip>
          <Tooltip title="恢复全图" placement="left">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={clearExplorerState}
            />
          </Tooltip>
          <div style={{ width: 24, height: 1, background: borderColor, margin: '2px auto' }} />
          <Tooltip title={showLegend ? '关闭图例' : '显示社区图例'} placement="left">
            <Button
              type={showLegend ? 'primary' : 'text'}
              size="small"
              icon={<BgColorsOutlined />}
              onClick={() => setShowLegend((prev) => !prev)}
            />
          </Tooltip>
          <Tooltip title={`邻域深度：${expandDepthLabel}`} placement="left">
            <Button
              type={expandDepth > 0 ? 'primary' : 'text'}
              size="small"
              style={{ fontSize: 11, padding: '0 4px' }}
              onClick={cycleExpandDepth}
            >
              {expandDepth === 0 ? '全' : expandDepth === 1 ? '1跳' : '2跳'}
            </Button>
          </Tooltip>
          {isFetching && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
              <Spin size="small" />
            </div>
          )}
        </div>

        {/* Color legend overlay */}
        {showLegend && communities.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 36,
              left: 12,
              maxWidth: 220,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${borderColor}`,
              background: bgColor,
              backdropFilter: 'blur(12px)',
              boxShadow: theme === 'dark'
                ? '0 4px 20px rgba(0,0,0,0.4)'
                : '0 4px 16px rgba(15,23,42,0.12)',
              zIndex: 10,
            }}
          >
            <Text style={{ fontSize: 11, color: textSecondary, display: 'block', marginBottom: 8, fontWeight: 600 }}>
              社区图例
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {communities.slice(0, 12).map((community) => {
                const color = COMMUNITY_PALETTE[Math.abs(community.community_id) % COMMUNITY_PALETTE.length];
                return (
                  <div key={community.community_id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <Text style={{ fontSize: 11, color: textColor, lineHeight: '14px' }}>
                      {community.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: textSecondary, marginLeft: 'auto', flexShrink: 0 }}>
                      {community.node_count}
                    </Text>
                  </div>
                );
              })}
              {communities.length > 12 && (
                <Text style={{ fontSize: 10, color: textSecondary }}>
                  +{communities.length - 12} 个社区...
                </Text>
              )}
            </div>
          </div>
        )}

        {/* Canvas status bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 8,
            background: theme === 'dark' ? 'rgba(9,11,15,0.75)' : 'rgba(246,248,251,0.82)',
            backdropFilter: 'blur(8px)',
            borderTop: `1px solid ${borderColor}`,
            zIndex: 10,
          }}
        >
          <Text style={{ fontSize: 11, color: textSecondary }}>
            缩放 {Math.round(viewport.scale * 100)}%
          </Text>
          <Text style={{ fontSize: 11, color: textSecondary }}>·</Text>
          <Text style={{ fontSize: 11, color: textSecondary }}>
            节点 {nodes.length}{snapshot?.total_nodes && snapshot.total_nodes > nodes.length ? `/${snapshot.total_nodes}` : ''}
          </Text>
          <Text style={{ fontSize: 11, color: textSecondary }}>·</Text>
          <Text style={{ fontSize: 11, color: textSecondary }}>边 {links.length}</Text>
          {focusNodeKeys.length > 0 && (
            <>
              <Text style={{ fontSize: 11, color: textSecondary }}>·</Text>
              <Tag
                color={highlightedEdgeKeys.length > 0 ? 'orange' : 'geekblue'}
                style={{ fontSize: 10, lineHeight: '16px', height: 18, padding: '0 6px' }}
              >
                {viewStateLabel}
              </Tag>
            </>
          )}
          {!focusNodeKeys.length && communityFilter !== undefined && (
            <>
              <Text style={{ fontSize: 11, color: textSecondary }}>·</Text>
              <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', height: 18, padding: '0 6px' }}>
                {viewStateLabel}
              </Tag>
            </>
          )}
          {!focusNodeKeys.length && communityFilter === undefined && (
            <>
              <Text style={{ fontSize: 11, color: textSecondary }}>·</Text>
              <Text style={{ fontSize: 11, color: textSecondary }}>全局视图</Text>
            </>
          )}
        </div>
      </div>

      {/* Right detail panel - slides in/out */}
      <div
        style={{
          width: detailPanelOpen ? 300 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 240ms ease-out',
          borderLeft: detailPanelOpen ? `1px solid ${borderColor}` : 'none',
          background: panelBg,
        }}
      >
        <div style={{ width: 300, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Panel header */}
          <div
            style={{
              height: 44,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px 0 16px',
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            <Text strong style={{ color: textColor, fontSize: 13 }}>节点详情</Text>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setSelectedNodeKey(undefined)}
            />
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {nodeDetailLoading ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <Spin />
              </div>
            ) : (
              <NodeDetailContent
                detail={nodeDetail}
                theme={theme}
                onAsk={handleAskAboutNode}
                onCommunityClick={(communityId) => focusCommunity(communityId)}
                onFocusNeighborhood={(depth) => {
                  if (!selectedNodeKey) return;
                  setFocusNodeKeys([selectedNodeKey]);
                  setExpandDepth(depth);
                  setHighlightedNodeKeys([]);
                  setHighlightedEdgeKeys([]);
                }}
                onNeighborClick={handleNodeClick}
                onArticleFocus={(articleId) => focusArticle(articleId)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeDetailContent({
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
  const textColor = getThemeColor(theme, 'text');

  if (!detail) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="节点详情不可用" />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <div>
        <Title level={5} style={{ margin: 0, color: textColor, wordBreak: 'break-word' }}>
          {detail.node.label}
        </Title>
        <Text type="secondary" style={{ fontSize: 11 }}>{detail.node.node_key}</Text>
      </div>

      <Space wrap size={[6, 6]}>
        <Tag color="blue">{detail.node.node_type}</Tag>
        <Tag>度 {detail.node.degree}</Tag>
        <Tag>文章 {detail.node.article_count}</Tag>
        {detail.node.community_id != null && (
          <Tag>社区 {detail.node.community_id}</Tag>
        )}
      </Space>

      <Space wrap size={[6, 6]}>
        <Button size="small" type="primary" icon={<CommentOutlined />} onClick={() => onAsk('graph')}>
          Graph
        </Button>
        <Button size="small" onClick={() => onAsk('hybrid')}>Hybrid</Button>
        <Button size="small" icon={<AimOutlined />} onClick={() => onFocusNeighborhood(1)}>
          1跳
        </Button>
        <Button size="small" onClick={() => onFocusNeighborhood(2)}>2跳</Button>
      </Space>

      {detail.matched_communities.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 12, color: textColor }}>所在社区</Text>
          <div style={{ marginTop: 6 }}>
            {detail.matched_communities.map((community: KnowledgeGraphCommunitySummary) => (
              <Tag
                key={community.community_id}
                color="purple"
                style={{ cursor: 'pointer', marginBottom: 4 }}
                onClick={() => onCommunityClick(community.community_id)}
              >
                {community.label}
              </Tag>
            ))}
          </div>
        </div>
      )}

      <div>
        <Text strong style={{ fontSize: 12, color: textColor }}>邻居节点</Text>
        <List
          size="small"
          style={{ marginTop: 4 }}
          dataSource={detail.neighbors.slice(0, 12)}
          locale={{ emptyText: '暂无邻居节点' }}
          renderItem={(neighbor) => (
            <List.Item
              style={{ padding: '4px 0' }}
              actions={[
                <Button
                  key="focus"
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => onNeighborClick(neighbor.node_key)}
                >
                  聚焦
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text style={{ fontSize: 12, color: textColor }}>{neighbor.label}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{neighbor.node_type}</Text>
              </Space>
            </List.Item>
          )}
        />
      </div>

      <div>
        <Text strong style={{ fontSize: 12, color: textColor }}>关系</Text>
        <List
          size="small"
          style={{ marginTop: 4 }}
          dataSource={detail.edges.slice(0, 10)}
          locale={{ emptyText: '暂无边关系' }}
          renderItem={(edge) => (
            <List.Item style={{ padding: '3px 0' }}>
              <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {edge.source_node_key}{' '}
                <Tag style={{ fontSize: 10, padding: '0 4px' }}>{edge.relation_type}</Tag>{' '}
                {edge.target_node_key}
              </Text>
            </List.Item>
          )}
        />
      </div>

      <div>
        <Text strong style={{ fontSize: 12, color: textColor }}>相关文章</Text>
        <List
          size="small"
          style={{ marginTop: 4 }}
          dataSource={detail.related_articles.slice(0, 8)}
          locale={{ emptyText: '暂无相关文章' }}
          renderItem={(article) => (
            <List.Item
              style={{ padding: '4px 0' }}
              actions={[
                <Button
                  key="focus"
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => onArticleFocus(article.id)}
                >
                  定位
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: textColor, display: 'block', lineHeight: '1.4' }}
                >
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
    </Space>
  );
}
