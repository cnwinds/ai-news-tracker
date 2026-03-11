/**
 * LLM配置标签页组件
 */
import { useEffect, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Spin,
  Select,
  Switch,
  Table,
  Modal,
  Popconfirm,
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { safeSetFieldsValue } from '@/utils/form';
import type { LLMSettings, LLMProvider, LLMProviderCreate, LLMProviderUpdate } from '@/types';
import type { LLMFormValues } from './types';

export default function LLMSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [llmForm] = Form.useForm();
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
      showSuccess('LLM配置已保存');
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: createErrorHandler({
      operationName: '保存LLM配置',
      customMessages: {
        auth: '需要登录才能保存LLM配置',
      },
    }),
  });

  // 创建提供商
  const createProviderMutation = useMutation({
    mutationFn: (data: LLMProviderCreate) => apiService.createProvider(data),
    onSuccess: () => {
      showSuccess('提供商创建成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      setProviderModalVisible(false);
      providerForm.resetFields();
    },
    onError: createErrorHandler({
      operationName: '创建提供商',
      customMessages: {
        auth: '需要登录才能创建提供商',
      },
    }),
  });

  // 更新提供商
  const updateProviderMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LLMProviderUpdate }) => apiService.updateProvider(id, data),
    onSuccess: () => {
      showSuccess('提供商更新成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
      setProviderModalVisible(false);
      setEditingProvider(null);
      providerForm.resetFields();
    },
    onError: createErrorHandler({
      operationName: '更新提供商',
      customMessages: {
        auth: '需要登录才能更新提供商',
      },
    }),
  });

  // 删除提供商
  const deleteProviderMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteProvider(id),
    onSuccess: () => {
      showSuccess('提供商删除成功');
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: createErrorHandler({
      operationName: '删除提供商',
      customMessages: {
        auth: '需要登录才能删除提供商',
      },
    }),
  });

  // 当配置加载完成后，初始化表单数据
  useEffect(() => {
    if (llmSettings && llmForm) {
      const selectedProviderAndModel = llmSettings.selected_llm_provider_id && llmSettings.selected_llm_models?.length
        ? `${llmSettings.selected_llm_provider_id}:${llmSettings.selected_llm_models[0]}`
        : null;

      const selectedEmbeddingProviderAndModel = llmSettings.selected_embedding_provider_id && llmSettings.selected_embedding_models?.length
        ? `${llmSettings.selected_embedding_provider_id}:${llmSettings.selected_embedding_models[0]}`
        : null;

      const selectedExplorationProviderAndModel = llmSettings.selected_exploration_provider_id && llmSettings.selected_exploration_models?.length
        ? `${llmSettings.selected_exploration_provider_id}:${llmSettings.selected_exploration_models[0]}`
        : null;

      safeSetFieldsValue(llmForm, {
        ...llmSettings,
        selected_llm_provider_id: selectedProviderAndModel,
        selected_embedding_provider_id: selectedEmbeddingProviderAndModel,
        selected_exploration_provider_id: selectedExplorationProviderAndModel,
        exploration_execution_mode: llmSettings.exploration_execution_mode || 'auto',
        exploration_use_independent_provider: llmSettings.exploration_use_independent_provider || false,
      });
    }
  }, [llmSettings, llmForm]);

  const handleLLMSave = (values: LLMFormValues) => {
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

    const explorationProviderAndModel = values.selected_exploration_provider_id;
    let selected_exploration_provider_id: number | null = null;
    let selected_exploration_models: string[] = [];
    if (explorationProviderAndModel && typeof explorationProviderAndModel === 'string') {
      const [providerId, modelName] = explorationProviderAndModel.split(':');
      if (providerId && modelName) {
        selected_exploration_provider_id = parseInt(providerId, 10);
        selected_exploration_models = [modelName];
      }
    }
    
    updateLLMMutation.mutate({
      selected_llm_provider_id,
      selected_embedding_provider_id,
      selected_llm_models,
      selected_embedding_models,
      exploration_execution_mode: values.exploration_execution_mode || 'auto',
      exploration_use_independent_provider: values.exploration_use_independent_provider || false,
      selected_exploration_provider_id,
      selected_exploration_models,
    });
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
  const explorationUseIndependentProvider = Form.useWatch('exploration_use_independent_provider', llmForm) || false;

  return (
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
                align: 'center',
                width: 80,
                render: (enabled) => (
                  <Switch checked={enabled} disabled />
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 80,
                align: 'center',
                render: (_, record) => (
                  <Space direction="vertical" size={0}>
                    <Button
                      type="link"
                      icon={<EditOutlined />}
                      onClick={() => handleProviderEdit(record)}
                      disabled={!isAuthenticated}
                      size="small"
                      style={{ padding: 0 }}
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
                        size="small"
                        style={{ padding: 0 }}
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
                  return models.map(model => ({
                    label: `${p.name}(${model})`,
                    value: `${p.id}:${model}`,
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
                  return models.map(model => ({
                    label: `${p.name}(${model})`,
                    value: `${p.id}:${model}`,
                  }));
                })}
              />
            </Form.Item>

            <Card size="small" title="自主探索 Agent 模式" style={{ marginBottom: 24 }}>
              <Form.Item
                name="exploration_execution_mode"
                label="执行模式"
                tooltip="auto: 按配置自动选择，agent: 强制Agent模式，deterministic: 规则模式"
                rules={[{ required: true, message: '请选择执行模式' }]}
              >
                <Select
                  disabled={!isAuthenticated}
                  options={[
                    { label: '自动（推荐）', value: 'auto' },
                    { label: 'Agent模式', value: 'agent' },
                    { label: '规则模式', value: 'deterministic' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="exploration_use_independent_provider"
                label="使用独立模型"
                valuePropName="checked"
                tooltip="开启后，自主探索可使用不同于全局LLM的独立模型配置"
              >
                <Switch disabled={!isAuthenticated} />
              </Form.Item>

              {explorationUseIndependentProvider && (
                <Form.Item
                  name="selected_exploration_provider_id"
                  label="自主探索模型提供商"
                  tooltip="选择自主探索 Agent 专用提供商和模型"
                  rules={[{ required: true, message: '请选择自主探索模型提供商' }]}
                >
                  <Select
                    placeholder="选择自主探索模型提供商"
                    style={{ width: '100%' }}
                    disabled={!isAuthenticated}
                    options={enabledProviders.flatMap(p => {
                      const models = p.llm_model.split(',').map(m => m.trim()).filter(m => m);
                      return models.map(model => ({
                        label: `${p.name}(${model})`,
                        value: `${p.id}:${model}`,
                      }));
                    })}
                  />
                </Form.Item>
              )}
            </Card>

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
                    if (llmSettings) {
                      const selectedProviderAndModel = llmSettings.selected_llm_provider_id && llmSettings.selected_llm_models?.length
                        ? `${llmSettings.selected_llm_provider_id}:${llmSettings.selected_llm_models[0]}`
                        : null;
                      const selectedEmbeddingProviderAndModel = llmSettings.selected_embedding_provider_id && llmSettings.selected_embedding_models?.length
                        ? `${llmSettings.selected_embedding_provider_id}:${llmSettings.selected_embedding_models[0]}`
                        : null;
                      const selectedExplorationProviderAndModel = llmSettings.selected_exploration_provider_id && llmSettings.selected_exploration_models?.length
                        ? `${llmSettings.selected_exploration_provider_id}:${llmSettings.selected_exploration_models[0]}`
                        : null;
                      safeSetFieldsValue(llmForm, {
                        ...llmSettings,
                        selected_llm_provider_id: selectedProviderAndModel,
                        selected_embedding_provider_id: selectedEmbeddingProviderAndModel,
                        selected_exploration_provider_id: selectedExplorationProviderAndModel,
                        exploration_execution_mode: llmSettings.exploration_execution_mode || 'auto',
                        exploration_use_independent_provider: llmSettings.exploration_use_independent_provider || false,
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
                  { label: '大模型(Anthropic)', value: '大模型(Anthropic)' },
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
      </Space>
    </Spin>
  );
}
