import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeGraphPanel from '@/components/KnowledgeGraphPanel';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphSettings: vi.fn(),
  getKnowledgeGraphStats: vi.fn(),
  getKnowledgeGraphBuilds: vi.fn(),
  getKnowledgeGraphNodes: vi.fn(),
  syncKnowledgeGraph: vi.fn(),
  queryKnowledgeGraph: vi.fn(),
  queryKnowledgeGraphStream: vi.fn(),
  structuredQueryKnowledgeGraph: vi.fn(),
  findKnowledgeGraphPath: vi.fn(),
  repairKnowledgeGraphIntegrity: vi.fn(),
  createErrorHandler: vi.fn(() => vi.fn()),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));
let mockIsAuthenticated = true;

vi.mock('@/services/api', () => ({
  apiService: {
    getKnowledgeGraphSettings: mocks.getKnowledgeGraphSettings,
    getKnowledgeGraphStats: mocks.getKnowledgeGraphStats,
    getKnowledgeGraphBuilds: mocks.getKnowledgeGraphBuilds,
    getKnowledgeGraphNodes: mocks.getKnowledgeGraphNodes,
    syncKnowledgeGraph: mocks.syncKnowledgeGraph,
    queryKnowledgeGraph: mocks.queryKnowledgeGraph,
    queryKnowledgeGraphStream: mocks.queryKnowledgeGraphStream,
    structuredQueryKnowledgeGraph: mocks.structuredQueryKnowledgeGraph,
    findKnowledgeGraphPath: mocks.findKnowledgeGraphPath,
    repairKnowledgeGraphIntegrity: mocks.repairKnowledgeGraphIntegrity,
  },
}));

