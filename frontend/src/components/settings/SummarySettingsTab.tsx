/**
 * 自动总结配置标签页组件
 */
import { useEffect } from 'react';
import {
  Card,
  Form,
  Button,
  Space,
  Alert,
  Spin,
  Switch,
  TimePicker,
  Typography,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { safeSetFieldsValue } from '@/utils/form';
import type { SummarySettings } from '@/types';
import type { SummaryFormValues, ApiError } from './types';

export default function SummarySettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const [summaryForm] = Form.useForm();

  // 获取总结配置
  const { data: summarySettings, isLoading: summaryLoading } = useQuery({
    queryKey: ['summarySettings'],
    queryFn: () => apiService.getSummarySettings(),
  });

  // 更新总结配置
  const updateSummaryMutation = useMutation({
    mutationFn: (data: SummarySettings) => apiService.updateSummarySettings(data),
    onSuccess: () => {
      message.success('自动总结配置已保存');
      queryClient.invalidateQueries({ queryKey: ['summarySettings'] });
    },
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能保存自动总结配置');
      } else {
        message.error('保存自动总结配置失败');
      }
    },
  });

  useEffect(() => {
    if (summarySettings && summaryForm) {
      safeSetFieldsValue(summaryForm, {
        daily_summary_enabled: summarySettings.daily_summary_enabled,
        daily_summary_time: summarySettings.daily_summary_time ? dayjs(summarySettings.daily_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
        weekly_summary_enabled: summarySettings.weekly_summary_enabled,
        weekly_summary_time: summarySettings.weekly_summary_time ? dayjs(summarySettings.weekly_summary_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
      });
    }
  }, [summarySettings, summaryForm]);

  const handleSummarySave = (values: SummaryFormValues) => {
    const summaryData: SummarySettings = {
      daily_summary_enabled: values.daily_summary_enabled ?? true,
      daily_summary_time: values.daily_summary_time ? values.daily_summary_time.format('HH:mm') : '09:00',
      weekly_summary_enabled: values.weekly_summary_enabled ?? true,
      weekly_summary_time: values.weekly_summary_time ? values.weekly_summary_time.format('HH:mm') : '09:00',
    };
    updateSummaryMutation.mutate(summaryData);
  };

  return (
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
  );
}
