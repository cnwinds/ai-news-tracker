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
  findKnowledgeGraphPath: vi.fn(),
  createErrorHandler: vi.fn(() => vi.fn()),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  apiService: {
    getKnowledgeGraphSettings: mocks.getKnowledgeGraphSettings,
    getKnowledgeGraphStats: mocks.getKnowledgeGraphStats,
    getKnowledgeGraphBuilds: mocks.getKnowledgeGraphBuilds,
    getKnowledgeGraphCommunities: mocks.getKnowledgeGraphCommunities,
    getKnowledgeGraphNodes: mocks.getKnowledgeGraphNodes,
    syncKnowledgeGraph: mocks.syncKnowledgeGraph,
    queryKnowledgeGraph: mocks.queryKnowledgeGraph,
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
    isAuthenticated: true,
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
    mocks.getKnowledgeGraphSettings.mockReset();
    mocks.getKnowledgeGraphStats.mockReset();
    mocks.getKnowledgeGraphBuilds.mockReset();
    mocks.getKnowledgeGraphCommunities.mockReset();
    mocks.getKnowledgeGraphNodes.mockReset();
    mocks.syncKnowledgeGraph.mockReset();
    mocks.queryKnowledgeGraph.mockReset();
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

  it('organizes the workbench around quick actions and tabbed tools', async () => {
    renderWithProviders(<KnowledgeGraphPanel />);

    expect(await screen.findByText('知识图谱工作台')).toBeInTheDocument();
    expect(await screen.findByText('图谱已启用')).toBeInTheDocument();
    expect(await screen.findByText('Mock Graph Explorer')).toBeInTheDocument();
    expect(screen.getByText('图谱问答')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /查一条关系路径/ }));
    expect(await screen.findByRole('button', { name: '查询最短路径' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /跳到实体 \/ 社区/ }));
    expect(await screen.findByText('实体入口')).toBeInTheDocument();
    expect(await screen.findByText('社区入口')).toBeInTheDocument();
    expect(await screen.findByText('推理模型社区')).toBeInTheDocument();
  });
});
