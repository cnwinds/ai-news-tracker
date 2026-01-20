/**
 * 通知配置标签页组件
 */
import { useEffect } from 'react';
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
  TimePicker,
} from 'antd';
import { SaveOutlined, ReloadOutlined, PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { safeSetFieldsValue } from '@/utils/form';
import type { NotificationSettings } from '@/types';
import type { NotificationFormValues, ApiError } from './types';

export default function NotificationSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const [notificationForm] = Form.useForm();

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
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能保存通知配置');
      } else {
        message.error('保存通知配置失败');
      }
    },
  });

  useEffect(() => {
    if (notificationSettings && notificationForm) {
      const formValues = {
        ...notificationSettings,
        quiet_hours: (notificationSettings.quiet_hours || []).map((qh: { start_time?: string; end_time?: string }) => ({
          start_time: qh.start_time ? dayjs(qh.start_time, 'HH:mm') : null,
          end_time: qh.end_time ? dayjs(qh.end_time, 'HH:mm') : null,
        })),
      };
      safeSetFieldsValue(notificationForm, formValues);
    }
  }, [notificationSettings, notificationForm]);

  const handleNotificationSave = (values: NotificationFormValues) => {
    if (!values.platform || !values.webhook_url) {
      message.error('请填写必填字段');
      return;
    }
    const notificationData: NotificationSettings = {
      platform: values.platform,
      webhook_url: values.webhook_url,
      secret: values.secret || '',
      instant_notification_enabled: values.instant_notification_enabled ?? false,
      quiet_hours: values.quiet_hours?.map((qh) => ({
        start_time: qh.start_time ? qh.start_time.format('HH:mm') : '',
        end_time: qh.end_time ? qh.end_time.format('HH:mm') : '',
      })).filter((qh) => qh.start_time && qh.end_time) || [],
    };
    updateNotificationMutation.mutate(notificationData);
  };

  return (
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
                  if (notificationSettings) {
                    notificationForm.setFieldsValue(notificationSettings);
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
  );
}
