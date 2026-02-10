/**
 * 设置组件类型定义
 */
import type { Dayjs } from 'dayjs';

/**
 * 表单值类型
 */
export interface QuietHourFormValue {
  start_time: Dayjs | null;
  end_time: Dayjs | null;
}

export interface LLMFormValues {
  selected_llm_provider_id: string | null;
  selected_embedding_provider_id: string | null;
  exploration_execution_mode?: 'auto' | 'agent' | 'deterministic';
  exploration_use_independent_provider?: boolean;
  selected_exploration_provider_id?: string | null;
}

export interface ImageFormValues {
  selected_image_provider_id: string | null;
}

export interface NotificationFormValues {
  platform?: 'feishu' | 'dingtalk';
  webhook_url?: string;
  secret?: string;
  instant_notification_enabled?: boolean;
  quiet_hours?: QuietHourFormValue[];
}

export interface SummaryFormValues {
  daily_summary_enabled?: boolean;
  daily_summary_time?: Dayjs;
  weekly_summary_enabled?: boolean;
  weekly_summary_time?: Dayjs;
}

export interface SocialMediaFormValues {
  youtube_api_key?: string;
  tiktok_api_key?: string;
  twitter_api_key?: string;
  reddit_client_id?: string;
  reddit_client_secret?: string;
  reddit_user_agent?: string;
  auto_report_enabled?: boolean;
  auto_report_time?: Dayjs;
}

export interface PasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * API错误类型
 */
export interface ApiError {
  status: number;
  message: string;
  data?: {
    detail?: string;
    message?: string;
  };
  response?: {
    data?: {
      detail?: string;
    };
  };
}
