import { useCallback, useEffect, useMemo, useState } from 'react';
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

import KnowledgeGraphCanvas, {
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
} from '@/types';

const { Search } = Input;
const { Paragraph, Text, Title } = Typography;

const MIN_SCALE = 0.45;
const MAX_SCALE = 3.2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDefaultViewport(): KnowledgeGraphViewportState {
  return { scale: 1, x: 0, y: 0 };
}

export default function KnowledgeGraphExplorer() {
  const { theme } = useTheme();
  const { openModal, setSelectedEngine } = useAIConversation();
  const { graphCommand, focusArticle, focusCommunity } = useKnowledgeGraphView();

  const [searchTerm, setSearchTerm] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>();
  const [communityFilter, setCommunityFilter] = useState<number>();
  const [limitNodes, setLimitNodes] = useState(160);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>();
  const [focusNodeKeys, setFocusNodeKeys] = useState<string[]>([]);
  const [expandDepth, setExpandDepth] = useState(0);
  const [highlightedNodeKeys, setHighlightedNodeKeys] = useState<string[]>([]);
  const [highlightedEdgeKeys, setHighlightedEdgeKeys] = useState<string[]>([]);
  const [viewport, setViewport] = useState<KnowledgeGraphViewportState>(getDefaultViewport);

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
      selectVisibleKnowledgeGraphLabelKeys(nodes, {
        selectedNodeKey,
        focusNodeKeys,
        highlightedNodeKeys,
        selectedNeighborKeys,
        viewportScale: viewport.scale,
      }),
    [focusNodeKeys, highlightedNodeKeys, nodes, selectedNeighborKeys, selectedNodeKey, viewport.scale]
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
            options={[80, 160, 300, 500].map((value) => ({
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
            {isLoading ? (
              <div
                style={{
                  height: 560,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${getThemeColor(theme, 'border')}`,
                  borderRadius: 10,
                }}
              >
                <Spin size="large" />
              </div>
            ) : nodes.length === 0 ? (
              <div
                style={{
                  height: 560,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${getThemeColor(theme, 'border')}`,
                  borderRadius: 10,
                }}
              >
                <Empty description="当前筛选条件下没有可展示的节点" />
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
              styles={{ body: { maxHeight: 640, overflowY: 'auto' } }}
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
          {snapshot?.layout_mode && <Tag color="geekblue">力导画布</Tag>}
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
