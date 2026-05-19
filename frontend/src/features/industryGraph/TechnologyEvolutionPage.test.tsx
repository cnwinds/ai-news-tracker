import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import TechnologyEvolutionPage from './TechnologyEvolutionPage';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  getIndustryGraphStats: vi.fn(),
  getIndustryGraphSuggestedQuestions: vi.fn(),
  importArticlesToIndustryGraph: vi.fn(),
  processIndustryGraphArticles: vi.fn(),
  listIndustryGraphConversations: vi.fn(),
  getIndustryGraphConversation: vi.fn(),
  queryIndustryGraphStream: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  apiService: apiMocks,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: authMocks.useAuth,
}));

describe('TechnologyEvolutionPage', () => {
  beforeEach(() => {
    apiMocks.getIndustryGraphStats.mockReset();
    apiMocks.getIndustryGraphSuggestedQuestions.mockReset();
    apiMocks.importArticlesToIndustryGraph.mockReset();
    apiMocks.processIndustryGraphArticles.mockReset();
    apiMocks.listIndustryGraphConversations.mockReset();
    apiMocks.getIndustryGraphConversation.mockReset();
    apiMocks.queryIndustryGraphStream.mockReset();
    authMocks.useAuth.mockReset();

    authMocks.useAuth.mockReturnValue({
      isAuthenticated: true,
      username: 'analyst',
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    apiMocks.getIndustryGraphStats.mockResolvedValue({
      total_documents: 12,
      processed_documents: 2,
      pending_documents: 10,
      failed_documents: 0,
      total_entities: 38,
      total_relations: 71,
      total_evidence: 95,
      total_conversations: 2,
      latest_metric_generated_at: null,
    });
    apiMocks.getIndustryGraphSuggestedQuestions.mockResolvedValue({
      items: [
        {
          id: 1,
          question: '最近 3 个月技术方面有什么新的变化趋势？',
          scenario_key: 'technology_evolution',
          reason: '测试',
          hot_entities: [],
          priority: 1,
          generated_for_date: '2026-05-18T00:00:00',
        },
      ],
    });
    apiMocks.listIndustryGraphConversations.mockResolvedValue({
      items: [
        {
          id: 3,
          title: '历史技术趋势分析',
          primary_scenario: 'technology_evolution',
          created_at: '2026-05-18T08:00:00',
          updated_at: '2026-05-18T09:30:00',
          messages: [],
        },
      ],
    });
    apiMocks.getIndustryGraphConversation.mockResolvedValue({
      id: 3,
      title: '历史技术趋势分析',
      primary_scenario: 'technology_evolution',
      created_at: '2026-05-18T08:00:00',
      updated_at: '2026-05-18T09:30:00',
      messages: [
        {
          id: 31,
          role: 'user',
          content_text: '历史问题',
          content_blocks: [],
          query_plan: null,
          created_at: '2026-05-18T08:00:00',
        },
        {
          id: 32,
          role: 'assistant',
          content_text: '历史回答 [证据1]',
          content_blocks: [
            {
              type: 'text',
              data: { text: '历史回答 [证据1]' },
            },
            {
              type: 'evidence_card',
              data: {
                id: 9,
                relation_id: 9,
                relation_type: 'USES',
                source_entity: 'Agent Memory Graph',
                target_entity: 'Copilot Studio',
                document_id: 5,
                title: '历史证据文章',
                source: 'Example',
                published_at: '2026-05-18T00:00:00',
                evidence_snippet: '历史证据片段',
                confidence: 'EXTRACTED',
                confidence_score: 0.9,
              },
            },
          ],
          query_plan: null,
          created_at: '2026-05-18T08:01:00',
        },
      ],
    });
    apiMocks.importArticlesToIndustryGraph.mockResolvedValue({ imported: 10, skipped: 40 });
    apiMocks.processIndustryGraphArticles.mockResolvedValue({
      imported: 0,
      import_skipped: 5,
      processed: 1,
      skipped: 0,
      failed: 0,
      entities_upserted: 3,
      relations_upserted: 2,
      evidence_upserted: 2,
      processed_documents: [
        {
          document_id: 1,
          article_id: 1,
          title: 'Agent Memory Graph',
          title_zh: 'Agent 记忆图',
          entities: 3,
          relations: 2,
        },
      ],
      errors: [],
    });
    apiMocks.queryIndustryGraphStream.mockImplementation((
      _request: unknown,
      onChunk: (chunk: unknown) => void
    ) => {
      onChunk({
        type: 'query_plan',
        data: {
          primary_scenario: 'technology_evolution',
          secondary_scenarios: [],
          time_range: { preset: 'last_3_months' },
          analysis_tasks: ['trend_detection'],
          entities: [],
          output: ['summary', 'ranked_trends'],
        },
      });
      onChunk({
        type: 'trend_card',
        data: {
          technology_id: 1,
          technology: 'Agent Memory Graph',
          trend_score: 2.4,
          growth_rate: 0,
          document_count: 4,
          paper_count: 1,
          product_count: 2,
          company_count: 1,
          benchmark_count: 0,
          evidence_count: 4,
          summary: 'Agent Memory Graph 近期关联信号增强。',
        },
      });
      onChunk({
        type: 'evidence_card',
        data: {
          id: 1,
          relation_id: 1,
          relation_type: 'USES',
          source_entity: 'Agent Memory Graph',
          target_entity: 'Copilot Studio',
          document_id: 1,
          title: 'Agent Memory Graph reaches products',
          title_zh: 'Agent Memory Graph 进入产品',
          source: 'Example AI',
          published_at: '2026-05-18T00:00:00',
          evidence_snippet: 'Agent Memory Graph is used by Copilot Studio.',
          confidence: 'EXTRACTED',
          confidence_score: 0.9,
        },
      });
      onChunk({
        type: 'local_graph',
        data: {
          nodes: [
            {
              id: 1,
              entity_key: 'technology:agent-memory-graph',
              entity_type: 'Technology',
              label: 'Agent Memory Graph',
              description: null,
              properties: {},
            },
            {
              id: 2,
              entity_key: 'product:copilot-studio',
              entity_type: 'Product',
              label: 'Copilot Studio',
              description: null,
              properties: {},
            },
          ],
          edges: [
            {
              id: 1,
              source_id: 1,
              target_id: 2,
              relation_type: 'USES',
              confidence: 'EXTRACTED',
              confidence_score: 0.9,
              evidence_count: 2,
            },
          ],
        },
      });
      onChunk({
        type: 'text_delta',
        data: { content: '总体判断：Agent Memory Graph 正在从论文信号' },
      });
      onChunk({
        type: 'text_delta',
        data: { content: '走向产品化验证。' },
      });
      onChunk({
        type: 'done',
        data: {
          conversation_id: 7,
          followup_questions: ['Agent Memory Graph 有哪些代表产品？'],
        },
      });
      return Promise.resolve();
    });
  });

  it('renders daily suggested questions and streams a report', async () => {
    renderWithProviders(<TechnologyEvolutionPage />);

    const suggestedQuestion = await screen.findByRole('button', {
      name: '最近 3 个月技术方面有什么新的变化趋势？',
    });
    const overviewButton = screen.getByRole('button', { name: '技术演进概览' });
    expect(overviewButton).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据准备设置' })).toBeInTheDocument();
    expect(apiMocks.listIndustryGraphConversations).toHaveBeenCalledWith(5, 0);
    await userEvent.hover(overviewButton);
    expect(await screen.findByText('技术演进分析')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();

    await userEvent.click(suggestedQuestion);

    await waitFor(() => {
      expect(apiMocks.queryIndustryGraphStream).toHaveBeenCalledWith(
        expect.objectContaining({
          question: '最近 3 个月技术方面有什么新的变化趋势？',
          scenario: 'technology_evolution',
        }),
        expect.any(Function)
      );
    });

    expect(await screen.findByText('总体判断：Agent Memory Graph 正在从论文信号走向产品化验证。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '趋势 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '证据 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图谱 1' })).toBeInTheDocument();
    expect(screen.queryByText('局部解释图')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '趋势 1' }));
    expect(screen.getAllByText('Agent Memory Graph').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '证据 1' }));
    expect(screen.getByText('Agent Memory Graph 进入产品')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '图谱 1' }));
    expect(screen.getByText('局部解释图')).toBeInTheDocument();
    expect(screen.getByText('会话 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent Memory Graph 有哪些代表产品？' })).toBeInTheDocument();
  });

  it('shows reference materials before streaming answer text', async () => {
    let onStreamChunk: ((chunk: unknown) => void) | undefined;
    let resolveStream: (() => void) | undefined;
    apiMocks.queryIndustryGraphStream.mockImplementation((
      _request: unknown,
      onChunk: (chunk: unknown) => void
    ) => {
      onStreamChunk = onChunk;
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });

    renderWithProviders(<TechnologyEvolutionPage />);

    const suggestedQuestion = await screen.findByRole('button', {
      name: '最近 3 个月技术方面有什么新的变化趋势？',
    });
    await userEvent.click(suggestedQuestion);

    await waitFor(() => {
      expect(onStreamChunk).toBeDefined();
    });

    act(() => {
      onStreamChunk?.({
        type: 'query_plan',
        data: {
          primary_scenario: 'technology_evolution',
          secondary_scenarios: [],
          time_range: { preset: 'last_3_months' },
          analysis_tasks: ['trend_detection'],
          entities: [],
          output: ['summary', 'ranked_trends'],
        },
      });
      onStreamChunk?.({
        type: 'trend_card',
        data: {
          technology_id: 1,
          technology: 'Agent Memory Graph',
          trend_score: 2.4,
          growth_rate: 0,
          document_count: 4,
          paper_count: 1,
          product_count: 2,
          company_count: 1,
          benchmark_count: 0,
          evidence_count: 4,
          summary: 'Agent Memory Graph 近期关联信号增强。',
        },
      });
      onStreamChunk?.({
        type: 'evidence_card',
        data: {
          id: 1,
          relation_id: 1,
          relation_type: 'USES',
          source_entity: 'Agent Memory Graph',
          target_entity: 'Copilot Studio',
          document_id: 1,
          title: 'Agent Memory Graph reaches products',
          title_zh: 'Agent Memory Graph 进入产品',
          source: 'Example AI',
          published_at: '2026-05-18T00:00:00',
          evidence_snippet: 'Agent Memory Graph is used by Copilot Studio.',
          confidence: 'EXTRACTED',
          confidence_score: 0.9,
        },
      });
      onStreamChunk?.({
        type: 'local_graph',
        data: {
          nodes: [
            {
              id: 1,
              entity_key: 'technology:agent-memory-graph',
              entity_type: 'Technology',
              label: 'Agent Memory Graph',
              description: null,
              properties: {},
            },
          ],
          edges: [],
        },
      });
    });

    expect(await screen.findByRole('button', { name: '趋势 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '证据 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '图谱 1' })).toBeInTheDocument();
    expect(screen.getByText('正在基于参考资料生成分析...')).toBeInTheDocument();
    expect(screen.queryByText(/总体判断/)).not.toBeInTheDocument();

    act(() => {
      onStreamChunk?.({
        type: 'text_delta',
        data: { content: '总体判断：Agent Memory Graph 正在从论文信号 [证据1]' },
      });
    });
    expect(await screen.findByText(/总体判断：Agent Memory Graph 正在从论文信号/)).toBeInTheDocument();
    const evidenceReference = screen.getByText('[证据1]');
    expect(evidenceReference).toBeInTheDocument();
    await userEvent.hover(evidenceReference);
    expect(await screen.findByText('Agent Memory Graph 进入产品')).toBeInTheDocument();

    act(() => {
      onStreamChunk?.({
        type: 'text_delta',
        data: { content: '走向产品化验证。' },
      });
    });
    expect(await screen.findByText('走向产品化验证。')).toBeInTheDocument();

    act(() => {
      onStreamChunk?.({
        type: 'done',
        data: {
          conversation_id: 8,
          followup_questions: [],
        },
      });
      resolveStream?.();
    });
    expect(await screen.findByText('会话 8')).toBeInTheDocument();
  });

  it('runs incremental article extraction from the data preparation panel', async () => {
    renderWithProviders(<TechnologyEvolutionPage />);

    await userEvent.click(await screen.findByRole('button', { name: '数据准备设置' }));
    expect((await screen.findAllByText('数据准备')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '解析下一批' }));

    await waitFor(() => {
      expect(apiMocks.processIndustryGraphArticles).toHaveBeenCalledWith({
        limit: 5,
        import_first: true,
        force: false,
      });
    });

    expect(await screen.findByText('本次处理 1 篇，新增实体 3，新增关系 2')).toBeInTheDocument();
  });

  it('loads a historical conversation and continues it', async () => {
    renderWithProviders(<TechnologyEvolutionPage />);

    await userEvent.click(await screen.findByText('历史技术趋势分析'));

    await waitFor(() => {
      expect(apiMocks.getIndustryGraphConversation).toHaveBeenCalledWith(3);
    });
    expect(await screen.findByText('历史问题')).toBeInTheDocument();
    expect(screen.getByText(/历史回答/)).toBeInTheDocument();
    expect(screen.getByText('[证据1]')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), '继续追问{enter}');

    await waitFor(() => {
      expect(apiMocks.queryIndustryGraphStream).toHaveBeenCalledWith(
        expect.objectContaining({
          question: '继续追问',
          conversation_id: 3,
        }),
        expect.any(Function)
      );
    });
  });

  it('requires login before asking questions', async () => {
    authMocks.useAuth.mockReturnValue({
      isAuthenticated: false,
      username: null,
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    renderWithProviders(<TechnologyEvolutionPage />);

    const suggestedQuestion = await screen.findByRole('button', {
      name: '最近 3 个月技术方面有什么新的变化趋势？',
    });
    await userEvent.click(suggestedQuestion);

    expect(apiMocks.listIndustryGraphConversations).not.toHaveBeenCalled();
    expect(apiMocks.queryIndustryGraphStream).not.toHaveBeenCalled();
    expect(screen.getByText('登录后显示历史会话')).toBeInTheDocument();
  });
});
