import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import KnowledgeGraphCommunityDrawer from '@/components/KnowledgeGraphCommunityDrawer';

const mocks = vi.hoisted(() => ({
  getKnowledgeGraphCommunity: vi.fn(),
  openModal: vi.fn(),
  setSelectedEngine: vi.fn(),
  focusArticle: vi.fn(),
  focusCommunity: vi.fn(),
  focusNode: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  apiService: {
    getKnowledgeGraphCommunity: mocks.getKnowledgeGraphCommunity,
  },
}));

vi.mock('@/contexts/AIConversationContext', () => ({
  useAIConversation: () => ({
    openModal: mocks.openModal,
    setSelectedEngine: mocks.setSelectedEngine,
  }),
}));

vi.mock('@/contexts/KnowledgeGraphViewContext', () => ({
  useKnowledgeGraphView: () => ({
    focusArticle: mocks.focusArticle,
    focusCommunity: mocks.focusCommunity,
    focusNode: mocks.focusNode,
  }),
}));

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <AntdApp>
          <KnowledgeGraphCommunityDrawer open communityId={7} onClose={vi.fn()} />
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

describe('KnowledgeGraphCommunityDrawer', () => {
  beforeEach(() => {
    mocks.getKnowledgeGraphCommunity.mockReset();
    mocks.openModal.mockReset();
    mocks.setSelectedEngine.mockReset();
    mocks.focusArticle.mockReset();
    mocks.focusCommunity.mockReset();
    mocks.focusNode.mockReset();

    mocks.getKnowledgeGraphCommunity.mockResolvedValue({
      community: {
        community_id: 7,
        label: '推理模型社区',
        node_count: 6,
        edge_count: 5,
        article_count: 3,
        top_nodes: [
          {
            node_key: 'model:o3',
            label: 'o3',
            node_type: 'model',
            aliases: [],
            metadata: {},
            degree: 8,
            article_count: 2,
            community_id: 7,
            centrality: 0.8,
          },
        ],
      },
      nodes: [
        {
          node_key: 'model:o3',
          label: 'o3',
          node_type: 'model',
          aliases: [],
          metadata: {},
          degree: 8,
          article_count: 2,
          community_id: 7,
          centrality: 0.8,
        },
      ],
      articles: [
        {
          id: 11,
          title: 'OpenAI reasoning update',
          title_zh: 'OpenAI 推理更新',
          url: 'https://example.com/openai-reasoning',
          source: 'OpenAI',
          relation_count: 3,
        },
      ],
      summary_text: '社区「推理模型社区」包含 6 个节点、5 条边、3 篇文章。',
      relation_types: ['competes_with', 'mentions'],
    });
  });

  it('opens graph qa and focus actions from community drill-down', async () => {
    renderDrawer();

    await screen.findByText('推理模型社区');

    await userEvent.click(await screen.findByRole('button', { name: /Graph 问答/ }));

    expect(mocks.setSelectedEngine).toHaveBeenCalledWith('graph');
    expect(mocks.openModal).toHaveBeenCalledWith(
      expect.stringContaining('推理模型社区')
    );

    await userEvent.click(screen.getByRole('button', { name: /聚焦社区/ }));
    expect(mocks.focusCommunity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        selectedNodeKey: 'model:o3',
      })
    );

    await userEvent.click(screen.getByRole('button', { name: '在画布中查看' }));
    expect(mocks.focusNode).toHaveBeenCalledWith(
      'model:o3',
      expect.objectContaining({
        communityId: 7,
      })
    );

    await userEvent.click(screen.getByRole('button', { name: '图谱定位' }));
    expect(mocks.focusArticle).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        communityId: 7,
      })
    );

    await waitFor(() => {
      expect(mocks.getKnowledgeGraphCommunity).toHaveBeenCalledWith(7);
    });
  });
});
