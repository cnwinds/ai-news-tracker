/**
 * 图片生成配置标签页组件
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
import type { ImageSettings, ImageProvider, ImageProviderCreate, ImageProviderUpdate } from '@/types';
import type { ImageFormValues } from './types';
import { ModelChips, SettingsPanel, SettingsSaveBar, StatusDot, useSettingsFormLayout } from './SettingsKit';

export default function ImageSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [imageForm] = Form.useForm();
  const [imageProviderForm] = Form.useForm();
  const [imageProviderModalVisible, setImageProviderModalVisible] = useState(false);
  const [editingImageProvider, setEditingImageProvider] = useState<ImageProvider | null>(null);
  const formLayout = useSettingsFormLayout();

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

  // 更新图片生成配置
  const updateImageMutation = useMutation({
    mutationFn: (data: ImageSettings) => apiService.updateImageSettings(data),
    onSuccess: () => {
      showSuccess('图片生成配置已保存');
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
    },
    onError: createErrorHandler({
      operationName: '保存图片生成配置',
      customMessages: {
        auth: '需要登录才能保存图片生成配置',
      },
    }),
  });

  // 创建图片生成提供商
  const createImageProviderMutation = useMutation({
    mutationFn: (data: ImageProviderCreate) => apiService.createImageProvider(data),
    onSuccess: () => {
      showSuccess('图片生成提供商创建成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      setImageProviderModalVisible(false);
      imageProviderForm.resetFields();
    },
    onError: createErrorHandler({
      operationName: '创建图片生成提供商',
      customMessages: {
        auth: '需要登录才能创建图片生成提供商',
      },
    }),
  });

  // 更新图片生成提供商
  const updateImageProviderMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ImageProviderUpdate }) => apiService.updateImageProvider(id, data),
    onSuccess: () => {
      showSuccess('图片生成提供商更新成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
      setImageProviderModalVisible(false);
      setEditingImageProvider(null);
      imageProviderForm.resetFields();
    },
    onError: createErrorHandler({
      operationName: '更新图片生成提供商',
      customMessages: {
        auth: '需要登录才能更新图片生成提供商',
      },
    }),
  });

  // 删除图片生成提供商
  const deleteImageProviderMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteImageProvider(id),
    onSuccess: () => {
      showSuccess('图片生成提供商删除成功');
      queryClient.invalidateQueries({ queryKey: ['image-providers'] });
      queryClient.invalidateQueries({ queryKey: ['image-settings'] });
    },
    onError: createErrorHandler({
      operationName: '删除图片生成提供商',
      customMessages: {
        auth: '需要登录才能删除图片生成提供商',
      },
    }),
  });

  useEffect(() => {
    if (imageSettings && imageForm) {
      const selectedProviderAndModel = imageSettings.selected_image_provider_id && imageSettings.selected_image_models?.length
        ? `${imageSettings.selected_image_provider_id}:${imageSettings.selected_image_models[0]}`
        : null;

      safeSetFieldsValue(imageForm, {
        ...imageSettings,
        selected_image_provider_id: selectedProviderAndModel,
      });
    }
  }, [imageSettings, imageForm]);

  const handleImageSave = (values: ImageFormValues) => {
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

  const enabledImageProviders = imageProviders.filter(p => p.enabled);

  return (
    <Spin spinning={imageLoading || imageProvidersLoading}>
      <div className="settings-stack">
        {/* 图片生成提供商管理 */}
        <SettingsPanel
          title="图片生成提供商"
          description="可配置多个图片生成提供商，并分别选择使用哪个提供商的模型。"
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
          flush
        >
          <Table
            className="settings-table"
            size="small"
            dataSource={imageProviders}
            rowKey="id"
            scroll={{ x: 480 }}
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
                title: '图片生成模型',
                dataIndex: 'image_model',
                key: 'image_model',
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
                        onClick={() => handleImageProviderEdit(record)}
                        disabled={!isAuthenticated}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="确定要删除此提供商吗？"
                      onConfirm={() => handleImageProviderDelete(record.id)}
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

        {/* 图片生成提供商选择 */}
        <SettingsPanel
          title="默认模型"
          description="选择要使用的图片生成提供商和模型；至少选择一个提供商才能使用文生图功能。"
        >
          <Form
            form={imageForm}
            {...formLayout}
            onFinish={handleImageSave}
            initialValues={imageSettings}
          >
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
                  return models.map(model => ({
                    label: `${p.name}(${model})`,
                    value: `${p.id}:${model}`,
                  }));
                })}
              />
            </Form.Item>

            <SettingsSaveBar hint={isAuthenticated ? '修改后需保存才会生效' : '登录后可保存'}>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  if (imageSettings) {
                    imageForm.setFieldsValue(imageSettings);
                  }
                }}
              >
                重置
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={updateImageMutation.isPending}
                disabled={!isAuthenticated}
              >
                保存配置
              </Button>
            </SettingsSaveBar>
          </Form>
        </SettingsPanel>

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
            className="settings-form"
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
      </div>
    </Spin>
  );
}
