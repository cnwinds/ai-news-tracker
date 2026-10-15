/**
 * 系统设置通用布局原语（样式见 styles/pages/settings.css）
 */
import type { ReactNode } from 'react';
import type { FormProps } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface SettingsPanelProps {
  title?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  /** 内容区不留内边距（表格、列表） */
  flush?: boolean;
  tone?: 'default' | 'danger';
  children?: ReactNode;
}

export function SettingsPanel({ title, description, extra, flush, tone = 'default', children }: SettingsPanelProps) {
  const hasHead = Boolean(title || description || extra);
  return (
    <section className={`panel settings-panel${tone === 'danger' ? ' settings-panel--danger' : ''}`}>
      {hasHead && (
        <header className="panel__head settings-panel__head">
          <div className="settings-panel__heading">
            {title && <h3 className="panel__title">{title}</h3>}
            {description && <p className="settings-panel__desc">{description}</p>}
          </div>
          {extra && <div className="settings-panel__extra">{extra}</div>}
        </header>
      )}
      <div className={`settings-panel__body${flush ? ' settings-panel__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

type NoteTone = 'info' | 'warning' | 'danger' | 'success';

const NOTE_ICONS: Record<NoteTone, ReactNode> = {
  info: <InfoCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  danger: <WarningOutlined />,
  success: <CheckCircleOutlined />,
};

export function SettingsNote({ tone = 'info', children }: { tone?: NoteTone; children: ReactNode }) {
  return (
    <div className={`settings-note settings-note--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="settings-note__icon">{NOTE_ICONS[tone]}</span>
      <div>{children}</div>
    </div>
  );
}

export function SettingsSaveBar({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-savebar">
      {hint && <span className="settings-savebar__hint">{hint}</span>}
      <div className="settings-savebar__actions">{children}</div>
    </div>
  );
}

export function SettingsSubhead({ children }: { children: ReactNode }) {
  return (
    <div className="settings-subhead">
      <span className="eyebrow">{children}</span>
    </div>
  );
}

interface SettingsActionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/** 左侧说明 + 右侧操作 的行 */
export function SettingsAction({ title, description, children }: SettingsActionProps) {
  return (
    <div className="settings-action">
      <div className="settings-action__text">
        <div className="settings-action__title">{title}</div>
        {description && <div className="settings-action__desc">{description}</div>}
      </div>
      <div className="settings-action__control">{children}</div>
    </div>
  );
}

export type StatusTone = 'ok' | 'error' | 'warn' | 'off' | 'live';

export function StatusDot({ tone, children }: { tone: StatusTone; children?: ReactNode }) {
  const dotClass = tone === 'live' ? 'dot dot--live' : `dot settings-dot--${tone}`;
  return (
    <span className="settings-status">
      <span className={dotClass} />
      {children}
    </span>
  );
}

/** 将逗号分隔的模型名渲染为紧凑标签 */
export function ModelChips({ value }: { value?: string | null }) {
  const models = (value || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) return <span className="settings-muted">—</span>;
  return (
    <div className="settings-models">
      {models.map((model) => (
        <span key={model} className="chip">{model}</span>
      ))}
    </div>
  );
}

/** 设置表单布局：桌面为「标签列 + 控件列」行式布局，手机为纵向 */
export function useSettingsFormLayout(): Pick<
  FormProps,
  'layout' | 'labelAlign' | 'labelCol' | 'wrapperCol' | 'colon' | 'labelWrap' | 'className'
> {
  const { isMobile } = useBreakpoint();
  if (isMobile) {
    return { layout: 'vertical', className: 'settings-form' };
  }
  return {
    layout: 'horizontal',
    labelAlign: 'left',
    labelCol: { flex: '188px' },
    wrapperCol: { flex: '1 1 0' },
    colon: false,
    labelWrap: true,
    className: 'settings-form settings-form--rows',
  };
}
