/**
 * API 服务层
 */
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import type {
  Article,
  ArticleListResponse,
  ArticleFilter,
  ArticleSearchResult,
  CollectionTask,
  CollectionTaskStatus,
  DailySummary,
  DailySummaryListItem,
  SummaryFieldsResponse,
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
  ImageSettings,
  ImageProvider,
  ImageProviderCreate,
  ImageProviderUpdate,
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
  data?: unknown;
}

/**
 * 修复历史条目
 */
interface FixHistoryEntry {
  timestamp: string;
  old_config: string | null;
  new_config: string | null;
  error_message?: string;
  success: boolean;
}

/**
 * 修复解析响应
 */
interface FixParseResponse {
  message: string;
  source_id: number;
  new_config?: Record<string, unknown>;
  fix_history?: FixHistoryEntry;
}

/**
 * 默认数据源
 */
interface DefaultSource {
  name: string;
  url: string;
  description?: string;
  category?: string;
  source_type: string;
}

/**
 * 流式查询数据块
 */
interface StreamChunk {
  type: 'articles' | 'content' | 'done' | 'error';
  data: {
    articles?: ArticleSearchResult[];
    sources?: string[];
    content?: string;
    message?: string;
  };
}

class ApiService {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 从localStorage加载token
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      this.token = savedToken;
    }

    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        // 如果有token，添加到请求头
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
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
   * 设置认证token
   */
  setToken(token: string | null) {
    this.token = token;
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
          message: error.response?.data?.detail 
            ?? error.response?.data?.message 
            ?? error.message 
            ?? '请求失败',
          code: error.code,
          data: error.response?.data,
        };
        throw apiError;
      }
      // 非 Axios 错误，包装为 ApiError
      const apiError: ApiError = {
        status: 500,
        message: error instanceof Error ? error.message : '未知错误',
        data: error,
      };
      throw apiError;
    }
  }

  // 文章相关
  async getArticles(filter: ArticleFilter = {}): Promise<ArticleListResponse> {
    const params = new URLSearchParams();
    if (filter.time_range) params.append('time_range', filter.time_range);
    // 根据过滤模式决定使用sources还是exclude_sources
    if (filter.source_filter_mode === 'exclude' && filter.exclude_sources?.length) {
      params.append('exclude_sources', filter.exclude_sources.join(','));
    } else if (filter.source_filter_mode !== 'exclude' && filter.sources?.length) {
      params.append('sources', filter.sources.join(','));
    }
    if (filter.importance?.length) params.append('importance', filter.importance.join(','));
    if (filter.category?.length) params.append('category', filter.category.join(','));
    if (filter.page) params.append('page', filter.page.toString());
    if (filter.page_size) params.append('page_size', filter.page_size.toString());
    // 默认不包含详细信息以节省流量（只返回标题行显示所需的基本字段）
    params.append('include_details', 'false');

    return this.handleRequest(
      this.client.get<ArticleListResponse>(`/articles?${params.toString()}`)
    );
  }

  async getArticle(id: number): Promise<Article> {
    return this.handleRequest(
      this.client.get<Article>(`/articles/${id}`)
    );
  }

  /**
   * 批量获取文章的基本信息（不包含详细字段，节省流量）
   * @param articleIds 文章ID列表
   * @returns 文章列表（只包含基本字段）
   */
  async getArticlesBasic(articleIds: number[]): Promise<Article[]> {
    return this.handleRequest(
      this.client.post<Article[]>(`/articles/batch/basic`, articleIds)
    );
  }

  /**
   * 获取文章的特定字段（用于按需加载）
   * @param id 文章ID
   * @param fields 要获取的字段，如：'summary' 或 'summary,content,tags'，或 'all' 获取所有详细字段
   * @returns 包含请求字段的对象
   */
  async getArticleFields(
    id: number, 
    fields: string = 'all'
  ): Promise<{
    summary?: string;
    content?: string;
    author?: string;
    tags?: string[];
    user_notes?: string;
    target_audience?: string;
  }> {
    return this.handleRequest(
      this.client.get(`/articles/${id}/fields`, {
        params: { fields },
      })
    );
  }

  async analyzeArticle(id: number, force: boolean = false): Promise<{ is_processed: boolean }> {
    return this.handleRequest(
      this.client.post<{ is_processed: boolean }>(`/articles/${id}/analyze`, null, {
        params: { force: force },
      })
    );
  }

  async deleteArticle(id: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/articles/${id}`)
    );
  }

  async favoriteArticle(id: number): Promise<{ is_favorited: boolean }> {
    return this.handleRequest(
      this.client.post<{ is_favorited: boolean }>(`/articles/${id}/favorite`)
    );
  }

  async unfavoriteArticle(id: number): Promise<{ is_favorited: boolean }> {
    return this.handleRequest(
      this.client.delete<{ is_favorited: boolean }>(`/articles/${id}/favorite`)
    );
  }

  async updateArticle(id: number, data: Partial<Article>): Promise<Article> {
    return this.handleRequest(
      this.client.put<Article>(`/articles/${id}`, data)
    );
  }

  async collectArticleFromUrl(url: string): Promise<Article> {
    return this.handleRequest(
      this.client.post<Article>(`/articles/collect?url=${encodeURIComponent(url)}`)
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

  async getCollectionTask(id: number, includeDetail: boolean = false): Promise<CollectionTask> {
    return this.handleRequest(
      this.client.get<CollectionTask>(`/collection/tasks/${id}`, {
        params: { include_detail: includeDetail },
      })
    );
  }

  // 兼容旧接口（已废弃，使用 getCollectionTask(id, true) 替代）
  async getCollectionTaskDetail(id: number): Promise<CollectionTask> {
    return this.getCollectionTask(id, true);
  }

  async getCollectionStatus(): Promise<CollectionTaskStatus> {
    return this.handleRequest(
      this.client.get<CollectionTaskStatus>('/collection/status')
    );
  }

  async stopCollection(): Promise<{ message: string }> {
    return this.handleRequest(
      this.client.post<{ message: string }>('/collection/stop')
    );
  }

  // 摘要相关
  async getSummaries(limit: number = 50): Promise<DailySummaryListItem[]> {
    return this.handleRequest(
      this.client.get<DailySummaryListItem[]>(`/summary?limit=${limit}`)
    );
  }

  async getSummary(id: number): Promise<DailySummary> {
    return this.handleRequest(
      this.client.get<DailySummary>(`/summary/${id}`)
    );
  }

  /**
   * 获取摘要的特定字段（用于按需加载）
   * @param id 摘要ID
   * @param fields 要获取的字段，如：'summary_content' 或 'summary_content,key_topics,recommended_articles'，或 'all' 获取所有详细字段
   * @returns 包含请求字段的对象
   */
  async getSummaryFields(
    id: number,
    fields: string = 'all'
  ): Promise<SummaryFieldsResponse> {
    return this.handleRequest(
      this.client.get<SummaryFieldsResponse>(`/summary/${id}/fields`, {
        params: { fields },
      })
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

  // AI修复相关
  async fixSourceParse(id: number): Promise<FixParseResponse> {
    return this.handleRequest(
      this.client.post<FixParseResponse>(`/sources/${id}/fix-parse`)
    );
  }

  async getFixHistory(id: number): Promise<{ source_id: number; source_name: string; fix_history: FixHistoryEntry[] }> {
    return this.handleRequest(
      this.client.get<{ source_id: number; source_name: string; fix_history: FixHistoryEntry[] }>(`/sources/${id}/fix-history`)
    );
  }

  // 默认数据源相关
  async getDefaultSources(sourceType?: string): Promise<DefaultSource[]> {
    const params = sourceType ? `?source_type=${sourceType}` : '';
    return this.handleRequest(
      this.client.get<DefaultSource[]>(`/sources/default/list${params}`)
    );
  }

  async importDefaultSources(sourceNames: string[]): Promise<{ message: string; imported: number; skipped: number; errors?: string[] }> {
    return this.handleRequest(
      this.client.post<{ message: string; imported: number; skipped: number; errors?: string[] }>('/sources/default/import', sourceNames)
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
  }): Promise<{ message: string; deleted_count?: number }> {
    return this.handleRequest(
      this.client.post<{ message: string; deleted_count?: number }>('/cleanup', data)
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

  // 图片生成配置相关
  async getImageSettings(): Promise<ImageSettings> {
    return this.handleRequest(
      this.client.get<ImageSettings>('/settings/image')
    );
  }

  async updateImageSettings(data: ImageSettings): Promise<ImageSettings> {
    return this.handleRequest(
      this.client.put<ImageSettings>('/settings/image', data)
    );
  }

  // 图片生成提供商管理相关
  async getImageProviders(enabledOnly: boolean = false): Promise<ImageProvider[]> {
    return this.handleRequest(
      this.client.get<ImageProvider[]>(`/settings/image-providers?enabled_only=${enabledOnly}`)
    );
  }

  async getImageProvider(providerId: number): Promise<ImageProvider> {
    return this.handleRequest(
      this.client.get<ImageProvider>(`/settings/image-providers/${providerId}`)
    );
  }

  async createImageProvider(data: ImageProviderCreate): Promise<ImageProvider> {
    return this.handleRequest(
      this.client.post<ImageProvider>('/settings/image-providers', data)
    );
  }

  async updateImageProvider(providerId: number, data: ImageProviderUpdate): Promise<ImageProvider> {
    return this.handleRequest(
      this.client.put<ImageProvider>(`/settings/image-providers/${providerId}`, data)
    );
  }

  async deleteImageProvider(providerId: number): Promise<void> {
    await this.handleRequest(
      this.client.delete(`/settings/image-providers/${providerId}`)
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

  /**
   * 流式查询文章（问答）
   * @param request 问答请求
   * @param onChunk 处理每个数据块的回调函数
   * @returns Promise<void>
   */
  async queryArticlesStream(
    request: RAGQueryRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/rag/query/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        // 解码数据块
        buffer += decoder.decode(value, { stream: true });
        
        // 处理SSE格式的数据（以 "data: " 开头，以 "\n\n" 结尾）
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的数据块

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6); // 移除 "data: " 前缀
              const chunk = JSON.parse(jsonStr);
              onChunk(chunk);
            } catch (e) {
              console.error('解析SSE数据失败:', e, line);
            }
          }
        }
      }

      // 处理剩余的缓冲区数据
      if (buffer.trim()) {
        const lines = buffer.split('\n\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const chunk = JSON.parse(jsonStr);
              onChunk(chunk);
            } catch (e) {
              console.error('解析SSE数据失败:', e, line);
            }
          }
        }
      }
    } catch (error) {
      console.error('流式查询失败:', error);
      onChunk({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : '未知错误',
        },
      });
      throw error;
    }
  }

  async getRAGStats(): Promise<RAGStatsResponse> {
    return this.handleRequest(
      this.client.get<RAGStatsResponse>('/rag/stats')
    );
  }

  async indexArticle(articleId: number): Promise<{ success: boolean; message: string }> {
    return this.handleRequest(
      this.client.post<{ success: boolean; message: string }>(`/rag/index/${articleId}`)
    );
  }

  async indexAllUnindexedArticles(batchSize: number = 10): Promise<RAGBatchIndexResponse> {
    // 使用批量索引接口，article_ids为空时自动索引所有未索引的文章
    return this.handleRequest(
      this.client.post<RAGBatchIndexResponse>(`/rag/index/batch`, {
        article_ids: null, // 为空时索引所有未索引的文章
        batch_size: batchSize,
      })
    );
  }

  async clearAllIndexes(): Promise<{ success: boolean; deleted_count: number; message: string }> {
    return this.handleRequest(
      this.client.post<{ success: boolean; deleted_count: number; message: string }>('/rag/index/clear')
    );
  }

  async rebuildAllIndexes(batchSize: number = 10): Promise<RAGBatchIndexResponse> {
    return this.handleRequest(
      this.client.post<RAGBatchIndexResponse>(`/rag/index/rebuild?batch_size=${batchSize}`)
    );
  }

  // 认证相关
  async login(username: string, password: string): Promise<{ access_token: string; token_type: string }> {
    return this.handleRequest(
      this.client.post<{ access_token: string; token_type: string }>('/auth/login', {
        username,
        password,
      })
    );
  }

  async logout(): Promise<void> {
    try {
      await this.handleRequest(this.client.post('/auth/logout'));
    } catch (error) {
      // 即使后端失败，也清除本地token
      console.error('登出失败:', error);
    } finally {
      this.setToken(null);
    }
  }

  async verifyToken(): Promise<{ valid: boolean; username: string }> {
    return this.handleRequest(
      this.client.get<{ valid: boolean; username: string }>('/auth/verify')
    );
  }

  async getCurrentUser(): Promise<{ username: string }> {
    return this.handleRequest(
      this.client.get<{ username: string }>('/auth/me')
    );
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.handleRequest(
      this.client.post<{ message: string }>('/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      })
    );
  }

  // 数据库备份和还原相关
  async backupDatabase(): Promise<Blob> {
    const response = await this.client.get('/settings/database/backup', {
      responseType: 'blob',
    });
    return response.data;
  }

  async restoreDatabase(file: File): Promise<{ message: string; filename?: string; auto_backup?: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.handleRequest(
      this.client.post<{ message: string; filename?: string; auto_backup?: string }>(
        '/settings/database/restore',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      )
    );
  }
}

export const apiService = new ApiService();

