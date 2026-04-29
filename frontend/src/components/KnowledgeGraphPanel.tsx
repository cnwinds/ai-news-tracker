import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
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
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
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
import {
  createMarkdownComponents,
  normalizeMarkdownImageContent,
  remarkGfm,
} from '@/utils/markdown';
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

function formatRunMode(mode?: SyncRunMode) {
  if (mode === 'agent') return 'Agent';
  if (mode === 'deterministic') return '确定性';
  return '自动';
}

function getGraphCommandSummary(command: KnowledgeGraphNavigationCommand | null) {
  if (!command) {
    return {
      title: '全局视图',
      description: '当前画布处于默认浏览状态，适合先观察整体结构，再进入问答、路径或实体钻取。',
    };
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

function truncateMiddle(text: string, head = 140, tail = 80) {
  if (!text) {
    return text;
  }

  const minLengthToTruncate = head + tail + 3;
  if (text.length <= minLengthToTruncate) {
    return text;
  }

  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function BuildHistoryList({
  builds,
  loading,
}: {
  builds: KnowledgeGraphBuildSummary[];
  loading: boolean;
}) {
  return (
    <List
      size="small"
      loading={loading}
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
              {build.error_message && (
                <Tooltip title={build.error_message}>
                  <Text type="danger">{truncateMiddle(build.error_message)}</Text>
                </Tooltip>
              )}
            </Space>
          </List.Item>
        );
      }}
    />
  );
}

