/**
 * 社交平台配置标签页组件
 */
import { useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Alert,
  Spin,
  Switch,
  TimePicker,
  Divider,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { safeSetFieldsValue } from '@/utils/form';
import type { SocialMediaSettings } from '@/types';
import type { SocialMediaFormValues, ApiError } from './types';

export default function SocialMediaSettingsTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const [socialMediaForm] = Form.useForm();

  // 获取社交平台配置
  const { data: socialMediaSettings, isLoading: socialMediaLoading } = useQuery({
    queryKey: ['social-media-settings'],
    queryFn: () => apiService.getSocialMediaSettings(),
  });

  // 更新社交平台配置
  const updateSocialMediaMutation = useMutation({
    mutationFn: (data: SocialMediaSettings) => apiService.updateSocialMediaSettings(data),
    onSuccess: () => {
      message.success('社交平台配置已保存');
      queryClient.invalidateQueries({ queryKey: ['social-media-settings'] });
    },
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能保存社交平台配置');
      } else {
        message.error('保存社交平台配置失败');
      }
    },
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
    const socialMediaData: SocialMediaSettings = {
      youtube_api_key: values.youtube_api_key || undefined,
      tiktok_api_key: values.tiktok_api_key || undefined,
      twitter_api_key: values.twitter_api_key || undefined,
      reddit_client_id: values.reddit_client_id || undefined,
      reddit_client_secret: values.reddit_client_secret || undefined,
      reddit_user_agent: values.reddit_user_agent || undefined,
      auto_report_enabled: values.auto_report_enabled || false,
      auto_report_time: values.auto_report_time ? dayjs(values.auto_report_time).format('HH:mm') : undefined,
    };
    updateSocialMediaMutation.mutate(socialMediaData);
  };

  return (
    <Spin spinning={socialMediaLoading}>
      <Card title="社交平台API密钥配置">
        <Alert
          message="配置说明"
          description="请在此配置各社交平台的API密钥。如果某个平台未配置密钥，在生成日报时会自动跳过该平台。"
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
        <Form
          form={socialMediaForm}
          layout="vertical"
          onFinish={handleSocialMediaSave}
        >
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

          <Divider orientation="left">Reddit API配置</Divider>

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

          <Divider orientation="left">定时任务配置</Divider>

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
              style={{ width: '100%' }}
              disabled={!isAuthenticated}
              placeholder="请选择生成时间"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={updateSocialMediaMutation.isPending}
              disabled={!isAuthenticated}
            >
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Spin>
  );
}
