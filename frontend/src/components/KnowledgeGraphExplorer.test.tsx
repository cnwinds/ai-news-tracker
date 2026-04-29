import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import KnowledgeGraphExplorer from '@/components/KnowledgeGraphExplorer';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphSnapshot: vi.fn(),
  getKnowledgeGraphNode: vi.fn(),
  openModal: vi.fn(),
  setSelectedEngine: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  apiService: {
    getKnowledgeGraphSnapshot: mocks.getKnowledgeGraphSnapshot,
    getKnowledgeGraphNode: mocks.getKnowledgeGraphNode,
  },
}));

vi.mock('@/contexts/AIConversationContext', () => ({
  useAIConversation: () => ({
    openModal: mocks.openModal,
    setSelectedEngine: mocks.setSelectedEngine,
  }),
}));

function ExplorerHarness() {
  const { focusPath } = useKnowledgeGraphView();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          focusPath(
            ['article:1', 'source:OpenAI'],
            [{ source: 'article:1', target: 'source:OpenAI' }]
          )
        }
      >
        聚焦路径
      </button>
      <KnowledgeGraphExplorer />
    </>
  );
}

describe('KnowledgeGraphExplorer', () => {
  beforeEach(() => {
    mocks.getKnowledgeGraphSnapshot.mockReset();
    mocks.getKnowledgeGraphNode.mockReset();
    mocks.openModal.mockReset();
    mocks.setSelectedEngine.mockReset();

    mocks.getKnowledgeGraphSnapshot.mockResolvedValue({
      generated_at: '2026-04-08T10:00:00Z',
      build: {
        build_id: 'build-1',
        status: 'completed',
        trigger_source: 'test',
        sync_mode: 'deterministic',
        total_articles: 1,
        processed_articles: 1,
        skipped_articles: 0,
        failed_articles: 0,
        nodes_upserted: 2,
        edges_upserted: 1,
        started_at: '2026-04-08T10:00:00Z',
        completed_at: '2026-04-08T10:00:01Z',
      },
      nodes: [
        {
          node_key: 'article:1',
          label: 'OpenAI reasoning update',
          node_type: 'article',
          aliases: [],
          metadata: {},
          degree: 3,
          article_count: 1,
          community_id: 1,
          centrality: 0.4,
          layout_x: 0,
          layout_y: 0,
        },
        {
          node_key: 'source:OpenAI',
          label: 'OpenAI',
          node_type: 'source',
          aliases: [],
          metadata: {},
          degree: 8,
          article_count: 2,
          community_id: 1,
          centrality: 0.7,
          layout_x: 0.6,
          layout_y: 0.1,
        },
      ],
      links: [
        {
          source: 'article:1',
          target: 'source:OpenAI',
          weight: 1,
          relation_types: ['mentions'],
          article_count: 1,
        },
      ],
      communities: [
        {
          community_id: 1,
          label: 'OpenAI 社区',
          node_count: 2,
          edge_count: 1,
          article_count: 1,
          top_nodes: [],
        },
      ],
      total_nodes: 2,
      total_links: 1,
      available_node_types: ['article', 'source'],
      layout_mode: 'distance_weighted_kamada_kawai',
    });

    mocks.getKnowledgeGraphNode.mockResolvedValue({
      node: {
        node_key: 'article:1',
        label: 'OpenAI reasoning update',
        node_type: 'article',
        aliases: [],
        metadata: {},
        degree: 3,
        article_count: 1,
        community_id: 1,
        centrality: 0.4,
      },
      neighbors: [
        {
          node_key: 'source:OpenAI',
          label: 'OpenAI',
          node_type: 'source',
          aliases: [],
          metadata: {},
          degree: 8,
          article_count: 2,
          community_id: 1,
          centrality: 0.7,
        },
      ],
      edges: [
        {
          source_node_key: 'article:1',
          target_node_key: 'source:OpenAI',
          relation_type: 'mentions',
          confidence: 'EXTRACTED',
          confidence_score: 1,
          weight: 1,
        },
      ],
      related_articles: [],
      matched_communities: [],
    });
  });

  it('reacts to focus commands and neighborhood expansion', async () => {
    renderWithProviders(<ExplorerHarness />);

    await userEvent.click(screen.getByRole('button', { name: '聚焦路径' }));

    await waitFor(() => {
      expect(mocks.getKnowledgeGraphSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          focus_node_keys: ['article:1', 'source:OpenAI'],
          expand_depth: 0,
        })
      );
    });

    expect(await screen.findByText('路径高亮')).toBeInTheDocument();
    expect(screen.getByText('距离布局')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getKnowledgeGraphNode).toHaveBeenCalledWith('article:1');
    });
    expect(await screen.findByRole('heading', { name: 'OpenAI reasoning update' })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /1 跳邻域/ }));

    await waitFor(() => {
      expect(mocks.getKnowledgeGraphSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          focus_node_keys: ['article:1'],
          expand_depth: 1,
        })
      );
    });
  });

  it('shows a hover preview for every graph node', async () => {
    const { container } = renderWithProviders(<KnowledgeGraphExplorer />);

    await waitFor(() => {
      expect(container.querySelector('[data-node-key="source:OpenAI"]')).toBeTruthy();
    });

    const graphNode = container.querySelector('[data-node-key="source:OpenAI"]');
    expect(graphNode).toBeTruthy();
    expect(graphNode).toHaveAttribute('transform', 'translate(908, 379.6666666666667)');
    await userEvent.hover(graphNode as Element);

    expect(await screen.findByText('节点预览')).toBeInTheDocument();
    expect(screen.getByText('中心性 0.70')).toBeInTheDocument();
    expect(screen.getByText('source:OpenAI')).toBeInTheDocument();
  });
});
