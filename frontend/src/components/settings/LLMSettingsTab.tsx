/**
 * LLM配置标签页组件
 */
import { useEffect, useState } from 'react';
import {
  Form,
  Input,
  Button,
  Spin,
  Select,
  Switch,
  Table,
  Modal,
  Popconfirm,
  Tooltip,
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { safeSetFieldsValue } from '@/utils/form';
import type { LLMSettings, LLMProvider, LLMProviderCreate, LLMProviderUpdate } from '@/types';
import type { LLMFormValues } from './types';
import {
  ModelChips,
  SettingsPanel,
  SettingsSaveBar,
  SettingsSubhead,
  StatusDot,
  useSettingsFormLayout,
} from './SettingsKit';

const toProviderAndModel = (
  providerId?: number | null,
  models?: string[] | null,
): string | null => (
  providerId && models?.length ? `${providerId}:${models[0]}` : null
);

const parseProviderAndModel = (
  value?: string | null,
): { providerId: number | null; models: string[] } => {
  if (!value || typeof value !== 'string') {
    return { providerId: null, models: [] };
  }

  const [providerId, modelName] = value.split(':');
  if (!providerId || !modelName) {
    return { providerId: null, models: [] };
  }

  return {
    providerId: parseInt(providerId, 10),
    models: [modelName],
  };
};

const buildProviderOptions = (
  providers: LLMProvider[],
  modelField: 'llm_model' | 'embedding_model',
) => providers.flatMap((provider) => {
  const rawModels = provider[modelField];
  if (!rawModels) {
    return [];
  }

  return rawModels
    .split(',')
    .map(model => model.trim())
    .filter(Boolean)
    .map(model => ({
      label: `${provider.name}(${model})`,
      value: `${provider.id}:${model}`,
    }));
});

export default function LLMSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [llmForm] = Form.useForm();
  const [providerForm] = Form.useForm();
  const [providerModalVisible, setProviderModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  const formLayout = useSettingsFormLayout();

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
      safeSetFieldsValue(llmForm, {
        ...llmSettings,
        selected_llm_provider_id: toProviderAndModel(
          llmSettings.selected_llm_provider_id,
          llmSettings.selected_llm_models,
        ),
        selected_embedding_provider_id: toProviderAndModel(
          llmSettings.selected_embedding_provider_id,
          llmSettings.selected_embedding_models,
        ),
        selected_exploration_provider_id: toProviderAndModel(
          llmSettings.selected_exploration_provider_id,
          llmSettings.selected_exploration_models,
        ),
        selected_fallback_llm_provider_id: toProviderAndModel(
          llmSettings.selected_fallback_llm_provider_id,
          llmSettings.selected_fallback_llm_models,
        ),
        exploration_execution_mode: llmSettings.exploration_execution_mode || 'auto',
        exploration_use_independent_provider: llmSettings.exploration_use_independent_provider || false,
      });
    }
  }, [llmSettings, llmForm]);

  const handleLLMSave = (values: LLMFormValues) => {
    const { providerId: selected_llm_provider_id, models: selected_llm_models } = parseProviderAndModel(
      values.selected_llm_provider_id,
    );
    const { providerId: selected_embedding_provider_id, models: selected_embedding_models } = parseProviderAndModel(
      values.selected_embedding_provider_id,
    );
    const { providerId: selected_exploration_provider_id, models: selected_exploration_models } = parseProviderAndModel(
      values.selected_exploration_provider_id,
    );
    const { providerId: selected_fallback_llm_provider_id, models: selected_fallback_llm_models } = parseProviderAndModel(
      values.selected_fallback_llm_provider_id,
    );
    
    updateLLMMutation.mutate({
      selected_llm_provider_id,
      selected_embedding_provider_id,
      selected_llm_models,
      selected_embedding_models,
      exploration_execution_mode: values.exploration_execution_mode || 'auto',
      exploration_use_independent_provider: values.exploration_use_independent_provider || false,
      selected_exploration_provider_id,
      selected_exploration_models,
      selected_fallback_llm_provider_id,
      selected_fallback_llm_models,
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
  const llmProviderOptions = buildProviderOptions(enabledProviders, 'llm_model');
  const embeddingProviderOptions = buildProviderOptions(embeddingProviders, 'embedding_model');

  return (
    <Spin spinning={llmLoading || providersLoading}>
      <div className="settings-stack">
        {/* 提供商管理 */}
        <SettingsPanel
          title="提供商"
          description="可配置多个 AI 提供商，分别选择其大模型与向量模型；部分提供商可能只有大模型。"
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
          flush
        >
          <Table
            className="settings-table"
            size="small"
            dataSource={providers}
            rowKey="id"
            scroll={{ x: 560 }}
            columns={[
              {
                title: '名称',
                dataIndex: 'name',
                key: 'name',
                render: (name: string, record) => (
                  <>
                    <span className="settings-cell-title">{name}</span>
                    <span className="settings-cell-sub">{record.provider_type}</span>
                  </>
                ),
              },
              {
                title: '大模型',
                dataIndex: 'llm_model',
                key: 'llm_model',
                render: (text: string) => <ModelChips value={text} />,
              },
              {
                title: '向量模型',
                dataIndex: 'embedding_model',
                key: 'embedding_model',
                render: (text: string) => <ModelChips value={text} />,
              },
              {
                title: '状态',
                dataIndex: 'enabled',
                key: 'enabled',
                width: 88,
                render: (enabled: boolean) => (
                  <StatusDot tone={enabled ? 'ok' : 'off'}>{enabled ? '启用' : '停用'}</StatusDot>
                ),
              },
              {
                title: '',
                key: 'action',
                width: 84,
                align: 'right',
                render: (_, record) => (
                  <span className="settings-icon-actions">
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        size="small"
                        className="settings-icon-action"
                        aria-label="编辑"
                        icon={<EditOutlined />}
                        onClick={() => handleProviderEdit(record)}
                        disabled={!isAuthenticated}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定要删除此提供商吗？"
                      onConfirm={() => handleProviderDelete(record.id)}
                      okText="确定"
                      cancelText="取消"
                      disabled={!isAuthenticated}
                    >
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          size="small"
                          className="settings-icon-action settings-icon-action--danger"
                          aria-label="删除"
                          icon={<DeleteOutlined />}
                          disabled={!isAuthenticated}
                        />
                      </Tooltip>
                    </Popconfirm>
                  </span>
                ),
              },
            ]}
            pagination={false}
          />
        </SettingsPanel>

        {/* 提供商选择 */}
        <SettingsPanel
          title="默认模型"
          description="选择大模型与向量模型的提供商；至少选择一个提供商才能正常使用 AI 功能。"
        >
          <Form
            form={llmForm}
            {...formLayout}
            onFinish={handleLLMSave}
            initialValues={llmSettings}
          >
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
                options={llmProviderOptions}
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
                options={embeddingProviderOptions}
              />
            </Form.Item>

            <Form.Item
              name="selected_fallback_llm_provider_id"
              label="备用大模型（可选）"
              tooltip="主模型因安全策略拦截、503 或限流失败时，自动切换到此模型完成标题翻译与文章分析"
            >
              <Select
                placeholder="不配置备用模型"
                style={{ width: '100%' }}
                disabled={!isAuthenticated}
                allowClear
                options={llmProviderOptions}
              />
            </Form.Item>

            <SettingsSubhead>自主探索 Agent</SettingsSubhead>
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
                  options={llmProviderOptions}
                />
              </Form.Item>
            )}

            <SettingsSaveBar hint={isAuthenticated ? '修改后需保存才会生效' : '登录后可保存'}>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  if (llmSettings) {
                    safeSetFieldsValue(llmForm, {
                      ...llmSettings,
                      selected_llm_provider_id: toProviderAndModel(
                        llmSettings.selected_llm_provider_id,
                        llmSettings.selected_llm_models,
                      ),
                      selected_embedding_provider_id: toProviderAndModel(
                        llmSettings.selected_embedding_provider_id,
                        llmSettings.selected_embedding_models,
                      ),
                      selected_exploration_provider_id: toProviderAndModel(
                        llmSettings.selected_exploration_provider_id,
                        llmSettings.selected_exploration_models,
                      ),
                      selected_fallback_llm_provider_id: toProviderAndModel(
                        llmSettings.selected_fallback_llm_provider_id,
                        llmSettings.selected_fallback_llm_models,
                      ),
                      exploration_execution_mode: llmSettings.exploration_execution_mode || 'auto',
                      exploration_use_independent_provider: llmSettings.exploration_use_independent_provider || false,
                    });
                  }
                }}
              >
                重置
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={updateLLMMutation.isPending}
                disabled={!isAuthenticated}
              >
                保存配置
              </Button>
            </SettingsSaveBar>
          </Form>
        </SettingsPanel>

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
            className="settings-form"
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
      </div>
    </Spin>
  );
}
