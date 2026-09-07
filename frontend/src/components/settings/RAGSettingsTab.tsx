/**
 * RAG索引管理标签页组件
 */
import { useState } from 'react';
import {
  Card,
  Alert,
  Spin,
  Space,
  Button,
  Select,
  Form,
} from 'antd';
import { SyncOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';

export default function RAGSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showWarning } = useErrorHandler();
  const [isIndexing, setIsIndexing] = useState(false);
  const [batchSize, setBatchSize] = useState(10);

  // 获取 RAG 索引统计
  const { data: ragStats, isLoading: ragStatsLoading, refetch: refetchRAGStats } = useQuery({
    queryKey: ['rag-stats'],
    queryFn: () => apiService.getRAGStats(),
    staleTime: 30000,
  });

  // 重建索引 mutation（只索引未索引的文章）
  const rebuildIndexMutation = useMutation({
    mutationFn: (batchSize: number) => apiService.indexAllUnindexedArticles(batchSize),
    onSuccess: async (data) => {
      showSuccess(`索引重建成功：${data.success} 篇文章已索引`);
      setIsIndexing(false);
      await refetchRAGStats();
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: (error: unknown) => {
      createErrorHandler({
        operationName: '重建索引',
        customMessages: {
          auth: '需要登录才能重建索引',
        },
      })(error);
      setIsIndexing(false);
    },
  });

  // 强制重建索引 mutation（清空所有索引后重新索引）
  const syncVecMutation = useMutation({
    mutationFn: () => apiService.syncVecFromJson(200),
    onSuccess: async (data) => {
      showSuccess(data.message);
      await refetchRAGStats();
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: createErrorHandler({
      operationName: '同步 vec0',
      customMessages: {
        auth: '需要登录才能同步 vec0',
      },
    }),
  });

  const forceRebuildIndexMutation = useMutation({
    mutationFn: (batchSize: number) => apiService.rebuildAllIndexes(batchSize),
    onSuccess: async (data) => {
      showSuccess(`强制重建索引成功：${data.success} 篇文章已索引`);
      setIsIndexing(false);
      await refetchRAGStats();
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: (error: unknown) => {
      createErrorHandler({
        operationName: '强制重建索引',
        customMessages: {
          auth: '需要登录才能强制重建索引',
        },
      })(error);
      setIsIndexing(false);
    },
  });

  const handleRebuildIndex = () => {
    if (!isAuthenticated) {
      showWarning('需要登录才能重建索引');
      return;
    }
    setIsIndexing(true);
    rebuildIndexMutation.mutate(batchSize);
  };

  const handleForceRebuildIndex = () => {
    if (!isAuthenticated) {
      showWarning('需要登录才能强制重建索引');
      return;
    }
    setIsIndexing(true);
    forceRebuildIndexMutation.mutate(batchSize);
  };

  return (
    <Spin spinning={ragStatsLoading}>
      <Card>
        <Alert
          message="RAG索引说明"
          description="RAG索引用于语义搜索功能。重建索引会重新处理所有文章，生成向量嵌入。此操作可能需要较长时间，且会消耗API调用额度。"
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        {ragStats && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card title="索引统计" size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div>
                  <strong>总文章数：</strong> {ragStats.total_articles}
                </div>
                <div>
                  <strong>已索引：</strong> {ragStats.indexed_articles}
                </div>
                <div>
                  <strong>vec0 行数：</strong> {ragStats.vec_index_count ?? '不可用'}
                  {ragStats.vector_backend ? `（${ragStats.vector_backend}）` : ''}
                </div>
                {typeof ragStats.vec_missing_count === 'number' && ragStats.vec_missing_count > 0 && (
                  <div>
                    <strong>vec0 缺失：</strong> {ragStats.vec_missing_count} 条（无需重新调用 embedding）
                  </div>
                )}
                <div>
                  <strong>未索引：</strong> {ragStats.unindexed_articles}
                </div>
                <div>
                  <strong>索引覆盖率：</strong> {Math.round(ragStats.index_coverage * 100)}%
                </div>
                {Object.keys(ragStats.source_stats).length > 0 && (
                  <div>
                    <strong>按来源统计：</strong>
                    <ul style={{ marginTop: 8, marginBottom: 0 }}>
                      {Object.entries(ragStats.source_stats).map(([source, count]) => (
                        <li key={source}>
                          {source}: {count} 篇
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Space>
            </Card>

            <Card title="同步 vec0（不消耗 API）" size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="把 JSON 向量写入 sqlite-vec"
                  description="当 vec0 行数少于 article_embeddings 时，用已有 JSON 回填，不会重新调用 embedding API，也不会 DROP 表。部署后若搜索变慢或提示缺失，先执行这一步。"
                  type="warning"
                  showIcon
                />
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={() => {
                    if (!isAuthenticated) {
                      showWarning('需要登录才能同步 vec0');
                      return;
                    }
                    syncVecMutation.mutate();
                  }}
                  loading={syncVecMutation.isPending}
                  disabled={!isAuthenticated || isIndexing}
                >
                  {syncVecMutation.isPending ? '正在同步 vec0...' : '同步缺失的 vec0 行'}
                </Button>
              </Space>
            </Card>

            <Card title="重建索引" size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="重建索引说明"
                  description="重建索引只会索引未索引的文章，不会清空已有索引。如果需要完全重建，请使用下方的强制重建索引功能。"
                  type="info"
                  showIcon
                />
                <Form.Item label="批处理大小">
                  <Select
                    value={batchSize}
                    onChange={setBatchSize}
                    style={{ width: 200 }}
                    disabled={isIndexing || !isAuthenticated}
                  >
                    <Select.Option value={5}>5</Select.Option>
                    <Select.Option value={10}>10</Select.Option>
                    <Select.Option value={20}>20</Select.Option>
                    <Select.Option value={50}>50</Select.Option>
                  </Select>
                </Form.Item>
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={handleRebuildIndex}
                  loading={isIndexing && !forceRebuildIndexMutation.isPending}
                  disabled={!isAuthenticated || ragStats?.unindexed_articles === 0 || forceRebuildIndexMutation.isPending}
                >
                  {isIndexing && !forceRebuildIndexMutation.isPending ? '正在重建索引...' : '重建未索引文章'}
                </Button>
                {ragStats?.unindexed_articles === 0 && (
                  <div style={{ color: '#52c41a' }}>
                    ✓ 所有文章已索引，无需重建
                  </div>
                )}
              </Space>
            </Card>

            <Card title="强制重建索引" size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  message="强制重建索引警告"
                  description="强制重建索引会先清空所有现有的索引（article_embeddings 和 vec_embeddings 表），然后重新索引所有文章。此操作会消耗大量API调用额度，请谨慎操作！"
                  type="error"
                  showIcon
                />
                <Button
                  type="primary"
                  icon={<DatabaseOutlined />}
                  onClick={handleForceRebuildIndex}
                  loading={forceRebuildIndexMutation.isPending}
                  disabled={!isAuthenticated || rebuildIndexMutation.isPending}
                  danger
                  block
                >
                  {forceRebuildIndexMutation.isPending ? '正在强制重建索引...' : '强制重建所有索引'}
                </Button>
              </Space>
            </Card>
          </Space>
        )}
      </Card>
    </Spin>
  );
}
