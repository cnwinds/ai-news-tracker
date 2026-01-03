/**
 * API 服务层
 */
import axios, { AxiosInstance } from 'axios';
import type {
  Article,
  ArticleListResponse,
  ArticleFilter,
  CollectionTask,
  CollectionTaskCreate,
  CollectionTaskStatus,
  DailySummary,
  SummaryGenerateRequest,
  RSSSource,
  RSSSourceCreate,
  RSSSourceUpdate,
  Statistics,
  CollectionSettings,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

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

  // 文章相关
  async getArticles(filter: ArticleFilter = {}): Promise<ArticleListResponse> {
    const params = new URLSearchParams();
    if (filter.time_range) params.append('time_range', filter.time_range);
    if (filter.sources?.length) params.append('sources', filter.sources.join(','));
    if (filter.importance?.length) params.append('importance', filter.importance.join(','));
    if (filter.category?.length) params.append('category', filter.category.join(','));
    if (filter.page) params.append('page', filter.page.toString());
    if (filter.page_size) params.append('page_size', filter.page_size.toString());

    const response = await this.client.get<ArticleListResponse>(`/articles?${params.toString()}`);
    return response.data;
  }

  async getArticle(id: number): Promise<Article> {
    const response = await this.client.get<Article>(`/articles/${id}`);
    return response.data;
  }

  async analyzeArticle(id: number, force: boolean = false): Promise<any> {
    const response = await this.client.post(`/articles/${id}/analyze`, null, {
      params: { force: force },
    });
    return response.data;
  }

  async deleteArticle(id: number): Promise<void> {
    await this.client.delete(`/articles/${id}`);
  }

  // 采集相关
  async startCollection(enableAi: boolean = true): Promise<CollectionTask> {
    const response = await this.client.post<CollectionTask>('/collection/start', {
      enable_ai: enableAi,
    });
    return response.data;
  }

  async getCollectionTasks(limit: number = 50): Promise<CollectionTask[]> {
    const response = await this.client.get<CollectionTask[]>(`/collection/tasks?limit=${limit}`);
    return response.data;
  }

  async getCollectionTask(id: number): Promise<CollectionTask> {
    const response = await this.client.get<CollectionTask>(`/collection/tasks/${id}`);
    return response.data;
  }

  async getCollectionTaskDetail(id: number): Promise<any> {
    const response = await this.client.get(`/collection/tasks/${id}/detail`);
    return response.data;
  }

  async getCollectionStatus(): Promise<CollectionTaskStatus> {
    const response = await this.client.get<CollectionTaskStatus>('/collection/status');
    return response.data;
  }

  // 摘要相关
  async getSummaries(limit: number = 50): Promise<DailySummary[]> {
    const response = await this.client.get<DailySummary[]>(`/summary?limit=${limit}`);
    return response.data;
  }

  async getSummary(id: number): Promise<DailySummary> {
    const response = await this.client.get<DailySummary>(`/summary/${id}`);
    return response.data;
  }

  async generateSummary(request: SummaryGenerateRequest): Promise<DailySummary> {
    const response = await this.client.post<DailySummary>('/summary/generate', request);
    return response.data;
  }

  async deleteSummary(id: number): Promise<void> {
    await this.client.delete(`/summary/${id}`);
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

    const response = await this.client.get<RSSSource[]>(`/sources?${queryParams.toString()}`);
    return response.data;
  }

  async getSource(id: number): Promise<RSSSource> {
    const response = await this.client.get<RSSSource>(`/sources/${id}`);
    return response.data;
  }

  async createSource(data: RSSSourceCreate): Promise<RSSSource> {
    const response = await this.client.post<RSSSource>('/sources', data);
    return response.data;
  }

  async updateSource(id: number, data: RSSSourceUpdate): Promise<RSSSource> {
    const response = await this.client.put<RSSSource>(`/sources/${id}`, data);
    return response.data;
  }

  async deleteSource(id: number): Promise<void> {
    await this.client.delete(`/sources/${id}`);
  }

  // 默认数据源相关
  async getDefaultSources(sourceType?: string): Promise<any[]> {
    const params = sourceType ? `?source_type=${sourceType}` : '';
    const response = await this.client.get<any[]>(`/sources/default/list${params}`);
    return response.data;
  }

  async importDefaultSources(sourceNames: string[]): Promise<any> {
    const response = await this.client.post('/sources/default/import', sourceNames);
    return response.data;
  }

  // 统计相关
  async getStatistics(): Promise<Statistics> {
    const response = await this.client.get<Statistics>('/statistics');
    return response.data;
  }

  // 清理相关
  async cleanupData(data: {
    delete_articles_older_than_days?: number;
    delete_logs_older_than_days?: number;
    delete_unanalyzed_articles?: boolean;
    delete_articles_by_sources?: string[];
  }): Promise<any> {
    const response = await this.client.post('/cleanup', data);
    return response.data;
  }

  // 配置相关
  async getCollectionSettings(): Promise<CollectionSettings> {
    const response = await this.client.get<CollectionSettings>('/settings/collection');
    return response.data;
  }

  async updateCollectionSettings(data: CollectionSettings): Promise<CollectionSettings> {
    const response = await this.client.put<CollectionSettings>('/settings/collection', data);
    return response.data;
  }
}

export const apiService = new ApiService();

