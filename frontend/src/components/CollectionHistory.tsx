/**
 * 自动采集组件
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
  message,
  Tabs,
  List,
  Typography,
  Divider,
  Empty,
  Spin,
  Switch,
} from 'antd';
import { PlayCircleOutlined, ReloadOutlined, EyeOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import { LinkOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import dayjs from 'dayjs';
import type { CollectionTask, AutoCollectionSettings } from '@/types';

export default function CollectionHistory() {
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [autoCollectionModalVisible, setAutoCollectionModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [autoCollectionForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['collection-tasks'],
    queryFn: () => apiService.getCollectionTasks(50),
  });

  const { data: status } = useQuery({
    queryKey: ['collection-status'],
    queryFn: () => apiService.getCollectionStatus(),
    refetchInterval: 2000, // 每2秒刷新一次
  });

  // 获取任务详情
  const { data: taskDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['collection-task-detail', selectedTaskId],
    queryFn: () => apiService.getCollectionTaskDetail(selectedTaskId!),
    enabled: !!selectedTaskId && detailModalVisible,
  });

  const startCollectionMutation = useMutation({
    mutationFn: (enableAi: boolean) => apiService.startCollection(enableAi),
    onSuccess: () => {
      message.success('采集任务已启动');
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    },
    onError: () => {
      message.error('启动采集任务失败');
    },
  });

  const stopCollectionMutation = useMutation({
    mutationFn: () => apiService.stopCollection(),
    onSuccess: () => {
      message.success('已发送停止信号，采集任务将尽快停止');
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    },
    onError: (error: any) => {
      message.error(`停止采集任务失败: ${error?.response?.data?.detail || error?.message || '未知错误'}`);
    },
  });

  // 获取自动采集配置
  const { data: autoCollectionSettings } = useQuery({
    queryKey: ['auto-collection-settings'],
    queryFn: () => apiService.getAutoCollectionSettings(),
  });

  // 更新自动采集配置
  const updateAutoCollectionMutation = useMutation({
    mutationFn: (data: AutoCollectionSettings) => apiService.updateAutoCollectionSettings(data),
    onSuccess: () => {
      message.success('自动采集设置已保存');
      setAutoCollectionModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['auto-collection-settings'] });
    },
    onError: () => {
      message.error('保存自动采集设置失败');
    },
  });

  // 初始化表单
  useEffect(() => {
    if (autoCollectionSettings && autoCollectionModalVisible) {
      autoCollectionForm.setFieldsValue({
        enabled: autoCollectionSettings.enabled,
        interval_hours: autoCollectionSettings.interval_hours,
        max_articles_per_source: autoCollectionSettings.max_articles_per_source,
        request_timeout: autoCollectionSettings.request_timeout,
      });
    }
  }, [autoCollectionSettings, autoCollectionModalVisible, autoCollectionForm]);

  useEffect(() => {
    const unsubscribe = subscribe('collection_status', () => {
      queryClient.invalidateQueries({ queryKey: ['collection-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['collection-status'] });
    });
    return unsubscribe;
  }, [subscribe, queryClient]);

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
    },
    {
      title: '成功源',
      dataIndex: 'success_sources',
      key: 'success_sources',
      width: 100,
    },
    {
      title: '失败源',
      dataIndex: 'failed_sources',
      key: 'failed_sources',
      width: 100,
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration: number) => (duration ? `${duration.toFixed(1)}秒` : '-'),
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: CollectionTask) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => {
            setSelectedTaskId(record.id);
            setDetailModalVisible(true);
          }}
        >
          查看详情
        </Button>
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
      onOk: () => {
        stopCollectionMutation.mutate();
      },
    });
  };

  return (
    <div>
      <Card
        title="🚀 自动采集"
        extra={
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setAutoCollectionModalVisible(true)}
            >
              自动采集设置
            </Button>
            {status?.status === 'running' ? (
              <Button
                icon={<StopOutlined />}
                danger
                onClick={handleStopCollection}
                loading={stopCollectionMutation.isPending}
              >
                终止采集
              </Button>
            ) : (
              <Button
                icon={<PlayCircleOutlined />}
                type="primary"
                onClick={() => handleStartCollection(true)}
                loading={startCollectionMutation.isPending}
              >
                开始采集（AI分析）
              </Button>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['collection-tasks'] })}
            >
              刷新
            </Button>
          </Space>
        }
      >
        {status && status.status === 'running' && (
          <Alert
            message={status.message}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

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
            defaultActiveKey="summary"
            items={[
              {
                key: 'summary',
                label: '任务概览',
                children: (
                  <div>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <div>
                        <Text strong>任务ID：</Text>
                        <Text>{taskDetail.task.id}</Text>
                      </div>
                      <div>
                        <Text strong>状态：</Text>
                        <Tag color={taskDetail.task.status === 'completed' ? 'success' : taskDetail.task.status === 'error' ? 'error' : 'processing'}>
                          {taskDetail.task.status}
                        </Tag>
                      </div>
                      <div>
                        <Text strong>开始时间：</Text>
                        <Text>{dayjs(taskDetail.task.started_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
                      </div>
                      {taskDetail.task.completed_at && (
                        <div>
                          <Text strong>完成时间：</Text>
                          <Text>{dayjs(taskDetail.task.completed_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
                        </div>
                      )}
                      <div>
                        <Text strong>耗时：</Text>
                        <Text>{taskDetail.task.duration ? `${taskDetail.task.duration.toFixed(1)}秒` : '-'}</Text>
                      </div>
                      <Divider />
                      <div>
                        <Text strong>新增文章：</Text>
                        <Text>{taskDetail.task.new_articles_count}</Text>
                      </div>
                      <div>
                        <Text strong>成功源：</Text>
                        <Tag color="success">{taskDetail.task.success_sources}</Tag>
                      </div>
                      <div>
                        <Text strong>失败源：</Text>
                        <Tag color="error">{taskDetail.task.failed_sources}</Tag>
                      </div>
                      {taskDetail.task.ai_enabled && (
                        <div>
                          <Text strong>AI分析文章数：</Text>
                          <Text>{taskDetail.task.ai_analyzed_count}</Text>
                        </div>
                      )}
                      {taskDetail.task.error_message && (
                        <div>
                          <Text strong>错误信息：</Text>
                          <Paragraph style={{ color: '#ff4d4f', marginTop: 8 }}>
                            {taskDetail.task.error_message}
                          </Paragraph>
                        </div>
                      )}
                    </Space>
                  </div>
                ),
              },
              {
                key: 'success',
                label: `成功源 (${(taskDetail.task?.success_sources ?? taskDetail.success_sources_count ?? taskDetail.success_logs?.length) || 0})`,
                children: (
                  <List
                    dataSource={taskDetail.success_logs || []}
                    renderItem={(log: any) => (
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
                label: `失败源 (${(taskDetail.task?.failed_sources ?? taskDetail.failed_sources_count ?? taskDetail.failed_logs?.length) || 0})`,
                children: (
                  <List
                    dataSource={taskDetail.failed_logs || []}
                    renderItem={(log: any) => (
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
                label: `新增文章 (${(taskDetail.task?.new_articles_count ?? taskDetail.new_articles_count ?? taskDetail.new_articles?.length) || 0})`,
                children: (
                  <List
                    dataSource={taskDetail.new_articles || []}
                    renderItem={(article: any) => (
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

      {/* 自动采集设置Modal */}
      <Modal
        title="自动采集设置"
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
            label="启用自动采集"
            valuePropName="checked"
            initialValue={false}
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
            tooltip="设置自动采集的间隔时间，单位为小时"
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
              message={`当前已启用自动采集，每 ${autoCollectionSettings.interval_hours} 小时执行一次`}
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


