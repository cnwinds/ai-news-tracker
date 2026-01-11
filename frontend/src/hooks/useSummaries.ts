/**
 * Summaries Hook
 */
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';

/**
 * 获取摘要的详细信息（按需加载）
 * 一次性获取所有详细字段：summary_content, key_topics, recommended_articles
 */
export function useSummaryDetails(id: number, enabled: boolean = true) {
  return useQuery({
    queryKey: ['summary', id, 'details'],
    queryFn: async () => {
      return await apiService.getSummaryFields(id, 'all');
    },
    enabled: enabled && !!id && id > 0,
    staleTime: 5 * 60 * 1000, // 5分钟
  });
}
