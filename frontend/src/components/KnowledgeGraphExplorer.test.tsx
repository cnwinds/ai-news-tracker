import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
            ['organization:openai', 'product:gpt-next'],
            [{ source: 'organization:openai', target: 'product:gpt-next' }]
          )
        }
      >
        聚焦路径
      </button>
      <KnowledgeGraphExplorer searchTerm="" limitNodes={160} />
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
        sync_mode: 'agent',
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
          node_key: 'organization:openai',
          label: 'OpenAI',
          node_type: 'organization',
          aliases: [],
          metadata: {},
          degree: 3,
          article_count: 1,
          centrality: 0.7,
          layout_x: 0,
          layout_y: 0,
        },
        {
          node_key: 'product:gpt-next',
          label: 'GPT-Next',
          node_type: 'product',
          aliases: [],
          metadata: {},
          degree: 8,
          article_count: 2,
          centrality: 0.4,
          layout_x: 0.6,
          layout_y: 0.1,
        },
      ],
      links: [
        {
          source: 'organization:openai',
          target: 'product:gpt-next',
          weight: 1,
          relation_types: ['DEVELOPED'],
          article_count: 1,
        },
      ],
      total_nodes: 2,
      total_links: 1,
      available_node_types: ['organization', 'product'],
      layout_mode: 'distance_weighted_kamada_kawai',
    });

    mocks.getKnowledgeGraphNode.mockResolvedValue({
      node: {
        node_key: 'organization:openai',
        label: 'OpenAI',
        node_type: 'organization',
        aliases: [],
        metadata: {
          description: 'AI organization',
          official_site: 'https://openai.com',
        },
        degree: 3,
        article_count: 1,
        centrality: 0.7,
      },
      neighbors: [
        {
          node_key: 'product:gpt-next',
          label: 'GPT-Next',
          node_type: 'product',
          aliases: [],
          metadata: {},
          degree: 8,
          article_count: 2,
          centrality: 0.4,
        },
      ],
      edges: [
        {
          source_node_key: 'organization:openai',
          target_node_key: 'product:gpt-next',
          relation_type: 'DEVELOPED',
          confidence: 'EXTRACTED',
          confidence_score: 1,
          weight: 1,
        },
      ],
      related_articles: [],
    });
  });

  it('reacts to focus commands and neighborhood expansion', async () => {
    renderWithProviders(<ExplorerHarness />);

    await userEvent.click(screen.getByRole('button', { name: '聚焦路径' }));

    await waitFor(() => {
      expect(mocks.getKnowledgeGraphSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          focus_node_keys: ['organization:openai', 'product:gpt-next'],
          expand_depth: 0,
        })
      );
    });

    expect(await screen.findByText('路径高亮中')).toBeInTheDocument();
    expect(screen.getByText('力导图')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getKnowledgeGraphNode).toHaveBeenCalledWith('organization:openai');
    });
    expect(await screen.findByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByText('organization')).toBeInTheDocument();
    expect(screen.getByText('AI organization')).toBeInTheDocument();
    expect(screen.getByText('official_site: https://openai.com')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: '全' }));

    await waitFor(() => {
      expect(mocks.getKnowledgeGraphSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          focus_node_keys: ['organization:openai'],
          expand_depth: 1,
        })
      );
    });
  });

  it('shows a hover preview for every graph node', async () => {
    const { container } = renderWithProviders(<KnowledgeGraphExplorer searchTerm="" limitNodes={160} />);

    await waitFor(() => {
      expect(container.querySelector('[data-node-key="organization:openai"]')).toBeTruthy();
    });

    const graphNode = container.querySelector('[data-node-key="organization:openai"]');
    expect(graphNode).toBeTruthy();
    await userEvent.hover(graphNode as Element);

    expect(await screen.findByText('节点预览')).toBeInTheDocument();
    expect(screen.getByText('中心性 0.70')).toBeInTheDocument();
    expect(screen.getByText('organization:openai')).toBeInTheDocument();
  });
});
