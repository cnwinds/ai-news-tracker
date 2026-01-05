/**
 * Articles Hook
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { ArticleFilter } from '@/types';
import { message } from 'antd';

export function useArticles(filter: ArticleFilter = {}) {
  return useQuery({
    queryKey: ['articles', filter],
    queryFn: () => apiService.getArticles(filter),
  });
}

export function useArticle(id: number) {
  return useQuery({
    queryKey: ['article', id],
    queryFn: () => apiService.getArticle(id),
    enabled: !!id,
  });
}

export function useAnalyzeArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) => 
      apiService.analyzeArticle(id, force || false),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['article', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      if (data.is_processed && variables.force) {
        message.success('重新分析完成');
      } else {
        message.success('分析完成');
      }
    },
    onError: () => {
      message.error('分析失败');
    },
  });
}

export function useDeleteArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiService.deleteArticle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      message.success('文章已删除');
    },
    onError: () => {
      message.error('删除失败');
    },
  });
}

