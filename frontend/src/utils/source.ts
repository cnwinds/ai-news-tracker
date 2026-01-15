/**
 * 订阅源相关的工具函数
 */

/**
 * 规范化源类型
 * 将各种可能的源类型写法统一为标准格式
 */
export function normalizeSourceType(type: string | undefined): string {
  if (!type) return 'rss';
  const normalized = type.toLowerCase().trim();
  
  // 支持多种可能的写法
  if (normalized === 'rss' || normalized === 'rss_feed') return 'rss';
  if (normalized === 'api' || normalized === 'api_source') return 'api';
  if (normalized === 'web' || normalized === 'web_source') return 'web';
  
  return normalized;
}

/**
 * 源类型标签映射
 */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  rss: 'RSS源',
  api: 'API源',
  web: 'Web源',
  email: '邮件源',
} as const;

/**
 * 按类型分组订阅源
 */
export function groupSourcesByType<T extends { source_type?: string }>(
  sources: T[]
): Record<string, T[]> {
  return sources.reduce((acc, source) => {
    const type = normalizeSourceType(source.source_type);
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(source);
    return acc;
  }, {} as Record<string, T[]>);
}

/**
 * 获取源类型是否支持子类型
 */
export function sourceTypeSupportsSubType(sourceType: string): boolean {
  return ['api'].includes(normalizeSourceType(sourceType));
}

/**
 * 获取源类型支持的所有子类型选项
 */
export function getSubTypeOptions(sourceType: string): Array<{ value: string; label: string }> {
  const normalizedType = normalizeSourceType(sourceType);
  
  if (normalizedType === 'api') {
    return [
      { value: 'arxiv', label: 'arXiv' },
      { value: 'huggingface', label: 'Hugging Face' },
      { value: 'paperswithcode', label: 'Papers with Code' },
      { value: 'twitter', label: 'Twitter/X' },
    ];
  }
  
  return [];
}
