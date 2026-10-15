/**
 * 社交平台配置标签页组件
 */
import { useEffect } from 'react';
import {
  Form,
  Input,
  Button,
  Spin,
  Switch,
  TimePicker,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { safeSetFieldsValue } from '@/utils/form';
import type { SocialMediaSettings } from '@/types';
import type { SocialMediaFormValues } from './types';
import { SettingsPanel, SettingsSaveBar, SettingsSubhead, useSettingsFormLayout } from './SettingsKit';

export default function SocialMediaSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [socialMediaForm] = Form.useForm();
  const formLayout = useSettingsFormLayout();

  // 获取社交平台配置
  const { data: socialMediaSettings, isLoading: socialMediaLoading } = useQuery({
    queryKey: ['social-media-settings'],
    queryFn: () => apiService.getSocialMediaSettings(),
  });

  // 更新社交平台配置
  const updateSocialMediaMutation = useMutation({
    mutationFn: (data: SocialMediaSettings) => apiService.updateSocialMediaSettings(data),
    onSuccess: () => {
      showSuccess('社交平台配置已保存');
      queryClient.invalidateQueries({ queryKey: ['social-media-settings'] });
    },
    onError: createErrorHandler({
      operationName: '保存社交平台配置',
      customMessages: {
        auth: '需要登录才能保存社交平台配置',
      },
    }),
  });

  useEffect(() => {
    if (socialMediaSettings && socialMediaForm) {
      safeSetFieldsValue(socialMediaForm, {
        youtube_api_key: socialMediaSettings.youtube_api_key || '',
        tiktok_api_key: socialMediaSettings.tiktok_api_key || '',
        twitter_api_key: socialMediaSettings.twitter_api_key || '',
        reddit_client_id: socialMediaSettings.reddit_client_id || '',
        reddit_client_secret: socialMediaSettings.reddit_client_secret || '',
        reddit_user_agent: socialMediaSettings.reddit_user_agent || '',
        auto_report_enabled: socialMediaSettings.auto_report_enabled || false,
        auto_report_time: socialMediaSettings.auto_report_time ? dayjs(socialMediaSettings.auto_report_time, 'HH:mm') : undefined,
      });
    }
  }, [socialMediaSettings, socialMediaForm]);

  const handleSocialMediaSave = (values: SocialMediaFormValues) => {
    // 对于字符串字段，如果值为空字符串，发送空字符串（表示清空该配置）
    // Ant Design Form会确保所有字段都存在，即使是空字符串
    const socialMediaData: SocialMediaSettings = {
      youtube_api_key: values.youtube_api_key ?? '',
      tiktok_api_key: values.tiktok_api_key ?? '',
      twitter_api_key: values.twitter_api_key ?? '',
      reddit_client_id: values.reddit_client_id ?? '',
      reddit_client_secret: values.reddit_client_secret ?? '',
      reddit_user_agent: values.reddit_user_agent ?? '',
      auto_report_enabled: values.auto_report_enabled || false,
      auto_report_time: values.auto_report_time ? dayjs(values.auto_report_time).format('HH:mm') : undefined,
    };
    updateSocialMediaMutation.mutate(socialMediaData);
  };

  return (
    <Spin spinning={socialMediaLoading}>
      <SettingsPanel
        title="平台 API 与定时任务"
        description="未配置密钥的平台在生成日报时会自动跳过。"
      >
        <Form
          form={socialMediaForm}
          {...formLayout}
          onFinish={handleSocialMediaSave}
        >
          <SettingsSubhead>API 密钥</SettingsSubhead>

          <Form.Item
            name="youtube_api_key"
            label="YouTube API密钥"
            tooltip="YouTube Data API v3的API密钥"
          >
            <Input.Password
              placeholder="请输入YouTube API密钥"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <Form.Item
            name="tiktok_api_key"
            label="TikTok API密钥"
            tooltip="TikTok API的API密钥（来自RapidAPI等）"
          >
            <Input.Password
              placeholder="请输入TikTok API密钥"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <Form.Item
            name="twitter_api_key"
            label="Twitter API密钥"
            tooltip="Twitter API的API密钥"
          >
            <Input.Password
              placeholder="请输入Twitter API密钥"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <SettingsSubhead>Reddit</SettingsSubhead>

          <Form.Item
            name="reddit_client_id"
            label="Reddit客户端ID"
            tooltip="Reddit OAuth应用的客户端ID"
          >
            <Input
              placeholder="请输入Reddit客户端ID"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <Form.Item
            name="reddit_client_secret"
            label="Reddit客户端密钥"
            tooltip="Reddit OAuth应用的客户端密钥"
          >
            <Input.Password
              placeholder="请输入Reddit客户端密钥"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <Form.Item
            name="reddit_user_agent"
            label="Reddit用户代理"
            tooltip="Reddit API请求的用户代理字符串，例如：my-app/0.1 by reddit_username"
          >
            <Input
              placeholder="请输入用户代理，例如：my-app/0.1 by reddit_username"
              disabled={!isAuthenticated}
            />
          </Form.Item>

          <SettingsSubhead>定时任务</SettingsSubhead>

          <Form.Item
            name="auto_report_enabled"
            label="启用定时生成AI小报"
            tooltip="每天在指定时间自动生成AI热点小报"
            valuePropName="checked"
          >
            <Switch disabled={!isAuthenticated} />
          </Form.Item>

          <Form.Item
            name="auto_report_time"
            label="生成时间"
            tooltip="每天生成AI小报的时间（格式：HH:MM，如09:00）"
          >
            <TimePicker
              format="HH:mm"
              style={{ width: 180 }}
              disabled={!isAuthenticated}
              placeholder="请选择生成时间"
            />
          </Form.Item>

          <SettingsSaveBar hint={isAuthenticated ? '修改后需保存才会生效' : '登录后可保存'}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={updateSocialMediaMutation.isPending}
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
