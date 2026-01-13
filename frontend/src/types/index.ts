/**
 * TypeScript 类型定义
 */

export interface Article {
  id: number;
  title: string;
  title_zh?: string;
  url: string;
  content?: string;
  summary?: string;
  source: string;
  source_id?: number;
  category?: string;
  author?: string;
  published_at?: string;
  collected_at: string;
  importance?: 'high' | 'medium' | 'low';
  tags?: string[];
  target_audience?: string;
  extra_data?: Record<string, any>;
  is_processed: boolean;
  is_sent: boolean;
  is_favorited: boolean;
  user_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleListResponse {
  items: Article[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ArticleFilter {
  time_range?: string;
  sources?: string[];
  exclude_sources?: string[];
  source_filter_mode?: 'include' | 'exclude'; // 过滤模式：包含或排除
  importance?: string[];
  category?: string[];
  page?: number;
  page_size?: number;
}

export interface CollectionTask {
  id: number;
  status: 'running' | 'completed' | 'error';
  new_articles_count: number;
  total_sources: number;
  success_sources: number;
  failed_sources: number;
  error_message?: string;
  duration?: number;
  ai_enabled: boolean;
  ai_analyzed_count: number;
  started_at: string;
  completed_at?: string;
  created_at: string;
}

export interface CollectionTaskStatus {
  task_id: number;
  status: string;
  message: string;
  stats?: {
    new_articles?: number;
    total_sources?: number;
    success_sources?: number;
    failed_sources?: number;
    duration?: number;
    ai_analyzed_count?: number;
  };
}

// 摘要列表项（简化版，不包含详细内容）
export interface DailySummaryListItem {
  id: number;
  summary_type: 'daily' | 'weekly';
  summary_date: string;
  start_date: string;
  end_date: string;
  total_articles: number;
  high_importance_count: number;
  medium_importance_count: number;
  created_at: string;
  updated_at: string;
}

// 摘要详情（完整版）
export interface DailySummary {
  id: number;
  summary_type: 'daily' | 'weekly';
  summary_date: string;
  start_date: string;
  end_date: string;
  summary_content: string;
  total_articles: number;
  high_importance_count: number;
  medium_importance_count: number;
  key_topics?: string[];
  recommended_articles?: Array<{
    id: number;
    title: string;
    reason: string;
  }>;
  model_used?: string;
  generation_time?: number;
  created_at: string;
  updated_at: string;
}

// 摘要字段响应（按需加载）
export interface SummaryFieldsResponse {
  summary_content?: string;
  key_topics?: string[];
  recommended_articles?: Array<{
    id: number;
    title: string;
    reason: string;
  }>;
}

export interface RSSSource {
  id: number;
  name: string;
  url: string;
  description?: string;
  category?: string;
  tier?: string;
  source_type: string;
  language: string;
  enabled: boolean;
  priority: number;
  note?: string;
  extra_config?: string;
  analysis_prompt?: string;  // 自定义AI分析提示词
  parse_fix_history?: string;  // 解析修复历史（JSON格式）
  last_collected_at?: string;
  latest_article_published_at?: string;
  articles_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface FixHistoryEntry {
  timestamp: string;
  old_config: string | null;
  new_config: string | null;
  error_message?: string;
  success: boolean;
}

export interface FixParseResponse {
  message: string;
  source_id: number;
  new_config?: any;
  fix_history?: FixHistoryEntry;
}

export type RSSSourceCreate = Omit<RSSSource, 'id' | 'created_at' | 'updated_at' | 'last_collected_at' | 'latest_article_published_at' | 'articles_count' | 'last_error'>;

export type RSSSourceUpdate = Partial<RSSSourceCreate>;

export interface Statistics {
  total_articles: number;
  today_count: number;
  high_importance: number;
  medium_importance: number;
  low_importance: number;
  unanalyzed: number;
  source_distribution: Record<string, number>;
  category_distribution: Record<string, number>;
  importance_distribution: Record<string, number>;
}

export interface CollectionSettings {
  max_article_age_days: number;
  max_analysis_age_days: number;
}

export interface AutoCollectionSettings {
  enabled: boolean;
  interval_hours: number; // 采集间隔（小时）
  max_articles_per_source: number; // 每次采集每源最多获取文章数
  request_timeout: number; // 请求超时（秒）
}

export interface SummarySettings {
  daily_summary_enabled: boolean;
  daily_summary_time: string; // 格式：HH:MM，如 "09:00"
  weekly_summary_enabled: boolean;
  weekly_summary_time: string; // 格式：HH:MM，如 "09:00"，在周六执行
}

export interface LLMProvider {
  id: number;
  name: string;
  provider_type: string;
  api_key: string;
  api_base: string;
  llm_model: string;
  embedding_model?: string;
  enabled: boolean;
}

export type LLMProviderCreate = Omit<LLMProvider, 'id'>;

export type LLMProviderUpdate = Partial<LLMProviderCreate>;

export interface LLMSettings {
  selected_llm_provider_id?: number | null;
  selected_embedding_provider_id?: number | null;
  selected_llm_models?: string[] | null;
  selected_embedding_models?: string[] | null;
}

export interface ImageProvider {
  id: number;
  name: string;
  provider_type: string;
  api_key: string;
  api_base: string;
  image_model: string;
  enabled: boolean;
}

export type ImageProviderCreate = Omit<ImageProvider, 'id'>;

export type ImageProviderUpdate = Partial<ImageProviderCreate>;

export interface ImageSettings {
  selected_image_provider_id?: number | null;
  selected_image_models?: string[] | null;
}

export interface CollectorSettings {
  collection_interval_hours: number;
  max_articles_per_source: number;
  request_timeout: number;
}

export interface QuietHours {
  start_time: string; // 格式: HH:MM
  end_time: string; // 格式: HH:MM
}

export interface NotificationSettings {
  platform: 'feishu' | 'dingtalk';
  webhook_url: string;
  secret: string; // 钉钉加签密钥（可选）
  instant_notification_enabled: boolean;
  quiet_hours?: QuietHours[]; // 勿扰时段列表
}

export interface WebSocketMessage {
  type: string;
  message?: string;
  timestamp: string;
  [key: string]: any;
}

export interface SummaryGenerateRequest {
  summary_type: 'daily' | 'weekly';
  date?: string; // 指定日期 (YYYY-MM-DD格式)
  week?: string; // 指定周 (YYYY-WW格式，如2024-01表示2024年第1周)
}

// RAG相关类型定义
export interface ArticleSearchResult {
  is_favorited?: boolean;
  id: number;
  title: string;
  title_zh?: string;
  url: string;
  summary?: string;
  source: string;
  published_at?: string;
  importance?: 'high' | 'medium' | 'low';
  tags?: string[];
  similarity: number; // 相似度分数 (0-1)
}

export interface RAGSearchRequest {
  query: string;
  top_k?: number;
  sources?: string[];
  importance?: string[];
  time_from?: string;
  time_to?: string;
}

export interface RAGSearchResponse {
  query: string;
  results: ArticleSearchResult[];
  total: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RAGQueryRequest {
  question: string;
  top_k?: number;
  conversation_history?: ConversationMessage[];
}

export interface RAGQueryResponse {
  question: string;
  answer: string;
  sources: string[];
  articles: ArticleSearchResult[];
}

export interface RAGStatsResponse {
  total_articles: number;
  indexed_articles: number;
  unindexed_articles: number;
  index_coverage: number; // 索引覆盖率 (0-1)
  source_stats: Record<string, number>;
}

export interface RAGBatchIndexResponse {
  total: number;
  success: number;
  failed: number;
  message: string;
}