export default function KnowledgeGraphPanel() {
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showWarning } = useErrorHandler();
  const { graphCommand, focusArticle, focusCommunity, focusNode, focusPath } = useKnowledgeGraphView();
  const graphSectionRef = useRef<HTMLDivElement | null>(null);

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

  const markdownComponents = useMemo(() => createMarkdownComponents(theme), [theme]);

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

  useEffect(() => {
    if (!graphCommand?.id) {
      return;
    }
    const target = graphSectionRef.current;
    if (!target || typeof target.scrollIntoView !== 'function') {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [graphCommand?.id]);

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
    mutationFn: async () => {
      const currentQuestion = question.trim();
      let accumulatedAnswer = '';
      let streamError: Error | null = null;
      let latestResult: KnowledgeGraphQueryResponse = {
        question: currentQuestion,
        mode: queryMode,
        resolved_mode: queryMode,
        answer: '',
        matched_nodes: [],
        matched_communities: [],
        related_articles: [],
        context_node_count: 0,
        context_edge_count: 0,
      };

      setQueryResult(latestResult);

      await apiService.queryKnowledgeGraphStream({
        question: currentQuestion,
        mode: queryMode,
        top_k: 6,
        query_depth: settings?.query_depth,
      }, (chunk) => {
        if (chunk.type === 'graph_context') {
          latestResult = {
            ...latestResult,
            mode: chunk.data.mode || queryMode,
            resolved_mode: chunk.data.resolved_mode || queryMode,
            matched_nodes: chunk.data.matched_nodes || [],
            matched_communities: chunk.data.matched_communities || [],
            related_articles: chunk.data.related_articles || [],
            context_node_count: chunk.data.context_node_count || 0,
            context_edge_count: chunk.data.context_edge_count || 0,
          };
          setQueryResult(latestResult);
          return;
        }

        if (chunk.type === 'content') {
          accumulatedAnswer += chunk.data.content || '';
          latestResult = {
            ...latestResult,
            answer: accumulatedAnswer,
          };
          setQueryResult(latestResult);
          return;
        }

        if (chunk.type === 'error') {
          streamError = new Error(chunk.data.message || '图谱问答流式响应失败');
        }
      });

      if (streamError) {
        throw streamError;
      }

      return latestResult;
    },
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
  const normalizedAnswer = normalizeMarkdownImageContent(queryResult?.answer || '');

  const pageCardStyle = {
    borderRadius: 24,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    overflow: 'hidden',
  } as const;

  const surfaceStyle = {
    borderRadius: 18,
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    background: theme === 'dark' ? 'rgba(2, 6, 23, 0.44)' : 'rgba(255, 255, 255, 0.84)',
  } as const;

  const metricCardBodyStyle = {
    padding: 18,
  } as const;

  const workbenchItems = [
    {
      key: 'qa',
      label: buildWorkbenchTabLabel(<CommentOutlined />, '图谱问答'),
      children: (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            先围绕当前图谱提问，再用命中节点、社区和文章继续驱动画布。回答支持 Markdown 展示，适合直接输出结构化结论。
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
            placeholder="例如：请总结最近推理模型相关实体之间最关键的关系变化，并按主题分组输出。"
          />
          {queryResult ? (
            <Card
              size="small"
              style={surfaceStyle}
              title={`回答结果（实际模式：${queryResult.resolved_mode}）`}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                  {normalizedAnswer}
                </ReactMarkdown>
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
              description="输入问题后，这里会显示支持 Markdown 的问答结果，并保留继续探索的入口。"
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
            用来追踪两个实体、组织或文章之间是否存在可解释的连接路径。命中后会直接在下方知识图谱里高亮。
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
              style={surfaceStyle}
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
                    在图谱中重新高亮
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
              description="选定两个节点后，这里会展示路径解释，并同步驱动下方知识图谱高亮。"
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
            适合从列表快速进入图谱。先选实体或社区，再到下方知识图谱里继续看邻域、社区和文章。
          </Paragraph>
          <Search
            placeholder="搜索实体节点名称或 node key"
            allowClear
            value={navigationSearch}
            onChange={(event) => setNavigationSearch(event.target.value)}
          />
          <Tabs
            items={[
              {
                key: 'nodes',
                label: '实体入口',
                children: (
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
                            图谱定位
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
                ),
              },
              {
                key: 'communities',
                label: '社区入口',
                children: (
                  <List
                    size="small"
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
                ),
              },
            ]}
          />
        </Space>
      ),
    },
  ];

  return (
    <Spin spinning={statsLoading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card
          style={pageCardStyle}
          title="当前知识图谱状态"
          extra={
            <Button icon={<ReloadOutlined />} onClick={refreshGraphQueries}>
              刷新数据
            </Button>
          }
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="节点总数" value={stats?.total_nodes ?? 0} prefix={<ApartmentOutlined />} />
                </Card>
              </Col>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="边总数" value={stats?.total_edges ?? 0} prefix={<BranchesOutlined />} />
                </Card>
              </Col>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="文章总数" value={stats?.total_articles ?? 0} />
                </Card>
              </Col>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="已同步文章" value={stats?.synced_articles ?? 0} prefix={<SyncOutlined />} />
                </Card>
              </Col>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="失败文章" value={stats?.failed_articles ?? 0} />
                </Card>
              </Col>
              <Col xs={12} md={8} xl={4}>
                <Card size="small" style={surfaceStyle} styles={{ body: metricCardBodyStyle }}>
                  <Statistic title="覆盖率" value={coveragePercent} suffix="%" />
                </Card>
              </Col>
            </Row>
          </Space>
        </Card>

        {!stats?.enabled && (
          <Alert
            type="warning"
            showIcon
            message="知识图谱当前已关闭"
            description="请先在系统设置中启用知识图谱，再执行同步、问答、路径查询和图谱探索。"
          />
        )}

        <Card
          style={pageCardStyle}
          title="工具工作台"
          extra={<Text type="secondary">围绕当前图谱做问答、路径追踪和实体导航</Text>}
        >
          <Tabs
            activeKey={activeWorkbenchTab}
            onChange={(key) => setActiveWorkbenchTab(key as WorkbenchTabKey)}
            items={workbenchItems}
          />
        </Card>

        <div ref={graphSectionRef}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div>
              <Title level={4} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                知识图谱
              </Title>
              <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                在这里做可视化交互，配合上方工作台形成问答或查路径，再回图谱定位的闭环。
              </Paragraph>
            </div>
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={14}>
                <div style={{ ...surfaceStyle, padding: 20 }}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Title level={5} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                        运行状态
                      </Title>
                      <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                        这里聚合图谱可用性、同步配置、查询深度和最近快照时间，进入可视化前先确认图谱是否可用、数据是否新鲜。
                      </Paragraph>
                    </div>
                    <Space wrap size={[8, 8]}>
                      <Badge
                        status={stats?.enabled ? 'success' : 'warning'}
                        text={stats?.enabled ? '图谱已启用' : '图谱未启用'}
                      />
                      <Tag>自动同步 {settings?.auto_sync_enabled ? '开启' : '关闭'}</Tag>
                      <Tag>运行模式 {formatRunMode(syncMode)}</Tag>
                      <Tag>查询深度 {settings?.query_depth ?? '-'}</Tag>
                      <Tag>采集状态 {lastBuildStatus?.text || '暂无记录'}</Tag>
                      {stats?.snapshot_updated_at && (
                        <Tag>快照更新 {dayjs(stats.snapshot_updated_at).format('MM-DD HH:mm')}</Tag>
                      )}
                    </Space>
                    {stats?.last_build && lastBuildStatus && (
                      <div style={{ ...surfaceStyle, padding: 16 }}>
                        <Space direction="vertical" size={6}>
                          <Space wrap>
                            <Text strong>最近一次构建</Text>
                            <Tag color={lastBuildStatus.color}>{lastBuildStatus.text}</Tag>
                          </Space>
                          <Text type="secondary">
                            {stats.last_build.trigger_source} · {stats.last_build.sync_mode}
                          </Text>
                          <Text type="secondary">
                            处理 {stats.last_build.processed_articles}/{stats.last_build.total_articles} 篇文章，新增节点 {stats.last_build.nodes_upserted}，新增边 {stats.last_build.edges_upserted}
                          </Text>
                        </Space>
                      </div>
                    )}
                  </Space>
                </div>
              </Col>

              <Col xs={24} xl={10}>
                <div style={{ ...surfaceStyle, padding: 20, height: '100%' }}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Title level={5} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                        当前图谱视角
                      </Title>
                      <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                        明确告诉用户当前画布是在看全图、某个社区、某个节点，还是一条关系路径，避免在问答和可视化之间丢上下文。
                      </Paragraph>
                    </div>
                    <div style={{ ...surfaceStyle, padding: 16 }}>
                      <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                        {commandSummary.title}
                      </Text>
                      <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                        {commandSummary.description}
                      </Paragraph>
                    </div>
                    {communityItems.length > 0 && (
                      <div>
                        <Text strong>重点社区</Text>
                        <div style={{ marginTop: 10 }}>
                          {communityItems.slice(0, 4).map((community) => (
                            <Tag
                              key={community.community_id}
                              color="blue"
                              style={{ cursor: 'pointer', marginBottom: 8 }}
                              onClick={() => openCommunityDrawer(community)}
                            >
                              {community.label}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    )}
                  </Space>
                </div>
              </Col>
            </Row>
            {stats?.enabled ? (
              <KnowledgeGraphExplorer />
            ) : (
              <Card style={pageCardStyle}>
                <Empty description="知识图谱未启用，当前无法展示图谱画布" />
              </Card>
            )}
          </Space>
        </div>

        <Card
          style={pageCardStyle}
          title={
            <Space>
              <HistoryOutlined />
              <span>运维与构建</span>
            </Space>
          }
          extra={<Text type="secondary">低频运维动作和构建回看集中放在底部</Text>}
        >
          <Row gutter={[16, 16]}>
            {isAuthenticated && (
              <Col xs={24} xl={10}>
              <div style={{ ...surfaceStyle, padding: 20, height: '100%' }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <Title level={5} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                      运维工具
                    </Title>
                    <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                      这里只保留刷新、增量同步和全量重建。它们是低频动作，不再占据页面主操作区。
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
                      刷新图谱数据
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
                </Space>
              </div>
              </Col>
            )}

            <Col xs={24} xl={isAuthenticated ? 14 : 24}>
              <div style={{ ...surfaceStyle, padding: 20 }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div>
                    <Title level={5} style={{ margin: 0, color: getThemeColor(theme, 'text') }}>
                      构建历史
                    </Title>
                    <Paragraph style={{ marginTop: 8, marginBottom: 0, color: getThemeColor(theme, 'textSecondary') }}>
                      最近的构建记录直接与运维工具并排展示，便于执行同步后立刻回看结果。
                    </Paragraph>
                  </div>
                  <BuildHistoryList builds={builds} loading={buildsLoading} />
                </Space>
              </div>
            </Col>
          </Row>
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
