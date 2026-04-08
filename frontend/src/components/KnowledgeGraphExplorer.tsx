import { useMemo, useState } from 'react';
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
import { BgColorsOutlined, NodeIndexOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { apiService } from '@/services/api';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import type {
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

const SVG_WIDTH = 980;
const SVG_HEIGHT = 620;

const PALETTE = ['#0f766e', '#2563eb', '#dc2626', '#ca8a04', '#7c3aed', '#ea580c', '#0891b2', '#4f46e5'];

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

export default function KnowledgeGraphExplorer() {
  const { theme } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>();
  const [communityFilter, setCommunityFilter] = useState<number>();
  const [limitNodes, setLimitNodes] = useState(80);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>();

  const { data: snapshot, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['knowledge-graph-snapshot', searchTerm, nodeTypeFilter, communityFilter, limitNodes],
    queryFn: () =>
      apiService.getKnowledgeGraphSnapshot({
        q: searchTerm.trim() || undefined,
        node_type: nodeTypeFilter || undefined,
        community_id: communityFilter,
        limit_nodes: limitNodes,
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

  const positionedNodes = useMemo(() => computeLayout(nodes), [nodes]);

  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.node_key, node])),
    [positionedNodes]
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

  return (
    <Card
      title="图谱画布"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
          刷新画布
        </Button>
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
          <Button
            onClick={() => {
              setSearchTerm('');
              setNodeTypeFilter(undefined);
              setCommunityFilter(undefined);
              setSelectedNodeKey(undefined);
            }}
          >
            清空筛选
          </Button>
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
                <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} style={{ width: '100%', height: '100%', display: 'block' }}>
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

                  {links.map((link) => {
                    const source = nodeMap.get(link.source);
                    const target = nodeMap.get(link.target);
                    if (!source || !target) {
                      return null;
                    }

                    const isHighlighted =
                      !selectedNodeKey ||
                      link.source === selectedNodeKey ||
                      link.target === selectedNodeKey;
                    const opacity = selectedNodeKey ? (isHighlighted ? 0.85 : 0.12) : 0.35;

                    return (
                      <line
                        key={`${link.source}-${link.target}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={theme === 'dark' ? 'rgba(148,163,184,0.55)' : 'rgba(71,85,105,0.35)'}
                        strokeWidth={1 + Math.min(link.weight, 4)}
                        opacity={opacity}
                      />
                    );
                  })}

                  {positionedNodes.map((node) => {
                    const color = getNodeTypeColor(node.node_type);
                    const isSelected = selectedNodeKey === node.node_key;
                    const isRelated = selectedNodeKey ? selectedNeighborKeys.has(node.node_key) : true;
                    const opacity = selectedNodeKey ? (isRelated ? 1 : 0.2) : 1;
                    const showLabel = isSelected || labelKeys.has(node.node_key);

                    return (
                      <g
                        key={node.node_key}
                        transform={`translate(${node.x}, ${node.y})`}
                        style={{ cursor: 'pointer', opacity }}
                        onClick={() => setSelectedNodeKey(node.node_key)}
                      >
                        <circle
                          r={node.radius + (isSelected ? 7 : 0)}
                          fill={isSelected ? `${color}22` : `${color}18`}
                          stroke="none"
                        />
                        <circle
                          r={node.radius}
                          fill={color}
                          stroke={isSelected ? '#f8fafc' : theme === 'dark' ? '#020617' : '#ffffff'}
                          strokeWidth={isSelected ? 3 : 1.5}
                        />
                        {showLabel && (
                          <text
                            x={node.radius + 8}
                            y={4}
                            fontSize={12}
                            fontWeight={isSelected ? 700 : 500}
                            fill={theme === 'dark' ? '#f8fafc' : '#0f172a'}
                          >
                            {node.label.length > 24 ? `${node.label.slice(0, 24)}...` : node.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
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
                <NodeDetailCard detail={nodeDetail} theme={theme} />
              )}
            </Card>
          </Col>
        </Row>

        <Space wrap size={[8, 8]}>
          <Tag icon={<BgColorsOutlined />}>节点 {snapshot?.total_nodes || 0}</Tag>
          <Tag>边 {snapshot?.total_links || 0}</Tag>
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
}: {
  detail?: KnowledgeGraphNodeDetail;
  theme: 'light' | 'dark';
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

      {detail.matched_communities.length > 0 && (
        <div>
          <Text strong>所在社区</Text>
          <div style={{ marginTop: 8 }}>
            {detail.matched_communities.map((community: KnowledgeGraphCommunitySummary) => (
              <Tag key={community.community_id} color="purple">
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
            <List.Item>
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
            <List.Item>
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
