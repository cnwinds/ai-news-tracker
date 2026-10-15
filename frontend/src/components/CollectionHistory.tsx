/**
 * 采集日志组件
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Table,
  Modal,
  Form,
  InputNumber,
  Tabs,
  List,
  Empty,
  Spin,
  Switch,
  Tooltip,
} from 'antd';
import {
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import dayjs from 'dayjs';
import type { CollectionTask, CollectionTaskStatus as CollectionTaskStatusResponse, AutoCollectionSettings, CollectionTaskDetail, CollectionTaskLog } from '@/types';
import { SettingsNote, SettingsPanel, StatusDot, type StatusTone } from '@/components/settings/SettingsKit';

const TASK_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  running: { tone: 'live', label: '运行中' },
  completed: { tone: 'ok', label: '已完成' },
  error: { tone: 'error', label: '失败' },
};

function TaskStatus({ status }: { status: string }) {
  const meta = TASK_STATUS[status] ?? { tone: 'off' as StatusTone, label: status };
  return <StatusDot tone={meta.tone}>{meta.label}</StatusDot>;
}

function formatDuration(duration?: number) {
  return duration ? `${duration.toFixed(1)}秒` : '-';
}

function formatDateTime(time?: string, compact = false) {
  if (!time) return '-';
  const d = dayjs(time);
  return (
    <span className="settings-num" title={d.format('YYYY-MM-DD HH:mm:ss')}>
      <span className="settings-muted">{d.format(compact ? 'MM-DD' : 'YYYY-MM-DD')}</span> {d.format('HH:mm:ss')}
    </span>
  );
}

export default function CollectionHistory() {
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();
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

  const countLink = (count: number, taskId: number, tab: string, danger = false) => (
    <button
      type="button"
      className={`settings-num-link${!count ? ' settings-num-link--zero' : danger ? ' settings-num-link--danger' : ''}`}
      onClick={() => handleOpenDetail(taskId, tab)}
    >
      {count ?? 0}
    </button>
  );

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 64,
      render: (id: number) => <span className="settings-num settings-muted">#{id}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 92,
      render: (status: string) => <TaskStatus status={status} />,
    },
    {
      title: '新增文章',
      dataIndex: 'new_articles_count',
      key: 'new_articles_count',
      width: 76,
      align: 'right' as const,
      render: (count: number, record: CollectionTask) => countLink(count, record.id, 'articles'),
    },
    {
      title: '成功源',
      dataIndex: 'success_sources',
      key: 'success_sources',
      width: 68,
      align: 'right' as const,
      render: (count: number, record: CollectionTask) => countLink(count, record.id, 'success'),
    },
    {
      title: '失败源',
      dataIndex: 'failed_sources',
      key: 'failed_sources',
      width: 68,
      align: 'right' as const,
      render: (count: number, record: CollectionTask) => countLink(count, record.id, 'failed', true),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 84,
      align: 'right' as const,
      render: (duration: number, record: CollectionTask) => (
        <button
          type="button"
          className="settings-num-link"
          onClick={() => handleOpenDetail(record.id, 'summary')}
        >
          {formatDuration(duration)}
        </button>
      ),
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (time: string) => formatDateTime(time, true),
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

  const isRunning = status?.status === 'running';
  const autoDescription = autoCollectionSettings?.enabled
    ? `定时采集已开启 · 每 ${autoCollectionSettings.interval_hours} 小时执行一次`
    : '定时采集未开启';

  return (
    <div>
      <SettingsPanel
        title="采集任务"
        description={autoDescription}
        flush
        extra={
          <>
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                aria-label="刷新"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['collection-tasks'] })}
                disabled={!isAuthenticated}
              />
            </Tooltip>
            <Button
              icon={<SettingOutlined />}
              onClick={() => setAutoCollectionModalVisible(true)}
              disabled={!isAuthenticated}
            >
              采集日志设置
            </Button>
            {isRunning ? (
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
          </>
        }
      >
        {isRunning && (
          <div className="collect-live" role="status">
            <span className="dot dot--live" />
            <strong>采集进行中</strong>
            {status?.message && <span>{status.message}</span>}
          </div>
        )}
        <Table
          className="settings-table"
          size="small"
          columns={columns}
          dataSource={tasks}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: isMobile ? 600 : 580 }}
          pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
        />
      </SettingsPanel>

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
                  <div className="settings-stack">
                    <div className="settings-metrics">
                      <div className="metric">
                        <span className="metric__label">新增文章</span>
                        <span className="metric__value">{taskDetail.new_articles_count}</span>
                      </div>
                      <div className="metric">
                        <span className="metric__label"><span className="dot settings-dot--ok" />成功源</span>
                        <span className="metric__value">{taskDetail.success_sources}</span>
                      </div>
                      <div className="metric">
                        <span className="metric__label"><span className="dot settings-dot--error" />失败源</span>
                        <span className="metric__value">{taskDetail.failed_sources}</span>
                      </div>
                      {taskDetail.ai_enabled && (
                        <div className="metric">
                          <span className="metric__label">AI分析文章数</span>
                          <span className="metric__value">{taskDetail.ai_analyzed_count}</span>
                        </div>
                      )}
                    </div>
                    <dl className="settings-kv">
                      <dt>任务ID</dt>
                      <dd className="settings-num">#{taskDetail.id}</dd>
                      <dt>状态</dt>
                      <dd><TaskStatus status={taskDetail.status} /></dd>
                      <dt>开始时间</dt>
                      <dd>{formatDateTime(taskDetail.started_at)}</dd>
                      {taskDetail.completed_at && (
                        <>
                          <dt>完成时间</dt>
                          <dd>{formatDateTime(taskDetail.completed_at)}</dd>
                        </>
                      )}
                      <dt>耗时</dt>
                      <dd className="settings-num">{formatDuration(taskDetail.duration)}</dd>
                    </dl>
                    {taskDetail.error_message && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>错误信息</div>
                        <p className="settings-error-text">{taskDetail.error_message}</p>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'success',
                label: `成功源 (${taskDetail.success_sources || 0})`,
                children: (
                  <List
                    size="small"
                    dataSource={taskDetail?.success_logs || []}
                    renderItem={(log: CollectionTaskLog) => (
                      <List.Item>
                        <div className="settings-row" style={{ width: '100%', padding: 0 }}>
                          <div className="settings-row__main">
                            <div className="settings-row__title">
                              <span className="dot settings-dot--ok" />
                              <span>{log.source_name}</span>
                              <span className="chip">{log.source_type}</span>
                            </div>
                          </div>
                          <span className="settings-row__trail">
                            <span className="settings-num">{log.articles_count}</span> 篇
                            {log.started_at && (
                              <span className="settings-num" style={{ marginLeft: 10 }}>
                                {dayjs(log.started_at).format('HH:mm:ss')}
                              </span>
                            )}
                          </span>
                        </div>
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
                    size="small"
                    dataSource={taskDetail?.failed_logs || []}
                    renderItem={(log: CollectionTaskLog) => (
                      <List.Item>
                        <div className="settings-row" style={{ width: '100%', padding: 0, alignItems: 'flex-start' }}>
                          <div className="settings-row__main">
                            <div className="settings-row__title">
                              <span className="dot settings-dot--error" />
                              <span>{log.source_name}</span>
                              <span className="chip">{log.source_type}</span>
                            </div>
                            <div className="settings-row__sub settings-row__sub--wrap settings-row__sub--danger">
                              {log.error_message || '未知错误'}
                            </div>
                          </div>
                          {log.started_at && (
                            <span className="settings-row__trail settings-num">
                              {dayjs(log.started_at).format('HH:mm:ss')}
                            </span>
                          )}
                        </div>
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
                    size="small"
                    dataSource={taskDetail?.new_articles || []}
                    renderItem={(article: { id: number; title: string; url: string; source: string; published_at?: string }) => (
                      <List.Item>
                        <div className="settings-row" style={{ width: '100%', padding: 0 }}>
                          <div className="settings-row__main">
                            <a href={article.url} target="_blank" rel="noopener noreferrer">
                              {article.title}
                            </a>
                            <div className="settings-row__sub">
                              <span className="chip">{article.source}</span>
                              {article.published_at && (
                                <span className="settings-num" style={{ marginLeft: 8 }}>
                                  {dayjs(article.published_at).format('YYYY-MM-DD HH:mm')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </List.Item>
                    )}
                    locale={{ emptyText: <Empty description="暂无新增文章" /> }}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: false,
                      size: 'small',
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
          className="settings-form"
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
            <SettingsNote>
              当前已启用采集日志，每 <span className="settings-num">{autoCollectionSettings.interval_hours}</span> 小时执行一次
            </SettingsNote>
          )}
        </Form>
      </Modal>
    </div>
  );
}
