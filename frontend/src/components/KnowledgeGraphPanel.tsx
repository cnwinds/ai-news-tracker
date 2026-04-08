import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
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
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  BulbOutlined,
  CommentOutlined,
  HistoryOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import KnowledgeGraphCommunityDrawer from '@/components/KnowledgeGraphCommunityDrawer';
import KnowledgeGraphExplorer from '@/components/KnowledgeGraphExplorer';
import { useAuth } from '@/contexts/AuthContext';
import {
  useKnowledgeGraphView,
  type KnowledgeGraphNavigationCommand,
} from '@/contexts/KnowledgeGraphViewContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { apiService } from '@/services/api';
import type {
  AIQueryEngine,
  KnowledgeGraphBuildSummary,
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphPathResponse,
  KnowledgeGraphQueryResponse,
} from '@/types';
import { getThemeColor } from '@/utils/theme';

const { Paragraph, Text, Title } = Typography;
const { TextArea, Search } = Input;

type SyncRunMode = 'auto' | 'agent' | 'deterministic';
type WorkbenchTabKey = 'qa' | 'path' | 'navigate';

function formatBuildStatus(status: KnowledgeGraphBuildSummary['status']) {
  if (status === 'completed') return { color: 'success', text: '已完成' };
  if (status === 'running') return { color: 'processing', text: '运行中' };
  if (status === 'failed') return { color: 'error', text: '失败' };
  return { color: 'default', text: '等待中' };
}

function getGraphCommandSummary(command: KnowledgeGraphNavigationCommand | null) {
  if (!command) {
    return null;
  }

  const focusCount = command.focusNodeKeys.length;
  const selectedNodeKey = command.selectedNodeKey || command.focusNodeKeys[0];

  if (command.reason === 'path') {
    return {
      title: '路径高亮中',
      description: `当前画布正在突出显示一条关系路径，涉及 ${focusCount || command.highlightedNodeKeys.length} 个节点。`,
    };
  }

  if (command.reason === 'community') {
    return {
      title: '社区视图中',
      description: `当前画布已切换到社区 ${command.communityId ?? '-'}，适合继续钻取社区节点和相关文章。`,
    };
  }

  if (command.reason === 'article') {
    return {
      title: '文章定位中',
      description: `当前画布已围绕文章节点 ${selectedNodeKey || '-'} 展开，可继续查看邻域和命中社区。`,
    };
  }

  if (command.reason === 'node') {
    return {
      title: '节点聚焦中',
      description: `当前画布正在围绕节点 ${selectedNodeKey || '-'} 展开，可继续查看邻居关系与文章证据。`,
    };
  }

  return {
    title: '自定义视图中',
    description: '当前画布已被外部入口驱动到一个定制视图，可继续问答、追路径或查看社区。',
  };
}

function buildWorkbenchTabLabel(icon: ReactNode, label: string) {
  return (
    <Space size={6}>
      {icon}
      <span>{label}</span>
    </Space>
  );
}

