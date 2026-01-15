/**
 * 系统配置组件
 */
import { useEffect, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  message,
  Space,
  Alert,
  Spin,
  Tabs,
  Select,
  Switch,
  Table,
  Modal,
  Popconfirm,
  TimePicker,
  Typography,
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined, LockOutlined, MinusCircleOutlined, DatabaseOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import CollectionHistory from '@/components/CollectionHistory';
import type { LLMSettings, NotificationSettings, SummarySettings, LLMProvider, LLMProviderCreate, LLMProviderUpdate, ImageSettings, ImageProvider, ImageProviderCreate, ImageProviderUpdate } from '@/types';

export default function SystemSettings() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [llmForm] = Form.useForm();
  const [notificationForm] = Form.useForm();
  const [summaryForm] = Form.useForm();
  const [providerForm] = Form.useForm();
  const [imageForm] = Form.useForm();
  const [imageProviderForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  const [imageProviderModalVisible, setImageProviderModalVisible] = useState(false);
  const [editingImageProvider, setEditingImageProvider] = useState<ImageProvider | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [batchSize, setBatchSize] = useState(10);

  // 获取LLM配置
  const { data: llmSettings, isLoading: llmLoading } = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => apiService.getLLMSettings(),
  });

  // 获取提供商列表
  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => apiService.getProviders(false),
  });

  // 获取图片生成配置
  const { data: imageSettings, isLoading: imageLoading } = useQuery({
    queryKey: ['image-settings'],
    queryFn: () => apiService.getImageSettings(),
  });

  // 获取图片生成提供商列表
  const { data: imageProviders = [], isLoading: imageProvidersLoading } = useQuery({
    queryKey: ['image-providers'],
    queryFn: () => apiService.getImageProviders(false),
  });

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
      message.success(`索引重建成功：${data.success} 篇文章已索引`);
      setIsIndexing(false);
      await refetchRAGStats();
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: (error: any) => {
      message.error(`索引重建失败：${error.message || '未知错误'}`);
      setIsIndexing(false);
    },
  });

  // 强制重建索引 mutation（清空所有索引后重新索引）
  const forceRebuildIndexMutation = useMutation({
    mutationFn: (batchSize: number) => apiService.rebuildAllIndexes(batchSize),
    onSuccess: async (data) => {
      message.success(`强制重建索引成功：${data.success} 篇文章已索引`);
      setIsIndexing(false);
      await refetchRAGStats();
      queryClient.invalidateQueries({ queryKey: ['rag-stats'] });
    },
    onError: (error: any) => {
      message.error(`强制重建索引失败：${error.message || '未知错误'}`);
      setIsIndexing(false);
    },
  });

  const handleRebuildIndex = () => {
    if (!isAuthenticated) {
      message.warning('需要登录才能重建索引');
      return;
    }
    setIsIndexing(true);
    rebuildIndexMutation.mutate(batchSize);
  };

  const handleForceRebuildIndex = () => {
    if (!isAuthenticated) {
      message.warning('需要登录才能强制重建索引');
      return;
    }
    setIsIndexing(true);
    forceRebuildIndexMutation.mutate(batchSize);
  };

  // 更新LLM配置
  const updateLLMMutation = useMutation({
    mutationFn: (data: LLMSettings) => apiService.updateLLMSettings(data),
    onSuccess: () => {
      message.success('LLM配置已保存');
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能保存LLM配置');
      } else {
        message.error('保存LLM配置失败');
      }
    },
  });

  // 创建提供商
  const createProviderMutation = useMutation({
    mutationFn: (data: LLMProviderCreate) => apiService.createProvider(data),
    onSuccess: () => {
      message.success('提供商创建成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      setProviderModalVisible(false);
      providerForm.resetFields();
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能创建提供商');
      } else {
        message.error(`创建提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 更新提供商
  const updateProviderMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LLMProviderUpdate }) => apiService.updateProvider(id, data),
    onSuccess: () => {
      message.success('提供商更新成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
      setProviderModalVisible(false);
      setEditingProvider(null);
      providerForm.resetFields();
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能更新提供商');
      } else {
        message.error(`更新提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 删除提供商
  const deleteProviderMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteProvider(id),
    onSuccess: () => {
      message.success('提供商删除成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能删除提供商');
      } else {
        message.error(`删除提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 更新图片生成配置
  const updateImageMutation = useMutation({
    mutationFn: (data: ImageSettings) => apiService.updateImageSettings(data),
    onSuccess: () => {
      message.success('图片生成配置已保存');
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能保存图片生成配置');
      } else {
        message.error('保存图片生成配置失败');
      }
    },
  });

  // 创建图片生成提供商
  const createImageProviderMutation = useMutation({
    mutationFn: (data: ImageProviderCreate) => apiService.createImageProvider(data),
    onSuccess: () => {
      message.success('图片生成提供商创建成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      setImageProviderModalVisible(false);
      imageProviderForm.resetFields();
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能创建图片生成提供商');
      } else {
        message.error(`创建图片生成提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 更新图片生成提供商
  const updateImageProviderMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ImageProviderUpdate }) => apiService.updateImageProvider(id, data),
    onSuccess: () => {
      message.success('图片生成提供商更新成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
      setImageProviderModalVisible(false);
      setEditingImageProvider(null);
      imageProviderForm.resetFields();
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能更新图片生成提供商');
      } else {
        message.error(`更新图片生成提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 删除图片生成提供商
  const deleteImageProviderMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteImageProvider(id),
    onSuccess: () => {
      message.success('图片生成提供商删除成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能删除图片生成提供商');
      } else {
        message.error(`删除图片生成提供商失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 获取通知配置
  const { data: notificationSettings, isLoading: notificationLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => apiService.getNotificationSettings(),
  });

  // 获取总结配置
  const { data: summarySettings, isLoading: summaryLoading } = useQuery({
    queryKey: ['summarySettings'],
    queryFn: () => apiService.getSummarySettings(),
  });

  // 更新通知配置
  const updateNotificationMutation = useMutation({
    mutationFn: (data: NotificationSettings) => apiService.updateNotificationSettings(data),
    onSuccess: () => {
      message.success('通知配置已保存');
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能保存通知配置');
      } else {
        message.error('保存通知配置失败');
      }
    },
  });

  // 更新总结配置
  const updateSummaryMutation = useMutation({
    mutationFn: (data: SummarySettings) => apiService.updateSummarySettings(data),
    onSuccess: () => {
      message.success('自动总结配置已保存');
      queryClient.invalidateQueries({ queryKey: ['summarySettings'] });
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能保存自动总结配置');
      } else {
        message.error('保存自动总结配置失败');
      }
    },
  });

  // 修改密码
  const changePasswordMutation = useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) =>
      apiService.changePassword(oldPassword, newPassword),
    onSuccess: () => {
      message.success('密码修改成功');
      passwordForm.resetFields();
    },
    onError: (error: any) => {
      if (error.status === 401) {
        message.error('需要登录才能修改密码');
      } else {
        message.error(error.message || '修改密码失败');
      }
    },
  });

  // 当配置加载完成后，初始化表单数据
  useEffect(() => {
    if (llmSettings) {
      // 将保存的提供商ID和模型组合成下拉框格式
      let selectedProviderAndModel: string | null = null;
      if (llmSettings.selected_llm_provider_id && llmSettings.selected_llm_models && llmSettings.selected_llm_models.length > 0) {
        selectedProviderAndModel = `${llmSettings.selected_llm_provider_id}:${llmSettings.selected_llm_models[0]}`;
      }
      
      // 将保存的向量模型提供商ID和模型组合成下拉框格式
      let selectedEmbeddingProviderAndModel: string | null = null;
      if (llmSettings.selected_embedding_provider_id && llmSettings.selected_embedding_models && llmSettings.selected_embedding_models.length > 0) {
        selectedEmbeddingProviderAndModel = `${llmSettings.selected_embedding_provider_id}:${llmSettings.selected_embedding_models[0]}`;
      }
      
      llmForm.setFieldsValue({
        ...llmSettings,
        selected_llm_provider_id: selectedProviderAndModel,
        selected_embedding_provider_id: selectedEmbeddingProviderAndModel,
      });
    }
  }, [llmSettings, llmForm]);

  useEffect(() => {
    if (notificationSettings) {
      // 将勿扰时段的时间字符串转换为dayjs对象
      const formValues = {
        ...notificationSettings,
        quiet_hours: (notificationSettings.quiet_hours || []).map((qh: any) => ({
          start_time: qh.start_time ? dayjs(qh.start_time, 'HH:mm') : null,
          end_time: qh.end_time ? dayjs(qh.end_time, 'HH:mm') : null,
        })),
      };
      notificationForm.setFieldsValue(formValues);
    }
  }, [notificationSettings, notificationForm]);

  useEffect(() => {
    if (summarySettings) {
      summaryForm.setFieldsValue({
        daily_summary_enabled: summarySettings.daily_summary_enabled,
        daily_summary_time: summarySettings.daily_summary_time ? dayjs(summarySettings.daily_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
        weekly_summary_enabled: summarySettings.weekly_summary_enabled,
        weekly_summary_time: summarySettings.weekly_summary_time ? dayjs(summarySettings.weekly_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
      });
    }
  }, [summarySettings, summaryForm]);

  useEffect(() => {
    if (imageSettings) {
      // 将保存的提供商ID和模型组合成下拉框格式
      let selectedProviderAndModel: string | null = null;
      if (imageSettings.selected_image_provider_id && imageSettings.selected_image_models && imageSettings.selected_image_models.length > 0) {
        selectedProviderAndModel = `${imageSettings.selected_image_provider_id}:${imageSettings.selected_image_models[0]}`;
      }
      
      imageForm.setFieldsValue({
        ...imageSettings,
        selected_image_provider_id: selectedProviderAndModel,
      });
    }
  }, [imageSettings, imageForm]);

  const handleLLMSave = (values: any) => {
    // 解析 selected_llm_provider_id，格式为 "provider_id:model_name"
    const providerAndModel = values.selected_llm_provider_id;
    let selected_llm_provider_id: number | null = null;
    let selected_llm_models: string[] = [];
    
    if (providerAndModel && typeof providerAndModel === 'string') {
      const [providerId, modelName] = providerAndModel.split(':');
      if (providerId && modelName) {
        selected_llm_provider_id = parseInt(providerId, 10);
        selected_llm_models = [modelName];
      }
    }
    
    // 解析 selected_embedding_provider_id，格式为 "provider_id:model_name"
    const embeddingProviderAndModel = values.selected_embedding_provider_id;
    let selected_embedding_provider_id: number | null = null;
    let selected_embedding_models: string[] = [];
    
    if (embeddingProviderAndModel && typeof embeddingProviderAndModel === 'string') {
      const [providerId, modelName] = embeddingProviderAndModel.split(':');
      if (providerId && modelName) {
        selected_embedding_provider_id = parseInt(providerId, 10);
        selected_embedding_models = [modelName];
      }
    }
    
    updateLLMMutation.mutate({
      selected_llm_provider_id,
      selected_embedding_provider_id,
      selected_llm_models,
      selected_embedding_models,
    });
  };

  const handleNotificationSave = (values: any) => {
    // 将勿扰时段的dayjs对象转换为时间字符串
    const notificationData: NotificationSettings = {
      ...values,
      quiet_hours: values.quiet_hours?.map((qh: any) => ({
        start_time: qh.start_time ? qh.start_time.format('HH:mm') : '',
        end_time: qh.end_time ? qh.end_time.format('HH:mm') : '',
      })).filter((qh: any) => qh.start_time && qh.end_time) || [],
    };
    updateNotificationMutation.mutate(notificationData);
  };

  const handleSummarySave = (values: any) => {
    const summaryData: SummarySettings = {
      daily_summary_enabled: values.daily_summary_enabled,
      daily_summary_time: values.daily_summary_time ? values.daily_summary_time.format('HH:mm') : '09:00',
      weekly_summary_enabled: values.weekly_summary_enabled,
      weekly_summary_time: values.weekly_summary_time ? values.weekly_summary_time.format('HH:mm') : '09:00',
    };
    updateSummaryMutation.mutate(summaryData);
  };

  const handleProviderCreate = () => {
    setEditingProvider(null);
    providerForm.resetFields();
    setProviderModalVisible(true);
  };

  const handleProviderEdit = (provider: LLMProvider) => {
    setEditingProvider(provider);
    providerForm.setFieldsValue(provider);
    setProviderModalVisible(true);
  };

  const handleProviderDelete = (id: number) => {
    deleteProviderMutation.mutate(id);
  };

  const handleProviderSubmit = (values: LLMProviderCreate | LLMProviderUpdate) => {
    if (editingProvider) {
      updateProviderMutation.mutate({ id: editingProvider.id, data: values });
    } else {
      createProviderMutation.mutate(values as LLMProviderCreate);
    }
  };

  const handleImageSave = (values: any) => {
    // 解析 selected_image_provider_id，格式为 "provider_id:model_name"
    const providerAndModel = values.selected_image_provider_id;
    let selected_image_provider_id: number | null = null;
    let selected_image_models: string[] = [];
    
    if (providerAndModel && typeof providerAndModel === 'string') {
      const [providerId, modelName] = providerAndModel.split(':');
      if (providerId && modelName) {
        selected_image_provider_id = parseInt(providerId, 10);
        selected_image_models = [modelName];
      }
    }
    
    updateImageMutation.mutate({
      selected_image_provider_id,
      selected_image_models,
    });
  };

  const handleImageProviderCreate = () => {
    setEditingImageProvider(null);
    imageProviderForm.resetFields();
    setImageProviderModalVisible(true);
  };

  const handleImageProviderEdit = (provider: ImageProvider) => {
    setEditingImageProvider(provider);
    imageProviderForm.setFieldsValue(provider);
    setImageProviderModalVisible(true);
  };

  const handleImageProviderDelete = (id: number) => {
    deleteImageProviderMutation.mutate(id);
  };

  const handleImageProviderSubmit = (values: ImageProviderCreate | ImageProviderUpdate) => {
    if (editingImageProvider) {
      updateImageProviderMutation.mutate({ id: editingImageProvider.id, data: values });
    } else {
      createImageProviderMutation.mutate(values as ImageProviderCreate);
    }
  };

  const handlePasswordChange = (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    changePasswordMutation.mutate({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
  };

  // 获取已启用的提供商（用于选择）
  const enabledProviders = providers.filter(p => p.enabled);
  const embeddingProviders = providers.filter(p => p.enabled && p.embedding_model);
  const enabledImageProviders = imageProviders.filter(p => p.enabled);

  const tabItems = [
    {
      key: 'image',
      label: '文生图配置',
      children: (
        <Spin spinning={imageLoading || imageProvidersLoading}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 图片生成提供商管理 */}
            <Card
              title="图片生成提供商管理"
              extra={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleImageProviderCreate}
                  disabled={!isAuthenticated}
                >
                  添加提供商
                </Button>
              }
            >
              <Alert
                message="提供商管理说明"
                description="可以配置多个图片生成提供商，并分别选择使用哪个提供商的模型。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Table
                dataSource={imageProviders}
                rowKey="id"
                columns={[
                  {
                    title: '名称',
                    dataIndex: 'name',
                    key: 'name',
                  },
                  {
                    title: '类型',
                    dataIndex: 'provider_type',
                    key: 'provider_type',
                  },
                  {
                    title: '图片生成模型',
                    dataIndex: 'image_model',
                    key: 'image_model',
                    render: (text: string) => {
                      const models = text.split(',').map(m => m.trim()).filter(m => m);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {models.map((model, index) => (
                            <div key={index}>{model}</div>
                          ))}
                        </div>
                      );
                    },
                  },
                  {
                    title: '状态',
                    dataIndex: 'enabled',
                    key: 'enabled',
                    render: (enabled) => (
                      <Switch checked={enabled} disabled />
                    ),
                  },
                  {
                    title: '操作',
                    key: 'action',
                    render: (_, record) => (
                      <Space>
                        <Button
                          type="link"
                          icon={<EditOutlined />}
                          onClick={() => handleImageProviderEdit(record)}
                          disabled={!isAuthenticated}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确定要删除此提供商吗？"
                          onConfirm={() => handleImageProviderDelete(record.id)}
                          okText="确定"
                          cancelText="取消"
                          disabled={!isAuthenticated}
                        >
                          <Button
                            type="link"
                            danger
                            icon={<DeleteOutlined />}
                            disabled={!isAuthenticated}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
                pagination={false}
              />
            </Card>

            {/* 图片生成提供商选择 */}
            <Card title="图片生成提供商选择">
              <Form
                form={imageForm}
                layout="vertical"
                onFinish={handleImageSave}
                initialValues={imageSettings}
              >
                <Alert
                  message="提供商选择说明"
                  description="选择要使用的图片生成提供商和模型。请确保至少选择一个提供商才能正常使用文生图功能。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 24 }}
                />

                <Form.Item
                  name="selected_image_provider_id"
                  label="图片生成提供商"
                  tooltip="选择用于图片生成的提供商和模型"
                  rules={[{ required: true, message: '请选择图片生成提供商' }]}
                >
                  <Select
                    placeholder="选择图片生成提供商"
                    style={{ width: '100%' }}
                    disabled={!isAuthenticated}
                    options={enabledImageProviders.flatMap(p => {
                      const models = p.image_model.split(',').map(m => m.trim()).filter(m => m);
                      // 为每个模型创建一个选项，格式为 provider_name(model_name)
                      return models.map(model => ({
                        label: `${p.name}(${model})`,
                        value: `${p.id}:${model}`, // 使用 provider_id:model_name 格式
                      }));
                    })}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      htmlType="submit"
                      loading={updateImageMutation.isPending}
                      disabled={!isAuthenticated}
                    >
                      保存配置
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        imageForm.setFieldsValue(imageSettings);
                      }}
                    >
                      重置
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
            </Card>
          </Space>

          {/* 图片生成提供商编辑/创建模态框 */}
          <Modal
            title={editingImageProvider ? '编辑图片生成提供商' : '添加图片生成提供商'}
            open={imageProviderModalVisible}
            onCancel={() => {
              setImageProviderModalVisible(false);
              setEditingImageProvider(null);
              imageProviderForm.resetFields();
            }}
            onOk={() => imageProviderForm.submit()}
            confirmLoading={createImageProviderMutation.isPending || updateImageProviderMutation.isPending}
            width={600}
          >
            <Form
              form={imageProviderForm}
              layout="vertical"
              onFinish={handleImageProviderSubmit}
            >
              <Form.Item
                name="name"
                label="提供商名称"
                rules={[{ required: true, message: '请输入提供商名称' }]}
              >
                <Input placeholder="例如: 阿里云百炼" />
              </Form.Item>

              <Form.Item
                name="provider_type"
                label="类型"
                rules={[{ required: true, message: '请选择类型' }]}
                tooltip="指定使用什么接口访问模型"
              >
                <Select
                  placeholder="选择类型"
                  options={[
                    { label: '文生图(BaiLian)', value: '文生图(BaiLian)' },
                    { label: '文生图(智谱)', value: '文生图(智谱)' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="api_key"
                label="API密钥"
                rules={[{ required: true, message: '请输入API密钥' }]}
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>

              <Form.Item
                name="api_base"
                label="API基础URL"
                rules={[{ required: true, message: '请输入API基础URL' }]}
                tooltip="文生图(BaiLian): https://dashscope.aliyuncs.com/compatible-mode/v1 | 文生图(智谱): https://open.bigmodel.cn/api/paas/v4"
              >
                <Input placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1 或 https://open.bigmodel.cn/api/paas/v4" />
              </Form.Item>

              <Form.Item
                name="image_model"
                label="图片生成模型名称"
                rules={[{ required: true, message: '请输入图片生成模型名称' }]}
                tooltip="支持填写多个模型，使用逗号分隔。文生图(BaiLian): wanx-v1, dall-e-3 | 文生图(智谱): glm-image, cogview-4, cogview-3-flash"
              >
                <Input placeholder="wanx-v1, dall-e-3 或 glm-image, cogview-4" />
              </Form.Item>

              <Form.Item
                name="enabled"
                label="启用"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </Form>
          </Modal>
        </Spin>
      ),
    },
    {
      key: 'llm',
      label: 'LLM配置',
      children: (
        <Spin spinning={llmLoading || providersLoading}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 提供商管理 */}
            <Card
              title="提供商管理"
              extra={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleProviderCreate}
                  disabled={!isAuthenticated}
                >
                  添加提供商
                </Button>
              }
            >
              <Alert
                message="提供商管理说明"
                description="可以配置多个AI提供商，并分别选择使用哪个提供商的大模型和向量模型。某些提供商可能只提供大模型而没有向量模型。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Table
                dataSource={providers}
                rowKey="id"
                columns={[
                  {
                    title: '名称',
                    dataIndex: 'name',
                    key: 'name',
                  },
                  {
                    title: '类型',
                    dataIndex: 'provider_type',
                    key: 'provider_type',
                  },
                  {
                    title: '大模型',
                    dataIndex: 'llm_model',
                    key: 'llm_model',
                    render: (text: string) => {
                      const models = text.split(',').map(m => m.trim()).filter(m => m);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {models.map((model, index) => (
                            <div key={index}>{model}</div>
                          ))}
                        </div>
                      );
                    },
                  },
                  {
                    title: '向量模型',
                    dataIndex: 'embedding_model',
                    key: 'embedding_model',
                    render: (text: string) => {
                      if (!text) return '-';
                      const models = text.split(',').map(m => m.trim()).filter(m => m);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {models.map((model, index) => (
                            <div key={index}>{model}</div>
                          ))}
                        </div>
                      );
                    },
                  },
                  {
                    title: '状态',
                    dataIndex: 'enabled',
                    key: 'enabled',
                    render: (enabled) => (
                      <Switch checked={enabled} disabled />
                    ),
                  },
                  {
                    title: '操作',
                    key: 'action',
                    render: (_, record) => (
                      <Space>
                        <Button
                          type="link"
                          icon={<EditOutlined />}
                          onClick={() => handleProviderEdit(record)}
                          disabled={!isAuthenticated}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确定要删除此提供商吗？"
                          onConfirm={() => handleProviderDelete(record.id)}
                          okText="确定"
                          cancelText="取消"
                          disabled={!isAuthenticated}
                        >
                          <Button
                            type="link"
                            danger
                            icon={<DeleteOutlined />}
                            disabled={!isAuthenticated}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
                pagination={false}
              />
            </Card>

            {/* 提供商选择 */}
            <Card title="提供商选择">
              <Form
                form={llmForm}
                layout="vertical"
                onFinish={handleLLMSave}
                initialValues={llmSettings}
              >
                <Alert
                  message="提供商选择说明"
                  description="选择要使用的大模型提供商和向量模型提供商。请确保至少选择一个提供商才能正常使用AI功能。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 24 }}
                />

                <Form.Item
                  name="selected_llm_provider_id"
                  label="大模型提供商"
                  tooltip="选择用于AI分析的大模型提供商和模型"
                  rules={[{ required: true, message: '请选择大模型提供商' }]}
                >
                  <Select
                    placeholder="选择大模型提供商"
                    style={{ width: '100%' }}
                    disabled={!isAuthenticated}
                    options={enabledProviders.flatMap(p => {
                      const models = p.llm_model.split(',').map(m => m.trim()).filter(m => m);
                      // 为每个模型创建一个选项，格式为 provider_name(model_name)
                      return models.map(model => ({
                        label: `${p.name}(${model})`,
                        value: `${p.id}:${model}`, // 使用 provider_id:model_name 格式
                      }));
                    })}
                  />
                </Form.Item>

                <Form.Item
                  name="selected_embedding_provider_id"
                  label="向量模型提供商"
                  tooltip="选择用于生成向量嵌入的提供商和模型"
                  rules={[{ required: true, message: '请选择向量模型提供商' }]}
                >
                  <Select
                    placeholder="选择向量模型提供商"
                    style={{ width: '100%' }}
                    disabled={!isAuthenticated}
                    options={embeddingProviders.flatMap(p => {
                      if (!p.embedding_model) return [];
                      const models = p.embedding_model.split(',').map(m => m.trim()).filter(m => m);
                      // 为每个模型创建一个选项，格式为 provider_name(model_name)
                      return models.map(model => ({
                        label: `${p.name}(${model})`,
                        value: `${p.id}:${model}`, // 使用 provider_id:model_name 格式
                      }));
                    })}
                  />
                </Form.Item>

                <Form.Item>
                  <Space>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      htmlType="submit"
                      loading={updateLLMMutation.isPending}
                      disabled={!isAuthenticated}
                    >
                      保存配置
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        llmForm.setFieldsValue(llmSettings);
                      }}
                    >
                      重置
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
            </Card>
          </Space>

          {/* 提供商编辑/创建模态框 */}
          <Modal
            title={editingProvider ? '编辑提供商' : '添加提供商'}
            open={providerModalVisible}
            onCancel={() => {
              setProviderModalVisible(false);
              setEditingProvider(null);
              providerForm.resetFields();
            }}
            onOk={() => providerForm.submit()}
            confirmLoading={createProviderMutation.isPending || updateProviderMutation.isPending}
            width={600}
          >
            <Form
              form={providerForm}
              layout="vertical"
              onFinish={handleProviderSubmit}
            >
              <Form.Item
                name="name"
                label="提供商名称"
                rules={[{ required: true, message: '请输入提供商名称' }]}
              >
                <Input placeholder="例如: OpenAI" />
              </Form.Item>

              <Form.Item
                name="provider_type"
                label="类型"
                rules={[{ required: true, message: '请选择类型' }]}
                tooltip="指定使用什么接口访问模型"
              >
                <Select
                  placeholder="选择类型"
                  options={[
                    { label: '大模型(OpenAI)', value: '大模型(OpenAI)' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="api_key"
                label="API密钥"
                rules={[{ required: true, message: '请输入API密钥' }]}
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>

              <Form.Item
                name="api_base"
                label="API基础URL"
                rules={[{ required: true, message: '请输入API基础URL' }]}
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>

              <Form.Item
                name="llm_model"
                label="大模型名称"
                rules={[{ required: true, message: '请输入大模型名称' }]}
                tooltip="支持填写多个模型，使用逗号分隔，例如：deepseek-v3.1, gpt-4-turbo-preview"
              >
                <Input placeholder="deepseek-v3.1, gpt-4-turbo-preview" />
              </Form.Item>

              <Form.Item
                name="embedding_model"
                label="向量模型名称（可选）"
                tooltip="如果此提供商支持向量模型，请填写。支持填写多个模型，使用逗号分隔，例如：text-embedding-3-small, text-embedding-3-large。如果不支持，留空即可。"
              >
                <Input placeholder="text-embedding-3-small, text-embedding-3-large" />
              </Form.Item>

              <Form.Item
                name="enabled"
                label="启用"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </Form>
          </Modal>
        </Spin>
      ),
    },
    {
      key: 'notification',
      label: '通知配置',
      children: (
        <Spin spinning={notificationLoading}>
          <Card>
            <Form
              form={notificationForm}
              layout="vertical"
              onFinish={handleNotificationSave}
              initialValues={notificationSettings}
            >
              <Alert
                message="通知配置说明"
                description="配置飞书或钉钉机器人，用于接收每日摘要和高重要性文章的推送通知。"
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
              />

              <Form.Item
                name="platform"
                label="通知平台"
                rules={[{ required: true, message: '请选择通知平台' }]}
                tooltip="选择通知平台：飞书或钉钉"
              >
                <Select
                  placeholder="请选择通知平台"
                  style={{ width: '100%' }}
                  disabled={!isAuthenticated}
                  options={[
                    { label: '飞书', value: 'feishu' },
                    { label: '钉钉', value: 'dingtalk' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="webhook_url"
                label="Webhook URL"
                rules={[{ required: true, message: '请输入Webhook URL' }]}
                tooltip="飞书或钉钉机器人的Webhook URL"
              >
                <Input
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  style={{ width: '100%' }}
                  disabled={!isAuthenticated}
                />
              </Form.Item>

              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) =>
                  prevValues.platform !== currentValues.platform
                }
              >
                {({ getFieldValue }) =>
                  getFieldValue('platform') === 'dingtalk' ? (
                    <Form.Item
                      name="secret"
                      label="加签密钥（可选）"
                      tooltip="钉钉机器人的加签密钥，如果机器人配置了加签，请填写此字段"
                    >
                      <Input.Password
                        placeholder="如果使用了加签，请输入密钥"
                        style={{ width: '100%' }}
                        disabled={!isAuthenticated}
                      />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>

              <Form.Item
                name="instant_notification_enabled"
                label="启用即时通知"
                valuePropName="checked"
                tooltip="是否启用即时通知：当采集到高重要性文章并且在一小时内时立即推送，内容总结立即通知"
              >
                <Switch disabled={!isAuthenticated} />
              </Form.Item>

              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) =>
                  prevValues.instant_notification_enabled !== currentValues.instant_notification_enabled
                }
              >
                {({ getFieldValue }) => {
                  const instantEnabled = getFieldValue('instant_notification_enabled');
                  return instantEnabled ? (
                    <Form.Item
                      name="quiet_hours"
                      label="勿扰时段"
                      tooltip="在勿扰时段内不会发送通知。可以配置多个时段，例如：22:00-08:00 表示晚上10点到早上8点"
                    >
                      <Form.List name="quiet_hours">
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map(({ key, name, ...restField }) => (
                              <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'start_time']}
                                  rules={[{ required: true, message: '请选择开始时间' }]}
                                >
                                  <TimePicker
                                    format="HH:mm"
                                    placeholder="开始时间"
                                    style={{ width: 120 }}
                                    disabled={!isAuthenticated}
                                  />
                                </Form.Item>
                                <span>至</span>
                                <Form.Item
                                  {...restField}
                                  name={[name, 'end_time']}
                                  rules={[{ required: true, message: '请选择结束时间' }]}
                                >
                                  <TimePicker
                                    format="HH:mm"
                                    placeholder="结束时间"
                                    style={{ width: 120 }}
                                    disabled={!isAuthenticated}
                                  />
                                </Form.Item>
                                <MinusCircleOutlined
                                  onClick={() => remove(name)}
                                  style={{ color: '#ff4d4f', cursor: 'pointer' }}
                                />
                              </Space>
                            ))}
                            <Form.Item>
                              <Button
                                type="dashed"
                                onClick={() => add()}
                                block
                                icon={<PlusOutlined />}
                                disabled={!isAuthenticated}
                              >
                                添加勿扰时段
                              </Button>
                            </Form.Item>
                          </>
                        )}
                      </Form.List>
                    </Form.Item>
                  ) : null;
                }}
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    htmlType="submit"
                    loading={updateNotificationMutation.isPending}
                    disabled={!isAuthenticated}
                  >
                    保存配置
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      notificationForm.setFieldsValue(notificationSettings);
                    }}
                  >
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Spin>
      ),
    },
    {
      key: 'summary',
      label: '自动总结',
      children: (
        <Spin spinning={summaryLoading}>
          <Card>
            <Form
              form={summaryForm}
              layout="vertical"
              onFinish={handleSummarySave}
              initialValues={{
                daily_summary_enabled: true,
                daily_summary_time: dayjs('09:00', 'HH:mm'),
                weekly_summary_enabled: true,
                weekly_summary_time: dayjs('09:00', 'HH:mm'),
              }}
            >
              <Alert
                message="自动总结说明"
                description="配置每日和每周自动总结的启用状态和执行时间。每日总结统计昨天的内容，每周总结在周六执行，统计上周的内容。"
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
              />

              <Form.Item label="每日总结">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item
                    name="daily_summary_enabled"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" disabled={!isAuthenticated} />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) =>
                      prevValues.daily_summary_enabled !== currentValues.daily_summary_enabled
                    }
                  >
                    {({ getFieldValue }) => {
                      const enabled = getFieldValue('daily_summary_enabled');
                      return (
                        <Form.Item
                          name="daily_summary_time"
                          label="执行时间"
                          style={{ marginBottom: 0 }}
                        >
                          <TimePicker
                            format="HH:mm"
                            style={{ width: '100%' }}
                            disabled={!enabled || !isAuthenticated}
                            placeholder="选择时间（默认09:00）"
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                    每日总结将在每天指定时间自动生成（统计昨天的内容）
                  </Typography.Text>
                </Space>
              </Form.Item>

              <Form.Item label="每周总结" style={{ marginTop: 24 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Form.Item
                    name="weekly_summary_enabled"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" disabled={!isAuthenticated} />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) =>
                      prevValues.weekly_summary_enabled !== currentValues.weekly_summary_enabled
                    }
                  >
                    {({ getFieldValue }) => {
                      const enabled = getFieldValue('weekly_summary_enabled');
                      return (
                        <Form.Item
                          name="weekly_summary_time"
                          label="执行时间（周六执行）"
                          style={{ marginBottom: 0 }}
                        >
                          <TimePicker
                            format="HH:mm"
                            style={{ width: '100%' }}
                            disabled={!enabled || !isAuthenticated}
                            placeholder="选择时间（默认09:00）"
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                    每周总结将在每周六指定时间自动生成（统计上周的内容，周跨度：上周六、上周日、上周一到上周五）
                  </Typography.Text>
                </Space>
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    htmlType="submit"
                    loading={updateSummaryMutation.isPending}
                    disabled={!isAuthenticated}
                  >
                    保存配置
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      if (summarySettings) {
                        summaryForm.setFieldsValue({
                          daily_summary_enabled: summarySettings.daily_summary_enabled,
                          daily_summary_time: summarySettings.daily_summary_time ? dayjs(summarySettings.daily_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
                          weekly_summary_enabled: summarySettings.weekly_summary_enabled,
                          weekly_summary_time: summarySettings.weekly_summary_time ? dayjs(summarySettings.weekly_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
                        });
                      }
                    }}
                  >
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Spin>
      ),
    },
    {
      key: 'collection',
      label: '自动采集',
      children: <CollectionHistory />,
    },
    {
      key: 'sources',
      label: '订阅管理',
      children: <SourceManagement />,
    },
    {
      key: 'cleanup',
      label: '数据清理',
      children: <DataCleanup />,
    },
    {
      key: 'rag-index',
      label: 'RAG索引管理',
      children: (
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
      ),
    },
    {
      key: 'password',
      label: '修改密码',
      children: (
        <Card>
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={handlePasswordChange}
            style={{ maxWidth: 500 }}
          >
            <Alert
              message="修改密码说明"
              description="请确保新密码长度至少为6位，建议使用包含字母、数字和特殊字符的强密码。"
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password
                placeholder="请输入当前密码"
                prefix={<LockOutlined />}
                disabled={!isAuthenticated}
              />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码长度至少为6位' },
              ]}
            >
              <Input.Password
                placeholder="请输入新密码（至少6位）"
                prefix={<LockOutlined />}
                disabled={!isAuthenticated}
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的新密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password
                placeholder="请再次输入新密码"
                prefix={<LockOutlined />}
                disabled={!isAuthenticated}
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                icon={<LockOutlined />}
                htmlType="submit"
                loading={changePasswordMutation.isPending}
                disabled={!isAuthenticated}
              >
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
  ];

  return (
    <div>
      {!isAuthenticated && (
        <Alert
          message="只读模式"
          description="您当前未登录，只能查看设置，无法进行修改。请先登录以获取编辑权限。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs items={tabItems} />
    </div>
  );
}
