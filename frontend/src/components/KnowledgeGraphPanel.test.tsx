import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeGraphPanel from '@/components/KnowledgeGraphPanel';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphSettings: vi.fn(),
  getKnowledgeGraphStats: vi.fn(),
  getKnowledgeGraphBuilds: vi.fn(),
  getKnowledgeGraphCommunities: vi.fn(),
  getKnowledgeGraphNodes: vi.fn(),
  syncKnowledgeGraph: vi.fn(),
  queryKnowledgeGraph: vi.fn(),
  queryKnowledgeGraphStream: vi.fn(),
  findKnowledgeGraphPath: vi.fn(),
  createErrorHandler: vi.fn(() => vi.fn()),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));
let mockIsAuthenticated = true;

vi.mock('@/services/api', () => ({
  apiService: {
    getKnowledgeGraphSettings: mocks.getKnowledgeGraphSettings,
    getKnowledgeGraphStats: mocks.getKnowledgeGraphStats,
    getKnowledgeGraphBuilds: mocks.getKnowledgeGraphBuilds,
    getKnowledgeGraphCommunities: mocks.getKnowledgeGraphCommunities,
    getKnowledgeGraphNodes: mocks.getKnowledgeGraphNodes,
    syncKnowledgeGraph: mocks.syncKnowledgeGraph,
    queryKnowledgeGraph: mocks.queryKnowledgeGraph,
    queryKnowledgeGraphStream: mocks.queryKnowledgeGraphStream,
    findKnowledgeGraphPath: mocks.findKnowledgeGraphPath,
  },
}));

