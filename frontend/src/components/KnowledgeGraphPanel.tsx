import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  BulbOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import KnowledgeGraphCommunityDrawer from '@/components/KnowledgeGraphCommunityDrawer';
import KnowledgeGraphExplorer from '@/components/KnowledgeGraphExplorer';
import { useAuth } from '@/contexts/AuthContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { apiService } from '@/services/api';
import type {
  AIQueryEngine,
  KnowledgeGraphBuildSummary,
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphPathResponse,
  KnowledgeGraphQueryResponse,
} from '@/types';

const { Paragraph, Text } = Typography;
const { TextArea, Search } = Input;

type SyncRunMode = 'auto' | 'agent' | 'deterministic';

function formatBuildStatus(status: KnowledgeGraphBuildSummary['status']) {
  if (status === 'completed') return { color: 'success', text: '已完成' };
  if (status === 'running') return { color: 'processing', text: '运行中' };
  if (status === 'failed') return { color: 'error', text: '失败' };
  return { color: 'default', text: '等待中' };
}

const clickableTagStyle = { cursor: 'pointer' } as const;

export default function KnowledgeGraphPanel() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showWarning } = useErrorHandler();
  const { graphCommand, focusArticle, focusCommunity, focusNode, focusPath } = useKnowledgeGraphView();

  const [question, setQuestion] = useState('');
  const [queryMode, setQueryMode] = useState<AIQueryEngine>('hybrid');
  const [queryResult, setQueryResult] = useState<KnowledgeGraphQueryResponse | null>(null);
  const [pathResult, setPathResult] = useState<KnowledgeGraphPathResponse | null>(null);
  const [pathSource, setPathSource] = useState<string>();
  const [pathTarget, setPathTarget] = useState<string>();
  const [nodeSearch, setNodeSearch] = useState('');
  const [syncMode, setSyncMode] = useState<SyncRunMode>('auto');
  const [maxArticles, setMaxArticles] = useState<number>(100);
  const [communityDrawerOpen, setCommunityDrawerOpen] = useState(false);
  const [activeCommunityId, setActiveCommunityId] = useState<number>();

  const { data: settings } = useQuery({
    queryKey: ['knowledge-graph-settings'],
    queryFn: () => apiService.getKnowledgeGraphSettings(),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['knowledge-graph-stats'],
    queryFn: () => apiService.getKnowledgeGraphStats(),
    refetchInterval: 30000,
  });

  const { data: builds = [], isLoading: buildsLoading } = useQuery({
    queryKey: ['knowledge-graph-builds'],
    queryFn: () => apiService.getKnowledgeGraphBuilds(8),
  });

  const { data: communities, isLoading: communitiesLoading } = useQuery({
    queryKey: ['knowledge-graph-communities'],
    queryFn: () => apiService.getKnowledgeGraphCommunities(8),
  });

  const { data: nodeResults, isLoading: nodesLoading } = useQuery({
    queryKey: ['knowledge-graph-nodes', nodeSearch],
    queryFn: () =>
      apiService.getKnowledgeGraphNodes({
        q: nodeSearch.trim() || undefined,
        limit: 20,
      }),
  });

  useEffect(() => {
    if (!settings) {
      return;
    }
    setSyncMode(settings.run_mode);
    setMaxArticles(settings.max_articles_per_sync);
  }, [settings]);

  useEffect(() => {
    if (!graphCommand?.openCommunityId) {
      return;
    }
    setActiveCommunityId(graphCommand.openCommunityId);
    setCommunityDrawerOpen(true);
  }, [graphCommand?.id, graphCommand?.openCommunityId]);

  const nodeOptions = useMemo(() => {
    const items = nodeSearch.trim() ? (nodeResults?.items || []) : (stats?.top_nodes || []);
    return items.map((node) => ({
      label: `${node.label} (${node.node_key})`,
      value: node.node_key,
    }));
  }, [nodeResults?.items, nodeSearch, stats?.top_nodes]);

  const refreshGraphQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-settings'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-stats'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-builds'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-communities'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-community-detail'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-nodes'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-snapshot'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-graph-node-detail'] });
  };

  const openCommunityDrawer = (community: KnowledgeGraphCommunitySummary) => {
    setActiveCommunityId(community.community_id);
    setCommunityDrawerOpen(true);
    focusCommunity(community.community_id, {
      selectedNodeKey: community.top_nodes[0]?.node_key,
    });
  };

  const syncMutation = useMutation({
    mutationFn: ({ forceRebuild }: { forceRebuild: boolean }) =>
      apiService.syncKnowledgeGraph({
        force_rebuild: forceRebuild,
        sync_mode: syncMode,
        max_articles: maxArticles,
        trigger_source: 'dashboard',
      }),
    onSuccess: (response) => {
      showSuccess(`知识图谱同步完成，处理 ${response.build.processed_articles} 篇文章`);
      refreshGraphQueries();
    },
    onError: createErrorHandler({
      operationName: '执行知识图谱同步',
      customMessages: {
        auth: '需要登录后才能执行知识图谱同步',
      },
    }),
  });

  const queryMutation = useMutation({
    mutationFn: () =>
      apiService.queryKnowledgeGraph({
        question: question.trim(),
        mode: queryMode,
        top_k: 6,
        query_depth: settings?.query_depth,
      }),
    onSuccess: (response) => {
      setQueryResult(response);
    },
    onError: createErrorHandler({
      operationName: '执行图谱问答',
    }),
  });

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
          response.edges.map((edge) => ({
            source: edge.source_node_key,
            target: edge.target_node_key,
          }))
        );
      }
    },
    onError: createErrorHandler({
      operationName: '查询知识图谱路径',
    }),
  });

  const handleSync = (forceRebuild: boolean) => {
    if (!isAuthenticated) {
      showWarning('需要登录后才能执行知识图谱同步');
      return;
    }
    syncMutation.mutate({ forceRebuild });
  };

  const handleAsk = () => {
    if (!question.trim()) {
      showWarning('请输入问题');
      return;
    }
    queryMutation.mutate();
  };

  const handlePathQuery = () => {
    if (!pathSource || !pathTarget) {
      showWarning('请选择起点和终点节点');
      return;
    }
    pathMutation.mutate();
  };

  return (
    <Spin spinning={statsLoading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type={stats?.enabled ? 'info' : 'warning'}
          showIcon
          message={stats?.enabled ? '知识图谱已接入系统' : '知识图谱当前已关闭'}
          description={
            stats?.enabled
              ? '你可以在这里查看图谱覆盖率、触发手动同步、做图谱问答以及查询实体路径。所有问答结果、路径结果、节点入口和社区入口都可以继续驱动画布探索。'
              : '请先在系统设置中启用知识图谱，再执行同步和问答。'
          }
        />

        {stats?.enabled && <KnowledgeGraphExplorer />}

        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="节点总数" value={stats?.total_nodes ?? 0} prefix={<ApartmentOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="边总数" value={stats?.total_edges ?? 0} prefix={<BranchesOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic title="已同步文章" value={stats?.synced_articles ?? 0} prefix={<SyncOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="覆盖率"
                value={Number(((stats?.coverage ?? 0) * 100).toFixed(1))}
                suffix="%"
                prefix={<BulbOutlined />}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card
              title="手动同步"
              extra={
                <Button icon={<ReloadOutlined />} onClick={refreshGraphQueries}>
                  刷新
                </Button>
              }
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Text type="secondary">
                  当前抽取模式：{syncMode}，默认查询深度：{settings?.query_depth ?? '-'}
                </Text>
                <Space wrap>
                  <Select<SyncRunMode>
                    value={syncMode}
                    onChange={setSyncMode}
                    style={{ minWidth: 180 }}
                    options={[
                      { label: '自动', value: 'auto' },
                      { label: 'Agent', value: 'agent' },
                      { label: '确定性', value: 'deterministic' },
                    ]}
                  />
                  <Select<number>
                    value={maxArticles}
                    onChange={setMaxArticles}
                    style={{ minWidth: 160 }}
                    options={[50, 100, 200, 500].map((value) => ({
                      label: `最多 ${value} 篇`,
                      value,
                    }))}
                  />
                </Space>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<SyncOutlined />}
                    loading={syncMutation.isPending}
                    disabled={!stats?.enabled}
                    onClick={() => handleSync(false)}
                  >
                    增量同步
                  </Button>
                  <Button
                    danger
                    loading={syncMutation.isPending}
                    disabled={!stats?.enabled}
                    onClick={() => handleSync(true)}
                  >
                    全量重建
                  </Button>
                </Space>
                {stats?.last_build && (
                  <Card size="small" title="最近一次构建">
                    <Space direction="vertical" size="small">
                      <Tag color={formatBuildStatus(stats.last_build.status).color}>
                        {formatBuildStatus(stats.last_build.status).text}
                      </Tag>
                      <Text>触发来源：{stats.last_build.trigger_source}</Text>
                      <Text>处理文章：{stats.last_build.processed_articles}</Text>
                      <Text>新增节点：{stats.last_build.nodes_upserted}</Text>
                      <Text>新增边：{stats.last_build.edges_upserted}</Text>
                    </Space>
                  </Card>
                )}
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card title="图谱问答">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space wrap>
                  <Select<AIQueryEngine>
                    value={queryMode}
                    onChange={setQueryMode}
                    style={{ minWidth: 180 }}
                    options={[
                      { label: '自动', value: 'auto' },
                      { label: 'RAG', value: 'rag' },
                      { label: 'Graph', value: 'graph' },
                      { label: 'Hybrid', value: 'hybrid' },
                    ]}
                  />
                  <Button
                    type="primary"
                    onClick={handleAsk}
                    loading={queryMutation.isPending}
                    disabled={!stats?.enabled && queryMode !== 'rag'}
                  >
                    开始问答
                  </Button>
                </Space>
                <TextArea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  placeholder="例如：OpenAI、Anthropic 和推理模型之间最近有哪些明显的关系变化？"
                />
                {queryResult ? (
                  <Card size="small" title={`回答结果（实际模式：${queryResult.resolved_mode}）`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                        {queryResult.answer}
                      </Paragraph>
                      <Space wrap>
                        <Tag>节点 {queryResult.context_node_count}</Tag>
                        <Tag>边 {queryResult.context_edge_count}</Tag>
                        <Tag>命中文章 {queryResult.related_articles.length}</Tag>
                      </Space>
                      <div>
                        <Text strong>命中节点：</Text>
                        <div style={{ marginTop: 8 }}>
                          {queryResult.matched_nodes.length > 0 ? (
                            queryResult.matched_nodes.map((node) => (
                              <Tag
                                key={node.node_key}
                                color="geekblue"
                                style={clickableTagStyle}
                                onClick={() => focusNode(node.node_key)}
                              >
                                {node.label} / {node.node_type}
                              </Tag>
                            ))
                          ) : (
                            <Text type="secondary">暂无</Text>
                          )}
                        </div>
                      </div>
                      <div>
                        <Text strong>命中社区：</Text>
                        <div style={{ marginTop: 8 }}>
                          {queryResult.matched_communities.length > 0 ? (
                            queryResult.matched_communities.map((community) => (
                              <Tag
                                key={community.community_id}
                                color="blue"
                                style={clickableTagStyle}
                                onClick={() => openCommunityDrawer(community)}
                              >
                                {community.label}
                              </Tag>
                            ))
                          ) : (
                            <Text type="secondary">暂无</Text>
                          )}
                        </div>
                      </div>
                      <div>
                        <Text strong>相关文章：</Text>
                        <List
                          size="small"
                          dataSource={queryResult.related_articles}
                          locale={{ emptyText: '暂无相关文章' }}
                          renderItem={(article) => (
                            <List.Item
                              actions={[
                                <Button
                                  key="focus-article"
                                  type="link"
                                  size="small"
                                  onClick={() => focusArticle(article.id)}
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
                  </Card>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="输入问题后，这里会展示图谱问答结果，并且可以把命中节点、社区和文章继续送入画布。"
                  />
                )}
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="路径查询">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Search
                  placeholder="搜索节点名称或 node key"
                  allowClear
                  value={nodeSearch}
                  onChange={(event) => setNodeSearch(event.target.value)}
                />
                <Select
                  showSearch
                  value={pathSource}
                  onChange={setPathSource}
                  onSearch={setNodeSearch}
                  filterOption={false}
                  placeholder="选择起点节点"
                  options={nodeOptions}
                  style={{ width: '100%' }}
                  notFoundContent={nodesLoading ? <Spin size="small" /> : null}
                />
                <Select
                  showSearch
                  value={pathTarget}
                  onChange={setPathTarget}
                  onSearch={setNodeSearch}
                  filterOption={false}
                  placeholder="选择终点节点"
                  options={nodeOptions}
                  style={{ width: '100%' }}
                  notFoundContent={nodesLoading ? <Spin size="small" /> : null}
                />
                <Button type="primary" onClick={handlePathQuery} loading={pathMutation.isPending}>
                  查询最短路径
                </Button>
                {pathResult && (
                  <Card size="small" title={pathResult.found ? '路径结果' : '路径未找到'}>
                    {pathResult.found ? (
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Text>路径长度：{pathResult.distance}</Text>
                        <Text>
                          {pathResult.nodes.map((node) => node.label).join(' -> ')}
                        </Text>
                        <Space wrap>
                          {pathResult.nodes.map((node) => (
                            <Tag
                              key={node.node_key}
                              color="orange"
                              style={clickableTagStyle}
                              onClick={() => focusNode(node.node_key)}
                            >
                              {node.label}
                            </Tag>
                          ))}
                        </Space>
                        <Button
                          onClick={() =>
                            focusPath(
                              pathResult.nodes.map((node) => node.node_key),
                              pathResult.edges.map((edge) => ({
                                source: edge.source_node_key,
                                target: edge.target_node_key,
                              }))
                            )
                          }
                        >
                          在画布中重新高亮
                        </Button>
                        <List
                          size="small"
                          dataSource={pathResult.edges}
                          renderItem={(edge) => (
                            <List.Item>
                              <Text>
                                {edge.source_node_key} --{edge.relation_type}--&gt; {edge.target_node_key}
                              </Text>
                            </List.Item>
                          )}
                        />
                      </Space>
                    ) : (
                      <Text type="secondary">{pathResult.message || '未找到路径'}</Text>
                    )}
                  </Card>
                )}
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="节点入口">
              <List
                size="small"
                loading={nodesLoading}
                dataSource={nodeSearch.trim() ? nodeResults?.items || [] : stats?.top_nodes || []}
                locale={{ emptyText: '暂无节点' }}
                renderItem={(node) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => focusNode(node.node_key)}
                    actions={[
                      <Button
                        key="focus-node"
                        type="link"
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          focusNode(node.node_key);
                        }}
                      >
                        画布定位
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Text strong>{node.label}</Text>
                      <Text type="secondary">
                        {node.node_key} · {node.node_type} · 度数 {node.degree}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="社区概览">
              <List
                size="small"
                loading={communitiesLoading}
                dataSource={communities?.items || []}
                locale={{ emptyText: '暂无社区数据' }}
                renderItem={(community) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => openCommunityDrawer(community)}
                    actions={[
                      <Button
                        key="open-community"
                        type="link"
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openCommunityDrawer(community);
                        }}
                      >
                        打开社区
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text strong>{community.label}</Text>
                      <Text type="secondary">
                        节点 {community.node_count} · 边 {community.edge_count} · 文章 {community.article_count}
                      </Text>
                      {community.top_nodes.length > 0 && (
                        <Space wrap size={[8, 8]}>
                          {community.top_nodes.slice(0, 3).map((node) => (
                            <Tag
                              key={node.node_key}
                              color="purple"
                              style={clickableTagStyle}
                              onClick={(event) => {
                                event.stopPropagation();
                                focusNode(node.node_key, { communityId: community.community_id });
                              }}
                            >
                              {node.label}
                            </Tag>
                          ))}
                        </Space>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="构建历史">
              <List
                size="small"
                loading={buildsLoading}
                dataSource={builds}
                locale={{ emptyText: '暂无构建记录' }}
                renderItem={(build) => {
                  const status = formatBuildStatus(build.status);
                  return (
                    <List.Item>
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <Space wrap>
                          <Text strong>{build.build_id.slice(0, 12)}</Text>
                          <Tag color={status.color}>{status.text}</Tag>
                        </Space>
                        <Text type="secondary">
                          {build.trigger_source} · {build.sync_mode} · 处理 {build.processed_articles}/{build.total_articles}
                        </Text>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Card>
          </Col>
        </Row>
      </Space>

      <KnowledgeGraphCommunityDrawer
        open={communityDrawerOpen}
        communityId={activeCommunityId}
        onClose={() => setCommunityDrawerOpen(false)}
      />
    </Spin>
  );
}
