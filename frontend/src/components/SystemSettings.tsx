import { useState, type ReactNode } from 'react';
import {
  ApiOutlined,
  BarChartOutlined,
  BellOutlined,
  ClearOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FieldTimeOutlined,
  LeftOutlined,
  LockOutlined,
  PictureOutlined,
  RightOutlined,
  RobotOutlined,
  ShareAltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

import { useAuth } from '@/contexts/AuthContext';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import SourceManagement from '@/components/SourceManagement';
import DataCleanup from '@/components/DataCleanup';
import CollectionHistory from '@/components/CollectionHistory';
import AccessAnalytics from '@/components/AccessAnalytics';
import {
  DatabaseSettingsTab,
  ImageSettingsTab,
  LLMSettingsTab,
  NotificationSettingsTab,
  PasswordSettingsTab,
  RAGSettingsTab,
  SocialMediaSettingsTab,
  SummarySettingsTab,
} from './settings';
import { SettingsNote } from './settings/SettingsKit';
import '@/styles/pages/settings.css';

interface SettingsSection {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  render: () => ReactNode;
}

interface SettingsGroup {
  label: string;
  sections: SettingsSection[];
}

const GROUPS: SettingsGroup[] = [
  {
    label: 'AI 能力',
    sections: [
      {
        key: 'llm',
        label: 'LLM 配置',
        description: '模型提供商、默认大模型 / 向量模型与自主探索模式',
        icon: <RobotOutlined />,
        render: () => <LLMSettingsTab />,
      },
      {
        key: 'image',
        label: '文生图配置',
        description: '图片生成提供商与默认模型',
        icon: <PictureOutlined />,
        render: () => <ImageSettingsTab />,
      },
      {
        key: 'rag-index',
        label: 'RAG 索引管理',
        description: '语义搜索向量索引的统计、同步与重建',
        icon: <CloudServerOutlined />,
        render: () => <RAGSettingsTab />,
      },
    ],
  },
  {
    label: '自动化',
    sections: [
      {
        key: 'summary',
        label: '自动总结',
        description: '每日 / 每周总结的开关与执行时间',
        icon: <FieldTimeOutlined />,
        render: () => <SummarySettingsTab />,
      },
      {
        key: 'notification',
        label: '通知配置',
        description: '飞书 / 钉钉机器人推送与勿扰时段',
        icon: <BellOutlined />,
        render: () => <NotificationSettingsTab />,
      },
      {
        key: 'social-media',
        label: '社交平台设置',
        description: '社交平台 API 密钥与 AI 小报定时任务',
        icon: <ShareAltOutlined />,
        render: () => <SocialMediaSettingsTab />,
      },
    ],
  },
  {
    label: '数据',
    sections: [
      {
        key: 'sources',
        label: '订阅管理',
        description: '管理 RSS / API / Web / 邮件订阅源',
        icon: <ApiOutlined />,
        render: () => <SourceManagement />,
      },
      {
        key: 'collection',
        label: '采集日志',
        description: '采集任务记录、手动采集与定时采集设置',
        icon: <UnorderedListOutlined />,
        render: () => <CollectionHistory />,
      },
      {
        key: 'cleanup',
        label: '数据维护',
        description: '清理历史数据、重跑 AI 分析',
        icon: <ClearOutlined />,
        render: () => <DataCleanup />,
      },
      {
        key: 'database',
        label: '数据库管理',
        description: '数据库备份下载与还原',
        icon: <DatabaseOutlined />,
        render: () => <DatabaseSettingsTab />,
      },
      {
        key: 'access-analytics',
        label: '访问统计',
        description: '站点访问量与来源统计',
        icon: <BarChartOutlined />,
        render: () => <AccessAnalytics />,
      },
    ],
  },
  {
    label: '账户',
    sections: [
      {
        key: 'password',
        label: '修改密码',
        description: '更新管理员登录密码',
        icon: <LockOutlined />,
        render: () => <PasswordSettingsTab />,
      },
    ],
  },
];

const SECTIONS = GROUPS.flatMap((group) => group.sections.map((section) => ({ ...section, group: group.label })));
const DEFAULT_KEY = 'llm';

export default function SystemSettings() {
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();
  const [activeKey, setActiveKey] = useState(DEFAULT_KEY);
  const [mobileDetail, setMobileDetail] = useState(false);
  // 与 Tabs 行为一致：访问过的分区保持挂载，切换时不丢失未保存的表单内容
  const [visited, setVisited] = useState<Set<string>>(() => new Set([DEFAULT_KEY]));

  const active = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0];
  const showContent = !isMobile || mobileDetail;

  const select = (key: string) => {
    setActiveKey(key);
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    if (isMobile) setMobileDetail(true);
  };

  const readonlyNote = !isAuthenticated && (
    <div style={{ marginBottom: 16 }}>
      <SettingsNote tone="warning">
        <strong>只读模式</strong>：当前未登录，只能查看配置，无法保存修改。请先登录后再进行系统设置。
      </SettingsNote>
    </div>
  );

  const sections = (
    <>
      {SECTIONS.filter((s) => visited.has(s.key)).map((section) => (
        <div
          key={section.key}
          className="settings__section"
          hidden={section.key !== active.key || !showContent}
          role="region"
          aria-label={section.label}
        >
          {section.render()}
        </div>
      ))}
    </>
  );

  if (isMobile) {
    return (
      <div className="settings settings--mobile">
        {mobileDetail ? (
          <div className="settings__detail-bar">
            <button
              type="button"
              className="icon-btn"
              aria-label="返回设置列表"
              onClick={() => setMobileDetail(false)}
            >
              <LeftOutlined />
            </button>
            <div className="settings__detail-title">
              <strong>{active.label}</strong>
              <span>{active.description}</span>
            </div>
          </div>
        ) : (
          <div className="settings-list">
            {readonlyNote}
            {GROUPS.map((group) => (
              <div key={group.label}>
                <div className="eyebrow settings-list__label">{group.label}</div>
                <div className="settings-list__items">
                  {group.sections.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      className="settings-list__item"
                      onClick={() => select(section.key)}
                    >
                      <span className="settings-list__icon">{section.icon}</span>
                      <span className="settings-list__text">
                        <span className="settings-list__title">{section.label}</span>
                        <span className="settings-list__desc">{section.description}</span>
                      </span>
                      <RightOutlined className="settings-list__chev" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="settings__main" hidden={!mobileDetail}>
          {readonlyNote}
          {sections}
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="设置分区">
        {GROUPS.map((group) => (
          <div key={group.label} className="settings__nav-group">
            <div className="eyebrow settings__nav-label">{group.label}</div>
            {group.sections.map((section) => {
              const isActive = section.key === active.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  className={`settings__nav-item${isActive ? ' settings__nav-item--active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => select(section.key)}
                >
                  <span className="settings__nav-icon">{section.icon}</span>
                  <span className="settings__nav-text">{section.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        {!isAuthenticated && (
          <div className="settings__nav-foot">
            <span className="dot dot--medium" />
            只读模式
          </div>
        )}
      </nav>

      <div className="settings__main">
        {readonlyNote}
        <header className="settings__head">
          <div className="eyebrow">{active.group}</div>
          <h2 className="settings__title">{active.label}</h2>
          <p className="settings__desc">{active.description}</p>
        </header>
        {sections}
      </div>
    </div>
  );
}
