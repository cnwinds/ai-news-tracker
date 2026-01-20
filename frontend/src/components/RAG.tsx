/**
 * RAG主组件 - 整合搜索和对话功能
 */
import { useState } from 'react';
import { Tabs, Card, Statistic, Row, Col, Alert, Button, Modal } from 'antd';
import { SearchOutlined, MessageOutlined, DatabaseOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMessage } from '@/hooks/useMessage';
import RAGSearch from './RAGSearch';
import RAGChat from './RAGChat';
import { apiService } from '@/services/api';

export default function RAG() {
  const [activeTab, setActiveTab] = useState('search');
  const queryClient = useQueryClient();
  const message = useMessage();

  // 获取RAG统计信息
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['rag-stats'],
    queryFn: () => apiService.getRAGStats(),
    refetchInterval: 30000, // 每30秒刷新一次
  });

  // 批量索引mutation
  const indexAllMutation = useMutation({
    mutationFn: (batchSize: number) => apiService.indexAllUnindexedArticles(batchSize),
    onSuccess: (data) => {
      message.success(
        `批量索引完成：总计 ${data.total}，成功 ${data.success}，失败 ${data.failed}`
      );
      // 刷新统计信息
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: (error: any) => {
      message.error(`批量索引失败: ${error?.response?.data?.detail || error.message}`);
    },
  });

  const handleIndexAll = () => {
    if (!stats || stats.unindexed_articles === 0) {
      message.info('没有需要索引的文章');
      return;
    }

    Modal.confirm({
      title: '确认批量索引',
      content: `将为 ${stats.unindexed_articles} 篇未索引的文章创建索引，这可能需要一些时间。是否继续？`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        indexAllMutation.mutate(10); // 使用默认批次大小10
      },
    });
  };

  const tabs = [
    {
      key: 'search',
      label: (
        <span>
          <SearchOutlined />
          语义搜索
        </span>
      ),
      children: <RAGSearch />,
    },
    {
      key: 'chat',
      label: (
        <span>
          <MessageOutlined />
          AI对话
        </span>
      ),
      children: <RAGChat />,
    },
  ];

  return (
    <div>
      {/* 统计信息卡片 */}
      {stats && (
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic
                title="总文章数"
                value={stats.total_articles}
                prefix={<DatabaseOutlined />}
                loading={statsLoading}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="已索引"
                value={stats.indexed_articles}
                prefix={<DatabaseOutlined />}
                loading={statsLoading}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="未索引"
                value={stats.unindexed_articles}
                prefix={<DatabaseOutlined />}
                loading={statsLoading}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="索引覆盖率"
                value={stats.index_coverage * 100}
                precision={1}
                suffix="%"
                loading={statsLoading}
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* 提示信息和操作按钮 */}
      {stats && stats.unindexed_articles > 0 && (
        <Alert
          message="索引提示"
          description={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>还有 {stats.unindexed_articles} 篇文章未索引，可能影响搜索和问答效果。</span>
              <Button
                type="primary"
                icon={<SyncOutlined />}
                loading={indexAllMutation.isPending}
                onClick={handleIndexAll}
                style={{ marginLeft: 16 }}
              >
                批量建立索引
              </Button>
            </div>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 功能Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabs}
        size="large"
      />
    </div>
  );
}