vi.mock('@/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    createErrorHandler: mocks.createErrorHandler,
    showInfo: mocks.showInfo,
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

describe('KnowledgeGraphPanel', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mocks.getKnowledgeGraphSettings.mockReset();
    mocks.getKnowledgeGraphStats.mockReset();
    mocks.getKnowledgeGraphBuilds.mockReset();
    mocks.getKnowledgeGraphNodes.mockReset();
    mocks.syncKnowledgeGraph.mockReset();
    mocks.queryKnowledgeGraph.mockReset();
    mocks.queryKnowledgeGraphStream.mockReset();
    mocks.structuredQueryKnowledgeGraph.mockReset();
    mocks.findKnowledgeGraphPath.mockReset();
    mocks.repairKnowledgeGraphIntegrity.mockReset();
    mocks.createErrorHandler.mockClear();
    mocks.showInfo.mockReset();
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
      total_articles: 20,
      synced_articles: 18,
      failed_articles: 1,
      coverage: 0.9,
      snapshot_updated_at: '2026-04-08T12:00:00Z',
      node_type_counts: {},
      relation_type_counts: {},
      top_nodes: [
        {
          node_key: 'organization:openai',
          label: 'OpenAI',
          node_type: 'organization',
          aliases: [],
          metadata: {},
          degree: 9,
          article_count: 3,
          centrality: 0.8,
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

    mocks.getKnowledgeGraphNodes.mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  it('renders the knowledge graph page in the new section order', async () => {
    renderWithProviders(<KnowledgeGraphPanel />);

    expect(await screen.findByText('知识图谱')).toBeInTheDocument();
    expect(screen.getByLabelText('打开运维管理')).toBeInTheDocument();
    expect(await screen.findByText('Mock Graph Explorer')).toBeInTheDocument();
    expect(screen.getByText('问答')).toBeInTheDocument();
    expect(screen.getByText('结构化')).toBeInTheDocument();
  });

  it('renders markdown answers in the qa workbench', async () => {
    mocks.queryKnowledgeGraphStream.mockImplementation(async (_request, onChunk) => {
      onChunk({
        type: 'graph_context',
        data: {
          mode: 'hybrid',
          resolved_mode: 'graph',
          matched_nodes: [],
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

    await screen.findByText('问答');

    const questionInput = Array.from(document.querySelectorAll('textarea.ant-input')).find(
      (element) => element.getAttribute('aria-hidden') !== 'true'
    );

    expect(questionInput).toBeTruthy();
    await userEvent.type(questionInput as HTMLElement, '最近有哪些变化？');
    await userEvent.click(screen.getByLabelText('开始问答'));

    expect(mocks.queryKnowledgeGraphStream).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: '结论' })).toBeInTheDocument();
    expect(screen.getByText('第一条')).toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
  });

  it('runs structured graph query and shows parsed conditions', async () => {
    mocks.structuredQueryKnowledgeGraph.mockResolvedValue({
      question: '帮我找基于 Agent-to-UI，并解决跨平台的应用',
      parsed_query: {
        target_type: 'product',
        conditions: [
          { relation_type: 'BASED_ON', target_type: 'concept', target_terms: ['Agent-to-UI', 'A2UI'] },
          { relation_type: 'SOLVES', target_type: 'feature', target_terms: ['跨平台'] },
        ],
      },
      results: [
        {
          node: {
            node_key: 'product:agenui',
            label: 'AGenUI',
            node_type: 'product',
            aliases: [],
            metadata: {},
            degree: 2,
            article_count: 1,
            centrality: 0,
          },
          matched_edges: [
            {
              source_node_key: 'product:agenui',
              target_node_key: 'concept:agent-to-ui',
              relation_type: 'BASED_ON',
              confidence: 'EXTRACTED',
              confidence_score: 0.95,
              weight: 1,
              source_article_id: 1,
              source_label: 'AGenUI',
              target_label: 'Agent-to-UI',
              evidence_snippet: '基于 Agent-to-UI 协议',
              metadata: {},
            },
          ],
          related_articles: [
            {
              id: 1,
              title: 'AGenUI released',
              title_zh: 'AGenUI 发布',
              url: 'https://example.com/a',
              source: 'Amap',
              published_at: '2026-04-08T12:00:00Z',
              summary: '摘要',
              detailed_summary: null,
              importance: 'high',
              tags: [],
              relation_count: 1,
              distance: null,
            },
          ],
        },
      ],
      related_articles: [
        {
          id: 1,
          title: 'AGenUI released',
          title_zh: 'AGenUI 发布',
          url: 'https://example.com/a',
          source: 'Amap',
          published_at: '2026-04-08T12:00:00Z',
          summary: '摘要',
          detailed_summary: null,
          importance: 'high',
          tags: [],
          relation_count: 1,
          distance: null,
        },
      ],
      answer: '命中结果：AGenUI',
    });

    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('结构化');
    await userEvent.click(screen.getByRole('button', { name: /结构化/ }));

    const questionInput = Array.from(document.querySelectorAll('textarea.ant-input')).find(
      (element) => element.getAttribute('aria-hidden') !== 'true'
    );

    expect(questionInput).toBeTruthy();
    await userEvent.type(questionInput as HTMLElement, '帮我找基于 Agent-to-UI，并解决跨平台的应用');
    await userEvent.click(screen.getByRole('button', { name: '执行结构化查询' }));

    expect(mocks.structuredQueryKnowledgeGraph).toHaveBeenCalled();
    expect(await screen.findByText('目标类型：product · 条件 2 · 命中 1')).toBeInTheDocument();
    expect(screen.getByText('条件 1：BASED_ON → concept / Agent-to-UI、A2UI')).toBeInTheDocument();
    expect(screen.getByText('AGenUI')).toBeInTheDocument();
    expect(screen.getByText(/AGenUI -\[BASED_ON\]-> Agent-to-UI/)).toBeInTheDocument();
  });

  it('switches between path and navigation tools', async () => {
    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('路径');

    await userEvent.click(screen.getByText('路径'));
    expect(await screen.findByRole('button', { name: '查询最短路径' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('导航'));
    expect(await screen.findByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('organization · 度数 9')).toBeInTheDocument();
  });

  it('hides the operations and build panel when unauthenticated', async () => {
    mockIsAuthenticated = false;
    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByText('问答');
    expect(screen.queryByLabelText('打开运维管理')).not.toBeInTheDocument();
  });

  it('shows an inline integrity repair result when no issues remain', async () => {
    mocks.repairKnowledgeGraphIntegrity.mockResolvedValue({
      dry_run: false,
      repaired: true,
      actions: ['从数据库重建图谱快照'],
      deleted_dangling_edges: 0,
      deleted_orphan_nodes: 0,
      deleted_missing_article_states: 0,
      resynced_article_ids: [],
      resync_result: null,
      before: {
        healthy: true,
        checked_at: '2026-04-08T12:00:00Z',
        db_counts: {},
        snapshot_counts: {},
        issues: [],
        suspect_article_ids: [],
        keyword_article_ids: [],
        recommendations: ['未发现需要修复的结构问题。'],
      },
      after: {
        healthy: true,
        checked_at: '2026-04-08T12:01:00Z',
        db_counts: {},
        snapshot_counts: {},
        issues: [],
        suspect_article_ids: [],
        keyword_article_ids: [],
        recommendations: ['未发现需要修复的结构问题。'],
      },
    });

    renderWithProviders(<KnowledgeGraphPanel />);

    await screen.findByLabelText('打开运维管理');
    await userEvent.click(screen.getByLabelText('打开运维管理'));
    await screen.findByText('同步与修复');
    await userEvent.click(screen.getByRole('button', { name: '诊断修复' }));

    expect(await screen.findByText('诊断修复完成，未发现需要继续处理的问题')).toBeInTheDocument();
    expect(screen.getByText(/执行动作：从数据库重建图谱快照/)).toBeInTheDocument();
  });
});
