/**
 * 采集日志组件
 */
import { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Table,
  Tag,
  Space,
  Alert,
  Modal,
  Form,
  InputNumber,
  Tabs,
  List,
  Typography,
  Divider,
  Empty,
  Spin,
  Switch,
} from 'antd';
import { 
  PlayCircleOutlined, 
  ReloadOutlined, 
  SettingOutlined, 
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined 
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import dayjs from 'dayjs';
import type { CollectionTask, CollectionTaskStatus as CollectionTaskStatusResponse, AutoCollectionSettings, CollectionTaskDetail, CollectionTaskLog } from '@/types';

const { Text, Paragraph } = Typography;

export default function CollectionHistory() {
  const { isAuthenticated } = useAuth();
  const [autoCollectionModalVisible, setAutoCollectionModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [autoCollectionForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const { createErrorHandler, showSuccess } = useErrorHandler();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['collection-tasks'],
    queryFn: () => apiService.getCollectionTasks(50),
  });

  const { data: status } = useQuery({
    queryKey: ['collection-status'],
    queryFn: () => apiService.getCollectionStatus(),
    // 只在有运行中任务时才轮询
    refetchInterval: (query) => {
      const currentStatus = query.state.data as CollectionTaskStatusResponse | undefined;
      // 如果有运行中的任务，每2秒刷新一次；否则不轮询
      return currentStatus?.status === 'running' ? 2000 : false;
    },
  });

  // 监听状态变化，当任务完成时刷新任务列表
  useEffect(() => {
    if (status?.status === 'completed' || status?.status === 'error') {
      // 任务已完成或出错，刷新任务列表以更新UI
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
    }
  }, [status?.status, queryClient]);

  // 当有运行中任务时，也轮询任务列表
  useEffect(() => {
    if (status?.status === 'running') {
      // 如果有运行中的任务，设置定时刷新任务列表
      const interval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [status?.status, queryClient]);

  // 获取任务详情
  const { data: taskDetail, isLoading: detailLoading } = useQuery<CollectionTaskDetail>({
    queryKey: ['collection-task-detail', selectedTaskId],
    queryFn: () => apiService.getCollectionTaskDetail(selectedTaskId!),
    enabled: !!selectedTaskId && detailModalVisible,
  });

  const startCollectionMutation = useMutation({
    mutationFn: (enableAi: boolean) => apiService.startCollection(enableAi),
    onSuccess: () => {
      showSuccess('采集任务已启动');
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    },
    onError: createErrorHandler({
      operationName: '启动采集任务',
      customMessages: {
        auth: '需要登录才能启动采集任务',
      },
    }),
  });

  const stopCollectionMutation = useMutation({
    mutationFn: () => apiService.stopCollection(),
    onSuccess: () => {
      showSuccess('已发送停止信号，采集任务将尽快停止');
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    },
    onError: createErrorHandler({
      operationName: '停止采集任务',
      customMessages: {
        auth: '需要登录才能停止采集任务',
      },
    }),
  });

  // 获取采集日志配置
  const { data: autoCollectionSettings } = useQuery({
    queryKey: ['auto-collection-settings'],
    queryFn: () => apiService.getAutoCollectionSettings(),
  });

  // 更新采集日志配置
  const updateAutoCollectionMutation = useMutation({
    mutationFn: (data: AutoCollectionSettings) => apiService.updateAutoCollectionSettings(data),
    onSuccess: () => {
      showSuccess('采集日志设置已保存');
      setAutoCollectionModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['auto-collection-settings'] });
    },
    onError: createErrorHandler({
      operationName: '保存采集日志设置',
      customMessages: {
        auth: '需要登录才能保存采集日志设置',
      },
    }),
  });

  // 初始化表单 - 当模态框打开时，使用最新的配置值
  useEffect(() => {
    if (autoCollectionModalVisible) {
      if (autoCollectionSettings) {
        // 如果配置已加载，使用配置值
        autoCollectionForm.setFieldsValue({
          enabled: autoCollectionSettings.enabled ?? false,
          interval_hours: autoCollectionSettings.interval_hours ?? 1,
          max_articles_per_source: autoCollectionSettings.max_articles_per_source ?? 50,
          request_timeout: autoCollectionSettings.request_timeout ?? 30,
        });
      } else {
        // 如果配置还未加载，重置为默认值
        autoCollectionForm.resetFields();
      }
    }
  }, [autoCollectionSettings, autoCollectionModalVisible, autoCollectionForm]);

  useEffect(() => {
    const unsubscribe = subscribe('collection_status', () => {
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    });
    return unsubscribe;
  }, [subscribe, queryClient]);

  const handleOpenDetail = (taskId: number, tab: string = 'summary') => {
    setSelectedTaskId(taskId);
    setActiveTab(tab);
    setDetailModalVisible(true);
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colors: Record<string, string> = {
          running: 'processing',
          completed: 'success',
          error: 'error',
        };
        return <Tag color={colors[status] || 'default'}>{status}</Tag>;
      },
    },
    {
      title: '新增文章',
      dataIndex: 'new_articles_count',
      key: 'new_articles_count',
      width: 100,
      render: (count: number, record: CollectionTask) => (
        <a
          onClick={() => handleOpenDetail(record.id, 'articles')}
          style={{ cursor: 'pointer', color: '#1890ff' }}
        >
          {count}
        </a>
      ),
    },
    {
      title: '成功源',
      dataIndex: 'success_sources',
      key: 'success_sources',
      width: 100,
      render: (count: number, record: CollectionTask) => (
        <a
          onClick={() => handleOpenDetail(record.id, 'success')}
          style={{ cursor: 'pointer', color: '#1890ff' }}
        >
          {count}
        </a>
      ),
    },
    {
      title: '失败源',
      dataIndex: 'failed_sources',
      key: 'failed_sources',
      width: 100,
      render: (count: number, record: CollectionTask) => (
        <a
          onClick={() => handleOpenDetail(record.id, 'failed')}
          style={{ cursor: 'pointer', color: '#1890ff' }}
        >
          {count}
        </a>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration: number, record: CollectionTask) => (
        <a
          onClick={() => handleOpenDetail(record.id, 'summary')}
          style={{ cursor: 'pointer', color: '#1890ff' }}
        >
          {duration ? `${duration.toFixed(1)}秒` : '-'}
        </a>
      ),
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
      render: (time: string) => (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.5' }}>
          <div>{dayjs(time).format('YYYY-MM-DD')}</div>
          <div style={{ fontSize: '12px', color: '#999' }}>{dayjs(time).format('HH:mm:ss')}</div>
        </div>
      ),
    },
  ];

  const handleStartCollection = (enableAi: boolean) => {
    startCollectionMutation.mutate(enableAi);
  };

  const handleStopCollection = () => {
    Modal.confirm({
      title: '确认停止',
      content: '确定要停止当前正在运行的采集任务吗？',
      okText: '停止',
      okType: 'danger',
      cancelText: '取消',
      okButtonProps: {
        danger: true,
      },
      cancelButtonProps: {
        type: 'default',
      },
      onOk: () => {
        stopCollectionMutation.mutate();
      },
    });
  };

  return (
    <div>
      <Card
        title="🚀 采集日志"
        extra={
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setAutoCollectionModalVisible(true)}
              disabled={!isAuthenticated}
            >
              采集日志设置
            </Button>
            {status?.status === 'running' ? (
              <Button
                icon={<StopOutlined />}
                danger
                onClick={handleStopCollection}
                loading={stopCollectionMutation.isPending}
                disabled={!isAuthenticated}
              >
                终止采集
              </Button>
            ) : (
              <Button
                icon={<PlayCircleOutlined />}
                type="primary"
                onClick={() => handleStartCollection(true)}
                loading={startCollectionMutation.isPending}
                disabled={!isAuthenticated}
              >
                开始采集（AI分析）
              </Button>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['collection-tasks'] })}
              disabled={!isAuthenticated}
            >
              刷新
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={tasks}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="采集任务详情"
        open={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false);
          setSelectedTaskId(null);
          setActiveTab('summary');
        }}
        footer={null}
        width={900}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : taskDetail ? (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'summary',
                label: '任务概览',
                children: (
                  <div>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <div>
                        <Text strong>任务ID：</Text>
                        <Text>{taskDetail.id}</Text>
                      </div>
                      <div>
                        <Text strong>状态：</Text>
                        <Tag color={taskDetail.status === 'completed' ? 'success' : taskDetail.status === 'error' ? 'error' : 'processing'}>
                          {taskDetail.status}
                        </Tag>
                      </div>
                      <div>
                        <Text strong>开始时间：</Text>
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
                          <Text>{dayjs(taskDetail.started_at).format('YYYY-MM-DD')}</Text>
                          <Text type="secondary" style={{ fontSize: '12px' }}>{dayjs(taskDetail.started_at).format('HH:mm:ss')}</Text>
                        </div>
                      </div>
                      {taskDetail.completed_at && (
                        <div>
                          <Text strong>完成时间：</Text>
                          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
                            <Text>{dayjs(taskDetail.completed_at).format('YYYY-MM-DD')}</Text>
                            <Text type="secondary" style={{ fontSize: '12px' }}>{dayjs(taskDetail.completed_at).format('HH:mm:ss')}</Text>
                          </div>
                        </div>
                      )}
                      <div>
                        <Text strong>耗时：</Text>
                        <Text>{taskDetail.duration ? `${taskDetail.duration.toFixed(1)}秒` : '-'}</Text>
                      </div>
                      <Divider />
                      <div>
                        <Text strong>新增文章：</Text>
                        <Text>{taskDetail.new_articles_count}</Text>
                      </div>
                      <div>
                        <Text strong>成功源：</Text>
                        <Tag color="success">{taskDetail.success_sources}</Tag>
                      </div>
                      <div>
                        <Text strong>失败源：</Text>
                        <Tag color="error">{taskDetail.failed_sources}</Tag>
                      </div>
                      {taskDetail.ai_enabled && (
                        <div>
                          <Text strong>AI分析文章数：</Text>
                          <Text>{taskDetail.ai_analyzed_count}</Text>
                        </div>
                      )}
                      {taskDetail.error_message && (
                        <div>
                          <Text strong>错误信息：</Text>
                          <Paragraph style={{ color: '#ff4d4f', marginTop: 8 }}>
                            {taskDetail.error_message}
                          </Paragraph>
                        </div>
                      )}
                    </Space>
                  </div>
                ),
              },
              {
                key: 'success',
                label: `成功源 (${taskDetail.success_sources || 0})`,
                children: (
                  <List
                    dataSource={taskDetail?.success_logs || []}
                    renderItem={(log: CollectionTaskLog) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />}
                          title={
                            <Space>
                              <Text strong>{log.source_name}</Text>
                              <Tag>{log.source_type}</Tag>
                            </Space>
                          }
                          description={
                            <Space>
                              <Text type="secondary">文章数：{log.articles_count}</Text>
                              {log.started_at && (
                                <Text type="secondary">
                                  {dayjs(log.started_at).format('HH:mm:ss')}
                                </Text>
                              )}
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                    locale={{ emptyText: <Empty description="暂无成功记录" /> }}
                  />
                ),
              },
              {
                key: 'failed',
                label: `失败源 (${taskDetail.failed_sources || 0})`,
                children: (
                  <List
                    dataSource={taskDetail?.failed_logs || []}
                    renderItem={(log: CollectionTaskLog) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={<CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 20 }} />}
                          title={
                            <Space>
                              <Text strong>{log.source_name}</Text>
                              <Tag>{log.source_type}</Tag>
                            </Space>
                          }
                          description={
                            <div>
                              <div style={{ marginBottom: 4 }}>
                                <Text type="danger">{log.error_message || '未知错误'}</Text>
                              </div>
                              {log.started_at && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {dayjs(log.started_at).format('HH:mm:ss')}
                                </Text>
                              )}
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                    locale={{ emptyText: <Empty description="暂无失败记录" /> }}
                  />
                ),
              },
              {
                key: 'articles',
                label: `新增文章 (${taskDetail.new_articles_count || 0})`,
                children: (
                  <List
                    dataSource={taskDetail?.new_articles || []}
                    renderItem={(article: { id: number; title: string; url: string; source: string; published_at?: string }) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <a href={article.url} target="_blank" rel="noopener noreferrer">
                              {article.title}
                            </a>
                          }
                          description={
                            <Space>
                              <Tag>{article.source}</Tag>
                              {article.published_at && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {dayjs(article.published_at).format('YYYY-MM-DD HH:mm')}
                                </Text>
                              )}
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                    locale={{ emptyText: <Empty description="暂无新增文章" /> }}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: false,
                    }}
                  />
                ),
              },
            ]}
          />
        ) : (
          <Empty description="无法加载任务详情" />
        )}
      </Modal>

      {/* 采集日志设置Modal */}
      <Modal
        title="采集日志设置"
        open={autoCollectionModalVisible}
        onCancel={() => {
          setAutoCollectionModalVisible(false);
          autoCollectionForm.resetFields();
        }}
        onOk={() => autoCollectionForm.submit()}
        confirmLoading={updateAutoCollectionMutation.isPending}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={autoCollectionForm}
          layout="vertical"
          initialValues={{
            enabled: autoCollectionSettings?.enabled ?? false,
            interval_hours: autoCollectionSettings?.interval_hours ?? 1,
            max_articles_per_source: autoCollectionSettings?.max_articles_per_source ?? 50,
            request_timeout: autoCollectionSettings?.request_timeout ?? 30,
          }}
          onFinish={(values) => {
            updateAutoCollectionMutation.mutate({
              enabled: values.enabled,
              interval_hours: values.interval_hours,
              max_articles_per_source: values.max_articles_per_source,
              request_timeout: values.request_timeout,
            });
          }}
        >
          <Form.Item
            name="enabled"
            label="启用采集日志"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          
          <Form.Item
            name="interval_hours"
            label="采集间隔（小时）"
            rules={[
              { required: true, message: '请输入采集间隔' },
              { type: 'number', min: 1, message: '采集间隔至少为1小时' },
            ]}
            tooltip="设置采集日志的间隔时间，单位为小时"
          >
            <InputNumber
              min={1}
              max={24}
              style={{ width: '100%' }}
              placeholder="请输入间隔小时数"
              addonAfter="小时"
            />
          </Form.Item>
          
          <Form.Item
            name="max_articles_per_source"
            label="每源最大文章数"
            rules={[
              { required: true, message: '请输入每源最大文章数' },
              { type: 'number', min: 1, message: '每源最大文章数至少为1' },
            ]}
            tooltip="每次采集时，从每个数据源最多获取的文章数量"
          >
            <InputNumber
              min={1}
              max={1000}
              style={{ width: '100%' }}
              placeholder="请输入最大文章数"
              addonAfter="篇"
            />
          </Form.Item>
          
          <Form.Item
            name="request_timeout"
            label="请求超时（秒）"
            rules={[
              { required: true, message: '请输入请求超时时间' },
              { type: 'number', min: 1, message: '请求超时时间至少为1秒' },
            ]}
            tooltip="HTTP请求的超时时间，单位为秒"
          >
            <InputNumber
              min={1}
              max={300}
              style={{ width: '100%' }}
              placeholder="请输入超时时间"
              addonAfter="秒"
            />
          </Form.Item>
          
          {autoCollectionSettings?.enabled && (
            <Alert
              message={`当前已启用采集日志，每 ${autoCollectionSettings.interval_hours} 小时执行一次`}
              type="info"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}


