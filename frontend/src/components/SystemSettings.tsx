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
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import CollectionHistory from '@/components/CollectionHistory';
import type { LLMSettings, NotificationSettings, LLMProvider, LLMProviderCreate, LLMProviderUpdate } from '@/types';

export default function SystemSettings() {
  const queryClient = useQueryClient();
  const [llmForm] = Form.useForm();
  const [notificationForm] = Form.useForm();
  const [providerForm] = Form.useForm();
  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);

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

  // 更新LLM配置
  const updateLLMMutation = useMutation({
    mutationFn: (data: LLMSettings) => apiService.updateLLMSettings(data),
    onSuccess: () => {
      message.success('LLM配置已保存');
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: () => {
      message.error('保存LLM配置失败');
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
      message.error(`创建提供商失败: ${error.response?.data?.detail || error.message}`);
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
      message.error(`更新提供商失败: ${error.response?.data?.detail || error.message}`);
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
      message.error(`删除提供商失败: ${error.response?.data?.detail || error.message}`);
    },
  });

  // 获取通知配置
  const { data: notificationSettings, isLoading: notificationLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => apiService.getNotificationSettings(),
  });

  // 更新通知配置
  const updateNotificationMutation = useMutation({
    mutationFn: (data: NotificationSettings) => apiService.updateNotificationSettings(data),
    onSuccess: () => {
      message.success('通知配置已保存');
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
    onError: () => {
      message.error('保存通知配置失败');
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
      notificationForm.setFieldsValue(notificationSettings);
    }
  }, [notificationSettings, notificationForm]);

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

  const handleNotificationSave = (values: NotificationSettings) => {
    updateNotificationMutation.mutate(values);
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

  // 获取已启用的提供商（用于选择）
  const enabledProviders = providers.filter(p => p.enabled);
  const embeddingProviders = providers.filter(p => p.enabled && p.embedding_model);

  const tabItems = [
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
                    title: '大模型',
                    dataIndex: 'llm_model',
                    key: 'llm_model',
                    render: (text: string) => {
                      const models = text.split(',').map(m => m.trim()).filter(m => m);
                      return models.length > 1 ? `${models[0]} 等${models.length}个` : text;
                    },
                  },
                  {
                    title: '向量模型',
                    dataIndex: 'embedding_model',
                    key: 'embedding_model',
                    render: (text: string) => {
                      if (!text) return '-';
                      const models = text.split(',').map(m => m.trim()).filter(m => m);
                      return models.length > 1 ? `${models[0]} 等${models.length}个` : text;
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
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确定要删除此提供商吗？"
                          onConfirm={() => handleProviderDelete(record.id)}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Button
                            type="link"
                            danger
                            icon={<DeleteOutlined />}
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
                <Switch />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    htmlType="submit"
                    loading={updateNotificationMutation.isPending}
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
      key: 'collection',
      label: '自动采集',
      children: <CollectionHistory />,
    },
    {
      key: 'sources',
      label: '订阅源管理',
      children: <SourceManagement />,
    },
    {
      key: 'cleanup',
      label: '数据清理',
      children: <DataCleanup />,
    },
  ];

  return (
    <div>
      <Tabs items={tabItems} />
    </div>
  );
}