export default function KnowledgeGraphPanel() {
  const queryClient = useQueryClient();
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showWarning } = useErrorHandler();
  const { graphCommand, focusArticle, focusCommunity, focusNode, focusPath } = useKnowledgeGraphView();

  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTabKey>('qa');
  const [question, setQuestion] = useState('');
  const [queryMode, setQueryMode] = useState<AIQueryEngine>('hybrid');
  const [queryResult, setQueryResult] = useState<KnowledgeGraphQueryResponse | null>(null);
  const [pathResult, setPathResult] = useState<KnowledgeGraphPathResponse | null>(null);
  const [pathSource, setPathSource] = useState<string>();
  const [pathTarget, setPathTarget] = useState<string>();
  const [pathNodeSearch, setPathNodeSearch] = useState('');
  const [navigationSearch, setNavigationSearch] = useState('');
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

  const { data: pathNodeResults, isLoading: pathNodesLoading } = useQuery({
    queryKey: ['knowledge-graph-nodes', 'path', pathNodeSearch],
    queryFn: () =>
      apiService.getKnowledgeGraphNodes({
        q: pathNodeSearch.trim() || undefined,
        limit: 20,
      }),
    enabled: Boolean(pathNodeSearch.trim()),
  });

  const { data: navigationNodeResults, isLoading: navigationNodesLoading } = useQuery({
    queryKey: ['knowledge-graph-nodes', 'navigation', navigationSearch],
    queryFn: () =>
      apiService.getKnowledgeGraphNodes({
        q: navigationSearch.trim() || undefined,
        limit: 20,
      }),
    enabled: Boolean(navigationSearch.trim()),
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

  useEffect(() => {
    if (!graphCommand?.id) {
      return;
    }
    setActiveWorkbenchTab(graphCommand.reason === 'path' ? 'path' : 'navigate');
  }, [graphCommand?.id, graphCommand?.reason]);

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

  const jumpToWorkbench = (tab: WorkbenchTabKey) => {
    setActiveWorkbenchTab(tab);
    workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const commandSummary = useMemo(() => getGraphCommandSummary(graphCommand), [graphCommand]);

  const pathNodeOptions = useMemo(() => {
    const items = pathNodeSearch.trim() ? (pathNodeResults?.items || []) : (stats?.top_nodes || []);
    return items.map((node) => ({
      label: `${node.label} (${node.node_key})`,
      value: node.node_key,
    }));
  }, [pathNodeResults?.items, pathNodeSearch, stats?.top_nodes]);

  const navigationNodes = useMemo(
    () => (navigationSearch.trim() ? navigationNodeResults?.items || [] : stats?.top_nodes || []),
    [navigationNodeResults?.items, navigationSearch, stats?.top_nodes]
  );

  const communityItems = communities?.items || stats?.top_communities || [];
  const lastBuildStatus = stats?.last_build ? formatBuildStatus(stats.last_build.status) : null;
  const coveragePercent = Number(((stats?.coverage ?? 0) * 100).toFixed(1));

  const pageCardStyle = {
    borderRadius: 24,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    overflow: 'hidden',
  } as const;

  const heroSurfaceStyle = {
    borderRadius: 18,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.52)' : 'rgba(255, 255, 255, 0.78)',
    backdropFilter: 'blur(8px)',
  } as const;

  const heroCardStyle = {
    ...pageCardStyle,
    background:
      theme === 'dark'
        ? 'linear-gradient(135deg, rgba(30,64,175,0.32) 0%, rgba(15,23,42,0.98) 52%, rgba(15,118,110,0.28) 100%)'
        : 'linear-gradient(135deg, rgba(219,234,254,0.95) 0%, rgba(255,255,255,0.98) 52%, rgba(204,251,241,0.95) 100%)',
  } as const;

  const workbenchItems = [
    {
      key: 'qa',
      label: buildWorkbenchTabLabel(<CommentOutlined />, '图谱问答'),
      children: (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            先在画布中缩小范围，再围绕当前图谱关系提问，回答中的节点、社区和文章都可以继续驱动画布。
          </Paragraph>
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
            <Card
              size="small"
              style={heroSurfaceStyle}
              title={`回答结果（实际模式：${queryResult.resolved_mode}）`}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{queryResult.answer}</Paragraph>
                <Space wrap>
                  <Tag>节点 {queryResult.context_node_count}</Tag>
                  <Tag>边 {queryResult.context_edge_count}</Tag>
                  <Tag>命中文章 {queryResult.related_articles.length}</Tag>
                </Space>
                <div>
                  <Text strong>命中节点</Text>
                  <div style={{ marginTop: 8 }}>
                    {queryResult.matched_nodes.length > 0 ? (
                      queryResult.matched_nodes.map((node) => (
                        <Tag
                          key={node.node_key}
                          color="geekblue"
                          style={{ cursor: 'pointer' }}
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
                  <Text strong>命中社区</Text>
                  <div style={{ marginTop: 8 }}>
                    {queryResult.matched_communities.length > 0 ? (
                      queryResult.matched_communities.map((community) => (
                        <Tag
                          key={community.community_id}
                          color="blue"
                          style={{ cursor: 'pointer' }}
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
                  <Text strong>相关文章</Text>
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
              description="输入问题后，这里会沉淀图谱问答结果，并保留可继续探索的入口。"
            />
          )}
        </Space>
      ),
    },
    {
      key: 'path',
      label: buildWorkbenchTabLabel(<BranchesOutlined />, '关系路径'),
      children: (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            适合用来追踪两个实体、组织或文章之间是否存在可解释的连接路径，命中后会直接在画布中高亮。
          </Paragraph>
          <Search
            placeholder="搜索路径起点 / 终点候选节点"
            allowClear
            value={pathNodeSearch}
            onChange={(event) => setPathNodeSearch(event.target.value)}
          />
          <Row gutter={[12, 12]}>
            <Col xs={24} xl={12}>
              <Select
                showSearch
                value={pathSource}
                onChange={setPathSource}
                onSearch={setPathNodeSearch}
                filterOption={false}
                placeholder="选择起点节点"
                options={pathNodeOptions}
                style={{ width: '100%' }}
                notFoundContent={pathNodesLoading ? <Spin size="small" /> : null}
              />
            </Col>
            <Col xs={24} xl={12}>
              <Select
                showSearch
                value={pathTarget}
                onChange={setPathTarget}
                onSearch={setPathNodeSearch}
                filterOption={false}
                placeholder="选择终点节点"
                options={pathNodeOptions}
                style={{ width: '100%' }}
                notFoundContent={pathNodesLoading ? <Spin size="small" /> : null}
              />
            </Col>
          </Row>
          <Button type="primary" onClick={handlePathQuery} loading={pathMutation.isPending}>
            查询最短路径
          </Button>
          {pathResult ? (
            <Card
              size="small"
              style={heroSurfaceStyle}
              title={pathResult.found ? '路径结果' : '路径未找到'}
            >
              {pathResult.found ? (
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <Text>路径长度：{pathResult.distance}</Text>
                  <Text>{pathResult.nodes.map((node) => node.label).join(' -> ')}</Text>
                  <Space wrap>
                    {pathResult.nodes.map((node) => (
                      <Tag
                        key={node.node_key}
                        color="orange"
                        style={{ cursor: 'pointer' }}
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
                    locale={{ emptyText: '暂无边关系' }}
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
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选定两个节点后，这里会展示路径解释，并且同步驱动画布高亮。"
            />
          )}
        </Space>
      ),
    },
    {
      key: 'navigate',
      label: buildWorkbenchTabLabel(<NodeIndexOutlined />, '实体导航'),
      children: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            这里是从列表进入画布的快速入口。适合先选实体或社区，再回到上方图谱画布继续看关系。
          </Paragraph>
          <div>
            <Text strong>实体入口</Text>
            <Search
              style={{ marginTop: 12, marginBottom: 12 }}
              placeholder="搜索节点名称或 node key"
              allowClear
              value={navigationSearch}
              onChange={(event) => setNavigationSearch(event.target.value)}
            />
            <List
              size="small"
              loading={navigationNodesLoading}
              dataSource={navigationNodes}
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
          </div>
          <div>
            <Text strong>社区入口</Text>
            <List
              size="small"
              style={{ marginTop: 12 }}
              loading={communitiesLoading}
              dataSource={communityItems}
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
                            style={{ cursor: 'pointer' }}
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
          </div>
        </Space>
      ),
    },
  ];

  return (
    <Spin spinning={statsLoading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card style={heroCardStyle} styles={{ body: { padding: 24 } }}>
          <Row gutter={[20, 20]}>
            <Col xs={24} xl={14}>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space wrap size={[8, 8]}>
                  <Badge
                    status={stats?.enabled ? 'success' : 'warning'}
                    text={stats?.enabled ? '图谱已启用' : '图谱未启用'}
                  />
                  <Tag>自动同步 {settings?.auto_sync_enabled ? '开启' : '关闭'}</Tag>
                  <Tag>默认查询深度 {settings?.query_depth ?? '-'}</Tag>
                  {stats?.snapshot_updated_at && (
                    <Tag>快照更新 {dayjs(stats.snapshot_updated_at).format('MM-DD HH:mm')}</Tag>
                  )}
                </Space>

                <div>
                  <Title level={3} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                    知识图谱工作台
                  </Title>
                  <Paragraph style={{ marginTop: 12, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                    这页现在只保留四件事情：先看图谱结构，再用工具台提问、查路径、跳实体，最后在底部回看构建历史。
                  </Paragraph>
                </div>

                {commandSummary && (
                  <div style={{ ...heroSurfaceStyle, padding: 16 }}>
                    <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                      {commandSummary.title}
                    </Text>
                    <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                      {commandSummary.description}
                    </Paragraph>
                  </div>
                )}

                <Space wrap>
                  <Button
                    type="primary"
                    icon={<CommentOutlined />}
                    disabled={!stats?.enabled}
                    onClick={() => jumpToWorkbench('qa')}
                  >
                    问一个图谱问题
                  </Button>
                  <Button
                    icon={<BranchesOutlined />}
                    disabled={!stats?.enabled}
                    onClick={() => jumpToWorkbench('path')}
                  >
                    查一条关系路径
                  </Button>
                  <Button
                    icon={<NodeIndexOutlined />}
                    disabled={!stats?.enabled}
                    onClick={() => jumpToWorkbench('navigate')}
                  >
                    跳到实体 / 社区
                  </Button>
                </Space>
              </Space>
            </Col>

            <Col xs={24} xl={10}>
              <div style={{ ...heroSurfaceStyle, padding: 20, height: '100%' }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                      运维入口
                    </Text>
                    <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                      低频的同步和刷新动作集中放在这里，不再和问答、路径、导航混在一起。
                    </Paragraph>
                  </div>

                  <Space wrap>
                    <Select<SyncRunMode>
                      value={syncMode}
                      onChange={setSyncMode}
                      style={{ minWidth: 170 }}
                      options={[
                        { label: '自动', value: 'auto' },
                        { label: 'Agent', value: 'agent' },
                        { label: '确定性', value: 'deterministic' },
                      ]}
                    />
                    <Select<number>
                      value={maxArticles}
                      onChange={setMaxArticles}
                      style={{ minWidth: 170 }}
                      options={[50, 100, 200, 500].map((value) => ({
                        label: `最多 ${value} 篇`,
                        value,
                      }))}
                    />
                  </Space>

                  <Space wrap>
                    <Button icon={<ReloadOutlined />} onClick={refreshGraphQueries}>
                      刷新数据
                    </Button>
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

                  {stats?.last_build && lastBuildStatus && (
                    <div style={{ ...heroSurfaceStyle, padding: 16 }}>
                      <Space direction="vertical" size={8}>
                        <Space wrap>
                          <Text strong>最近一次构建</Text>
                          <Tag color={lastBuildStatus.color}>{lastBuildStatus.text}</Tag>
                        </Space>
                        <Text type="secondary">
                          {stats.last_build.trigger_source} · {stats.last_build.sync_mode}
                        </Text>
                        <Text type="secondary">
                          处理 {stats.last_build.processed_articles}/{stats.last_build.total_articles} 篇文章
                        </Text>
                        <Text type="secondary">
                          新增节点 {stats.last_build.nodes_upserted} · 新增边 {stats.last_build.edges_upserted}
                        </Text>
                      </Space>
                    </div>
                  )}
                </Space>
              </div>
            </Col>
          </Row>
        </Card>

        {!stats?.enabled && (
          <Alert
            type="warning"
            showIcon
            message="知识图谱当前已关闭"
            description="请先在系统设置中启用知识图谱，再执行同步、问答、路径查询和画布探索。"
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <Card style={pageCardStyle}>
              <Statistic title="节点总数" value={stats?.total_nodes ?? 0} prefix={<ApartmentOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card style={pageCardStyle}>
              <Statistic title="边总数" value={stats?.total_edges ?? 0} prefix={<BranchesOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card style={pageCardStyle}>
              <Statistic title="已同步文章" value={stats?.synced_articles ?? 0} prefix={<SyncOutlined />} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card style={pageCardStyle} styles={{ body: { paddingBottom: 12 } }}>
              <Statistic title="覆盖率" value={coveragePercent} suffix="%" prefix={<BulbOutlined />} />
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">图谱覆盖文章比例</Text>
                <div
                  style={{
                    marginTop: 8,
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    background: getThemeColor(theme, 'bgSecondary'),
                  }}
                >
                  <div
                    style={{
                      width: `${coveragePercent}%`,
                      height: '100%',
                      background: theme === 'dark' ? '#60a5fa' : '#2563eb',
                    }}
                  />
                </div>
              </div>
            </Card>
          </Col>
        </Row>

        {stats?.enabled && <KnowledgeGraphExplorer />}

        <div ref={workbenchRef}>
          <Card
            style={pageCardStyle}
            title={
              <Space>
                <NodeIndexOutlined />
                <span>工具工作台</span>
              </Space>
            }
            extra={<Text type="secondary">围绕当前图谱做提问、导航和路径追踪</Text>}
          >
            <Tabs
              activeKey={activeWorkbenchTab}
              onChange={(key) => setActiveWorkbenchTab(key as WorkbenchTabKey)}
              items={workbenchItems}
            />
          </Card>
        </div>

        <Card
          style={pageCardStyle}
          title={
            <Space>
              <HistoryOutlined />
              <span>构建历史</span>
            </Space>
          }
          extra={<Text type="secondary">仅保留回看用途，不再占据主操作区</Text>}
        >
          <List
            size="small"
            loading={buildsLoading}
            dataSource={builds}
            locale={{ emptyText: '暂无构建记录' }}
            renderItem={(build) => {
              const status = formatBuildStatus(build.status);
              return (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space wrap>
                      <Text strong>{build.build_id.slice(0, 12)}</Text>
                      <Tag color={status.color}>{status.text}</Tag>
                      <Tag>{dayjs(build.started_at).format('MM-DD HH:mm')}</Tag>
                    </Space>
                    <Text type="secondary">
                      {build.trigger_source} · {build.sync_mode} · 处理 {build.processed_articles}/{build.total_articles}
                    </Text>
                    <Text type="secondary">
                      跳过 {build.skipped_articles} · 失败 {build.failed_articles} · 节点 {build.nodes_upserted} · 边 {build.edges_upserted}
                    </Text>
                  </Space>
                </List.Item>
              );
            }}
          />
        </Card>
      </Space>

      <KnowledgeGraphCommunityDrawer
        open={communityDrawerOpen}
        communityId={activeCommunityId}
        onClose={() => setCommunityDrawerOpen(false)}
      />
    </Spin>
  );
}
