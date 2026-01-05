/**
 * API 服务层
 */
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import type {
  Article,
  ArticleListResponse,
  ArticleFilter,
  CollectionTask,
  CollectionTaskStatus,
  DailySummary,
  SummaryGenerateRequest,
  RSSSource,
  RSSSourceCreate,
  RSSSourceUpdate,
  Statistics,
  CollectionSettings,
  AutoCollectionSettings,
  SummarySettings,
  LLMSettings,
  LLMProvider,
  LLMProviderCreate,
  LLMProviderUpdate,
  CollectorSettings,
  NotificationSettings,
  RAGSearchRequest,
  RAGSearchResponse,
  RAGQueryRequest,
  RAGQueryResponse,
  RAGStatsResponse,
  RAGBatchIndexResponse,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

/**
 * API 错误接口
 */
export interface ApiError {
  status: number;
  message: string;
  code?: string;
  data?: any;
}

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          console.error('API Error:', error.response.data);
        } else if (error.request) {
          console.error('Network Error:', error.request);
        } else {
          console.error('Error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * 统一的请求错误处理
   * @param request Axios 请求 Promise
   * @returns 响应数据
   * @throws ApiError 格式化的错误对象
   */
  private async handleRequest<T>(request: Promise<AxiosResponse<T>>): Promise<T> {
    try {
      const response = await request;
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const apiError: ApiError = {
          status: error.response?.status ?? 500,
          message: error.response?.data?.detail ?? error.response?.data?.message ?? error.message ?? '请求失败',
          code: error.code,
          data: error.response?.data,
        };
        throw apiError;
      }
      // 非 Axios 错误，直接抛出
      throw error;
    }
  }

  // 文章相关
  async getArticles(filter: ArticleFilter = {}): Promise<ArticleListResponse> {
    const params = new URLSearchParams();
    if (filter.time_range) params.append('time_range', filter.time_range);
    if (filter.sources?.length) params.append('sources', filter.sources.join(','));
    if (filter.importance?.length) params.append('importance', filter.importance.join(','));
    if (filter.category?.length) params.append('category', filter.category.join(','));
    if (filter.page) params.append('page', filter.page.toString());
    if (filter.page_size) params.append('page_size', filter.page_size.toString());

    return this.handleRequest(
      this.client.get<ArticleListResponse>(`/articles?${params.toString()}`)
    );
  }

  async getArticle(id: number): Promise<Article> {
    return this.handleRequest(
      this.client.get<Article>(`/articles/${id}`)
    );
  }

  async analyzeArticle(id: number, force: boolean = false): Promise<any> {
    return this.handleRequest(
      this.client.post(`/articles/${id}/analyze`, null, {
        params: { force: force },
      })
    );
  }

  async deleteArticle(id: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/articles/${id}`)
    );
  }

  async favoriteArticle(id: number): Promise<any> {
    return this.handleRequest(
      this.client.post(`/articles/${id}/favorite`)
    );
  }

  async unfavoriteArticle(id: number): Promise<any> {
    return this.handleRequest(
      this.client.delete(`/articles/${id}/favorite`)
    );
  }

  async updateArticle(id: number, data: Partial<Article>): Promise<Article> {
    return this.handleRequest(
      this.client.put<Article>(`/articles/${id}`, data)
    );
  }

  // 采集相关
  async startCollection(enableAi: boolean = true): Promise<CollectionTask> {
    return this.handleRequest(
      this.client.post<CollectionTask>('/collection/start', {
        enable_ai: enableAi,
      })
    );
  }

  async getCollectionTasks(limit: number = 50): Promise<CollectionTask[]> {
    return this.handleRequest(
      this.client.get<CollectionTask[]>(`/collection/tasks?limit=${limit}`)
    );
  }

  async getCollectionTask(id: number): Promise<CollectionTask> {
    return this.handleRequest(
      this.client.get<CollectionTask>(`/collection/tasks/${id}`)
    );
  }

  async getCollectionTaskDetail(id: number): Promise<any> {
    return this.handleRequest(
      this.client.get(`/collection/tasks/${id}/detail`)
    );
  }

  async getCollectionStatus(): Promise<CollectionTaskStatus> {
    return this.handleRequest(
      this.client.get<CollectionTaskStatus>('/collection/status')
    );
  }

  async stopCollection(): Promise<any> {
    return this.handleRequest(
      this.client.post('/collection/stop')
    );
  }

  // 摘要相关
  async getSummaries(limit: number = 50): Promise<DailySummary[]> {
    return this.handleRequest(
      this.client.get<DailySummary[]>(`/summary?limit=${limit}`)
    );
  }

  async getSummary(id: number): Promise<DailySummary> {
    return this.handleRequest(
      this.client.get<DailySummary>(`/summary/${id}`)
    );
  }

  async generateSummary(request: SummaryGenerateRequest): Promise<DailySummary> {
    return this.handleRequest(
      this.client.post<DailySummary>('/summary/generate', request)
    );
  }

  async deleteSummary(id: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/summary/${id}`)
    );
  }

  // 订阅源相关
  async getSources(params?: {
    category?: string;
    tier?: string;
    source_type?: string;
    enabled_only?: boolean;
  }): Promise<RSSSource[]> {
    const queryParams = new URLSearchParams();
    if (params?.category) queryParams.append('category', params.category);
    if (params?.tier) queryParams.append('tier', params.tier);
    if (params?.source_type) queryParams.append('source_type', params.source_type);
    if (params?.enabled_only !== undefined) queryParams.append('enabled_only', params.enabled_only.toString());

    return this.handleRequest(
      this.client.get<RSSSource[]>(`/sources?${queryParams.toString()}`)
    );
  }

  async getSource(id: number): Promise<RSSSource> {
    return this.handleRequest(
      this.client.get<RSSSource>(`/sources/${id}`)
    );
  }

  async createSource(data: RSSSourceCreate): Promise<RSSSource> {
    return this.handleRequest(
      this.client.post<RSSSource>('/sources', data)
    );
  }

  async updateSource(id: number, data: RSSSourceUpdate): Promise<RSSSource> {
    return this.handleRequest(
      this.client.put<RSSSource>(`/sources/${id}`, data)
    );
  }

  async deleteSource(id: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/sources/${id}`)
    );
  }

  // 默认数据源相关
  async getDefaultSources(sourceType?: string): Promise<any[]> {
    const params = sourceType ? `?source_type=${sourceType}` : '';
    return this.handleRequest(
      this.client.get<any[]>(`/sources/default/list${params}`)
    );
  }

  async importDefaultSources(sourceNames: string[]): Promise<any> {
    return this.handleRequest(
      this.client.post('/sources/default/import', sourceNames)
    );
  }

  // 统计相关
  async getStatistics(): Promise<Statistics> {
    return this.handleRequest(
      this.client.get<Statistics>('/statistics')
    );
  }

  // 清理相关
  async cleanupData(data: {
    delete_articles_older_than_days?: number;
    delete_logs_older_than_days?: number;
    delete_unanalyzed_articles?: boolean;
    delete_articles_by_sources?: string[];
  }): Promise<any> {
    return this.handleRequest(
      this.client.post('/cleanup', data)
    );
  }

  // 配置相关
  async getCollectionSettings(): Promise<CollectionSettings> {
    return this.handleRequest(
      this.client.get<CollectionSettings>('/settings/collection')
    );
  }

  async updateCollectionSettings(data: CollectionSettings): Promise<CollectionSettings> {
    return this.handleRequest(
      this.client.put<CollectionSettings>('/settings/collection', data)
    );
  }

  async getAutoCollectionSettings(): Promise<AutoCollectionSettings> {
    return this.handleRequest(
      this.client.get<AutoCollectionSettings>('/settings/auto-collection')
    );
  }

  async updateAutoCollectionSettings(data: AutoCollectionSettings): Promise<AutoCollectionSettings> {
    return this.handleRequest(
      this.client.put<AutoCollectionSettings>('/settings/auto-collection', data)
    );
  }

  // 总结配置相关
  async getSummarySettings(): Promise<SummarySettings> {
    return this.handleRequest(
      this.client.get<SummarySettings>('/settings/summary')
    );
  }

  async updateSummarySettings(data: SummarySettings): Promise<SummarySettings> {
    return this.handleRequest(
      this.client.put<SummarySettings>('/settings/summary', data)
    );
  }

  // LLM配置相关
  async getLLMSettings(): Promise<LLMSettings> {
    return this.handleRequest(
      this.client.get<LLMSettings>('/settings/llm')
    );
  }

  async updateLLMSettings(data: LLMSettings): Promise<LLMSettings> {
    return this.handleRequest(
      this.client.put<LLMSettings>('/settings/llm', data)
    );
  }

  // 提供商管理相关
  async getProviders(enabledOnly: boolean = false): Promise<LLMProvider[]> {
    return this.handleRequest(
      this.client.get<LLMProvider[]>(`/settings/providers?enabled_only=${enabledOnly}`)
    );
  }

  async getProvider(providerId: number): Promise<LLMProvider> {
    return this.handleRequest(
      this.client.get<LLMProvider>(`/settings/providers/${providerId}`)
    );
  }

  async createProvider(data: LLMProviderCreate): Promise<LLMProvider> {
    return this.handleRequest(
      this.client.post<LLMProvider>('/settings/providers', data)
    );
  }

  async updateProvider(providerId: number, data: LLMProviderUpdate): Promise<LLMProvider> {
    return this.handleRequest(
      this.client.put<LLMProvider>(`/settings/providers/${providerId}`, data)
    );
  }

  async deleteProvider(providerId: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/settings/providers/${providerId}`)
    );
  }

  // 采集器配置相关
  async getCollectorSettings(): Promise<CollectorSettings> {
    return this.handleRequest(
      this.client.get<CollectorSettings>('/settings/collector')
    );
  }

  async updateCollectorSettings(data: CollectorSettings): Promise<CollectorSettings> {
    return this.handleRequest(
      this.client.put<CollectorSettings>('/settings/collector', data)
    );
  }

  // 通知配置相关
  async getNotificationSettings(): Promise<NotificationSettings> {
    return this.handleRequest(
      this.client.get<NotificationSettings>('/settings/notification')
    );
  }

  async updateNotificationSettings(data: NotificationSettings): Promise<NotificationSettings> {
    return this.handleRequest(
      this.client.put<NotificationSettings>('/settings/notification', data)
    );
  }

  // RAG相关
  async searchArticles(request: RAGSearchRequest): Promise<RAGSearchResponse> {
    return this.handleRequest(
      this.client.post<RAGSearchResponse>('/rag/search', request)
    );
  }

  async queryArticles(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    return this.handleRequest(
      this.client.post<RAGQueryResponse>('/rag/query', request)
    );
  }

  async getRAGStats(): Promise<RAGStatsResponse> {
    return this.handleRequest(
      this.client.get<RAGStatsResponse>('/rag/stats')
    );
  }

  async indexArticle(articleId: number): Promise<any> {
    return this.handleRequest(
      this.client.post(`/rag/index/${articleId}`)
    );
  }

  async indexAllUnindexedArticles(batchSize: number = 10): Promise<RAGBatchIndexResponse> {
    return this.handleRequest(
      this.client.post<RAGBatchIndexResponse>(`/rag/index/all?batch_size=${batchSize}`)
    );
  }
}

export const apiService = new ApiService();

