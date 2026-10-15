/**
 * RAG索引管理标签页组件
 */
import { useState } from 'react';
import {
  Spin,
  Button,
  Select,
} from 'antd';
import { SyncOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { SettingsAction, SettingsNote, SettingsPanel, StatusDot } from './SettingsKit';

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

  const coverage = ragStats ? Math.round(ragStats.index_coverage * 100) : 0;
  const sourceStats = ragStats ? Object.entries(ragStats.source_stats) : [];

  return (
    <Spin spinning={ragStatsLoading}>
      <div className="settings-stack">
        <SettingsNote>
          RAG 索引用于语义搜索。重建索引会重新处理文章并生成向量嵌入，可能耗时较长并消耗 API 调用额度。
        </SettingsNote>

        {ragStats && (
          <>
            <SettingsPanel title="索引统计">
              <div className="settings-metrics">
                <div className="metric">
                  <span className="metric__label">总文章数</span>
                  <span className="metric__value">{ragStats.total_articles}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">已索引</span>
                  <span className="metric__value">{ragStats.indexed_articles}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">未索引</span>
                  <span className="metric__value">{ragStats.unindexed_articles}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">索引覆盖率</span>
                  <span className="metric__value">{coverage}%</span>
                  <div className="settings-progress" aria-hidden>
                    <div className="settings-progress__bar" style={{ width: `${Math.min(coverage, 100)}%` }} />
                  </div>
                </div>
              </div>

              <dl className="settings-kv" style={{ marginTop: 16 }}>
                <dt>vec0 行数</dt>
                <dd>
                  <span className="settings-num">{ragStats.vec_index_count ?? '不可用'}</span>
                  {ragStats.vector_backend && <span className="settings-muted">（{ragStats.vector_backend}）</span>}
                </dd>
                {typeof ragStats.vec_missing_count === 'number' && ragStats.vec_missing_count > 0 && (
                  <>
                    <dt>vec0 缺失</dt>
                    <dd>
                      <StatusDot tone="warn">
                        <span className="settings-num">{ragStats.vec_missing_count}</span> 条（无需重新调用 embedding）
                      </StatusDot>
                    </dd>
                  </>
                )}
              </dl>

              {sourceStats.length > 0 && (
                <>
                  <div className="settings-subhead" style={{ marginTop: 20, marginBottom: 6 }}>
                    <span className="eyebrow">按来源统计</span>
                  </div>
                  <div className="settings-rows">
                    {sourceStats.map(([source, count]) => (
                      <div key={source} className="settings-row">
                        <div className="settings-row__main">
                          <div className="settings-row__title">
                            <span>{source}</span>
                          </div>
                        </div>
                        <span className="settings-row__trail">
                          <span className="settings-num">{count}</span> 篇
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </SettingsPanel>

            <SettingsPanel title="索引维护">
              <SettingsAction
                title="同步 vec0（不消耗 API）"
                description="当 vec0 行数少于 article_embeddings 时，用已有 JSON 向量回填 sqlite-vec，不会重新调用 embedding API，也不会 DROP 表。部署后若搜索变慢或提示缺失，先执行这一步。"
              >
                <Button
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
              </SettingsAction>

              <SettingsAction
                title="重建索引"
                description={
                  ragStats?.unindexed_articles === 0 ? (
                    <StatusDot tone="ok">所有文章已索引，无需重建</StatusDot>
                  ) : (
                    '只索引未索引的文章，不会清空已有索引。如需完全重建，请使用下方的强制重建。'
                  )
                }
              >
                <Select
                  aria-label="批处理大小"
                  value={batchSize}
                  onChange={setBatchSize}
                  style={{ width: 120 }}
                  disabled={isIndexing || !isAuthenticated}
                  options={[5, 10, 20, 50].map((n) => ({ value: n, label: `批量 ${n}` }))}
                />
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={handleRebuildIndex}
                  loading={isIndexing && !forceRebuildIndexMutation.isPending}
                  disabled={!isAuthenticated || ragStats?.unindexed_articles === 0 || forceRebuildIndexMutation.isPending}
                >
                  {isIndexing && !forceRebuildIndexMutation.isPending ? '正在重建索引...' : '重建未索引文章'}
                </Button>
              </SettingsAction>
            </SettingsPanel>

            <SettingsPanel
              tone="danger"
              title="强制重建索引"
              description="先清空所有现有索引（article_embeddings 和 vec_embeddings 表），再重新索引全部文章。会消耗大量 API 调用额度，请谨慎操作。"
            >
              <SettingsAction
                title="清空并重建全部索引"
                description={<>使用上方选择的批处理大小（<span className="settings-num">{batchSize}</span>）</>}
              >
                <Button
                  type="primary"
                  icon={<DatabaseOutlined />}
                  onClick={handleForceRebuildIndex}
                  loading={forceRebuildIndexMutation.isPending}
                  disabled={!isAuthenticated || rebuildIndexMutation.isPending}
                  danger
                >
                  {forceRebuildIndexMutation.isPending ? '正在强制重建索引...' : '强制重建所有索引'}
                </Button>
              </SettingsAction>
            </SettingsPanel>
          </>
        )}
      </div>
    </Spin>
  );
}
