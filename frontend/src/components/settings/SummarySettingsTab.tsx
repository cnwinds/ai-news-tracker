/**
 * 自动总结配置标签页组件
 */
import { useEffect } from 'react';
import {
  Form,
  Button,
  Spin,
  Switch,
  TimePicker,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { safeSetFieldsValue } from '@/utils/form';
import type { SummarySettings } from '@/types';
import type { SummaryFormValues } from './types';
import { SettingsPanel, SettingsSaveBar, SettingsSubhead, useSettingsFormLayout } from './SettingsKit';

export default function SummarySettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [summaryForm] = Form.useForm();
  const formLayout = useSettingsFormLayout();

  // 获取总结配置
  const { data: summarySettings, isLoading: summaryLoading } = useQuery({
    queryKey: ['summarySettings'],
    queryFn: () => apiService.getSummarySettings(),
  });

  // 更新总结配置
  const updateSummaryMutation = useMutation({
    mutationFn: (data: SummarySettings) => apiService.updateSummarySettings(data),
    onSuccess: () => {
      showSuccess('自动总结配置已保存');
      queryClient.invalidateQueries({ queryKey: ['summarySettings'] });
    },
    onError: createErrorHandler({
      operationName: '保存自动总结配置',
      customMessages: {
        auth: '需要登录才能保存自动总结配置',
      },
    }),
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
      <SettingsPanel
        title="总结计划"
        description="每日总结统计昨天的内容；每周总结在周六执行，统计上周的内容。"
      >
        <Form
          form={summaryForm}
          {...formLayout}
          onFinish={handleSummarySave}
          initialValues={{
            daily_summary_enabled: true,
            daily_summary_time: dayjs('09:00', 'HH:mm'),
            weekly_summary_enabled: true,
            weekly_summary_time: dayjs('09:00', 'HH:mm'),
          }}
        >
          <SettingsSubhead>每日总结</SettingsSubhead>
          <Form.Item
            name="daily_summary_enabled"
            label="启用每日总结"
            valuePropName="checked"
            extra="每天在指定时间自动生成（统计昨天的内容）"
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
                <Form.Item name="daily_summary_time" label="执行时间">
                  <TimePicker
                    format="HH:mm"
                    style={{ width: 180 }}
                    disabled={!enabled || !isAuthenticated}
                    placeholder="选择时间（默认09:00）"
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          <SettingsSubhead>每周总结</SettingsSubhead>
          <Form.Item
            name="weekly_summary_enabled"
            label="启用每周总结"
            valuePropName="checked"
            extra="每周六指定时间自动生成（统计上周的内容，周跨度：上周六、上周日、上周一到上周五）"
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
                <Form.Item name="weekly_summary_time" label="执行时间（周六执行）">
                  <TimePicker
                    format="HH:mm"
                    style={{ width: 180 }}
                    disabled={!enabled || !isAuthenticated}
                    placeholder="选择时间（默认09:00）"
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          <SettingsSaveBar hint={isAuthenticated ? '修改后需保存才会生效' : '登录后可保存'}>
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
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={updateSummaryMutation.isPending}
              disabled={!isAuthenticated}
            >
              保存配置
            </Button>
          </SettingsSaveBar>
        </Form>
      </SettingsPanel>
    </Spin>
  );
}
