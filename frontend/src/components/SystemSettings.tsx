/**
 * 系统配置组件
 */
import { useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  message,
  Space,
  Alert,
  Spin,
  Typography,
  Tabs,
  Select,
  Switch,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import CollectionHistory from '@/components/CollectionHistory';
import type { LLMSettings, NotificationSettings } from '@/types';

const { Title } = Typography;

export default function SystemSettings() {
  const queryClient = useQueryClient();
  const [llmForm] = Form.useForm();
  const [notificationForm] = Form.useForm();

  // 获取LLM配置
  const { data: llmSettings, isLoading: llmLoading } = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => apiService.getLLMSettings(),
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
      llmForm.setFieldsValue(llmSettings);
    }
  }, [llmSettings, llmForm]);

  useEffect(() => {
    if (notificationSettings) {
      notificationForm.setFieldsValue(notificationSettings);
    }
  }, [notificationSettings, notificationForm]);

  const handleLLMSave = (values: LLMSettings) => {
    updateLLMMutation.mutate(values);
  };

  const handleNotificationSave = (values: NotificationSettings) => {
    updateNotificationMutation.mutate(values);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    message.success('配置已刷新');
  };

  const tabItems = [
    {
      key: 'llm',
      label: 'LLM配置',
      children: (
        <Spin spinning={llmLoading}>
          <Card>
            <Form
              form={llmForm}
              layout="vertical"
              onFinish={handleLLMSave}
              initialValues={llmSettings}
            >
              <Alert
                message="LLM配置说明"
                description="配置OpenAI兼容的API接口，用于AI分析和向量嵌入生成。修改配置后需要重启应用才能生效。"
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
              />

              <Form.Item
                name="openai_api_key"
                label="API密钥"
                rules={[{ required: true, message: '请输入API密钥' }]}
                tooltip="OpenAI API密钥，用于身份验证"
              >
                <Input.Password
                  placeholder="sk-..."
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="openai_api_base"
                label="API基础URL"
                rules={[{ required: true, message: '请输入API基础URL' }]}
                tooltip="OpenAI兼容API的基础URL，如 https://api.openai.com/v1"
              >
                <Input
                  placeholder="https://api.openai.com/v1"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="openai_model"
                label="模型名称"
                rules={[{ required: true, message: '请输入模型名称' }]}
                tooltip="用于AI分析的模型名称，如 gpt-4-turbo-preview"
              >
                <Input
                  placeholder="gpt-4-turbo-preview"
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item
                name="openai_embedding_model"
                label="嵌入模型名称"
                rules={[{ required: true, message: '请输入嵌入模型名称' }]}
                tooltip="用于生成向量嵌入的模型名称，如 text-embedding-3-small"
              >
                <Input
                  placeholder="text-embedding-3-small"
                  style={{ width: '100%' }}
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
                tooltip="是否启用即时通知：当采集到高重要性文章时立即推送"
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
      <Card
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              ⚙️ 系统功能
            </Title>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              size="small"
            >
              刷新
            </Button>
          </Space>
        }
      >
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}