vi.mock('@/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    createErrorHandler: mocks.createErrorHandler,
    showSuccess: mocks.showSuccess,
    showWarning: mocks.showWarning,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

vi.mock('@/components/KnowledgeGraphExplorer', () => ({
  default: () => <div>Mock Graph Explorer</div>,
}));

vi.mock('@/components/KnowledgeGraphCommunityDrawer', () => ({
  default: () => null,
}));

describe('KnowledgeGraphPanel', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mocks.getKnowledgeGraphSettings.mockReset();
    mocks.getKnowledgeGraphStats.mockReset();
    mocks.getKnowledgeGraphBuilds.mockReset();
    mocks.getKnowledgeGraphCommunities.mockReset();
    mocks.getKnowledgeGraphNodes.mockReset();
    mocks.syncKnowledgeGraph.mockReset();
    mocks.queryKnowledgeGraph.mockReset();
    mocks.queryKnowledgeGraphStream.mockReset();
    mocks.findKnowledgeGraphPath.mockReset();
    mocks.createErrorHandler.mockClear();
    mocks.showSuccess.mockReset();
    mocks.showWarning.mockReset();

    mocks.getKnowledgeGraphSettings.mockResolvedValue({
      enabled: true,
      auto_sync_enabled: true,
      run_mode: 'auto',
      max_articles_per_sync: 100,
      query_depth: 2,
    });

    mocks.getKnowledgeGraphStats.mockResolvedValue({
      enabled: true,
      total_nodes: 42,
      total_edges: 84,
      total_article_nodes: 12,
      total_articles: 20,
      synced_articles: 18,
      failed_articles: 1,
      coverage: 0.9,
      snapshot_updated_at: '2026-04-08T12:00:00Z',
      node_type_counts: {},
      relation_type_counts: {},
      top_nodes: [
        {
          node_key: 'model:o3',
          label: 'o3',
          node_type: 'model',
          aliases: [],
          metadata: {},
          degree: 9,
          article_count: 3,
          community_id: 1,
          centrality: 0.8,
        },
      ],
      top_communities: [
        {
          community_id: 1,
          label: '推理模型社区',
          node_count: 6,
          edge_count: 5,
          article_count: 3,
          top_nodes: [],
        },
      ],
      last_build: {
        build_id: 'build-1',
        status: 'completed',
        trigger_source: 'dashboard',
        sync_mode: 'auto',
        total_articles: 20,
        processed_articles: 18,
        skipped_articles: 1,
        failed_articles: 1,
        nodes_upserted: 12,
        edges_upserted: 24,
        started_at: '2026-04-08T11:00:00Z',
        completed_at: '2026-04-08T11:03:00Z',
        extra_data: {},
      },
    });

    mocks.getKnowledgeGraphBuilds.mockResolvedValue([
      {
        build_id: 'build-1',
        status: 'completed',
        trigger_source: 'dashboard',
        sync_mode: 'auto',
        total_articles: 20,
        processed_articles: 18,
        skipped_articles: 1,
        failed_articles: 1,
        nodes_upserted: 12,
        edges_upserted: 24,
        started_at: '2026-04-08T11:00:00Z',
        completed_at: '2026-04-08T11:03:00Z',
        extra_data: {},
      },
    ]);

    mocks.getKnowledgeGraphCommunities.mockResolvedValue({
      items: [
        {
          community_id: 1,
          label: '推理模型社区',
          node_count: 6,
          edge_count: 5,
          article_count: 3,
          top_nodes: [],
        },
      ],
      total: 1,
    });

    mocks.getKnowledgeGraphNodes.mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  it('renders the knowledge graph page in the new section order', async () => {
    renderWithProviders(<KnowledgeGraphPanel />);

    expect(await screen.findByText('当前知识图谱状态')).toBeInTheDocument();
    expect(screen.getByText('工具工作台')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '知识图谱' })).toBeInTheDocument();
    expect(screen.getByText('运维与构建')).toBeInTheDocument();
    expect(screen.getByText('运行状态')).toBeInTheDocument();
    expect(await screen.findByText('Mock Graph Explorer')).toBeInTheDocument();
    expect(screen.getByText('图谱问答')).toBeInTheDocument();
    expect(screen.getByText('图谱已启用')).toBeInTheDocument();
  });

  it('renders markdown answers in the qa workbench', async () => {
    mocks.queryKnowledgeGraphStream.mockImplementation(async (_request, onChunk) => {
      onChunk({
        type: 'graph_context',
        data: {
          mode: 'hybrid',
          resolved_mode: 'graph',
          matched_nodes: [],
          matched_communities: [],
          related_articles: [],
          context_node_count: 2,
          context_edge_count: 1,
        },
      });
      onChunk({
        type: 'content',
        data: {
          content: '## 结论\n- 第一条',
        },
      });
      onChunk({
        type: 'content',
        data: {
          content: '\n- 第二条',
        },
      });
      onChunk({
        type: 'done',
        data: {},
      });
    });

    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('工具工作台');

    const questionInput = Array.from(document.querySelectorAll('textarea.ant-input')).find(
      (element) => element.getAttribute('aria-hidden') !== 'true'
    );

    expect(questionInput).toBeTruthy();
    await userEvent.type(questionInput as HTMLElement, '最近有哪些变化？');
    await userEvent.click(screen.getByRole('button', { name: '开始问答' }));

    expect(mocks.queryKnowledgeGraphStream).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: '结论' })).toBeInTheDocument();
    expect(screen.getByText('第一条')).toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
  });

  it('switches between path and navigation tools', async () => {
    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('工具工作台');

    await userEvent.click(screen.getByText('关系路径'));
    expect(await screen.findByRole('button', { name: '查询最短路径' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('实体导航'));
    expect(await screen.findByText('实体入口')).toBeInTheDocument();
    expect(await screen.findByText('社区入口')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '社区入口' }));
    expect(await screen.findByRole('button', { name: '打开社区' })).toBeInTheDocument();
  });

  it('hides operation tools when unauthenticated', async () => {
    mockIsAuthenticated = false;
    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('运维与构建');
    expect(screen.queryByRole('heading', { name: '运维工具' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '构建历史' })).toBeInTheDocument();
  });
});
