/**
 * 社交平台：AI 热点小报浏览（PC 分栏阅读，手机列表 + 全屏阅读）
 */
import { useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Form, Modal, Skeleton, Spin, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  FireOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { SocialMediaReport, SocialMediaReportRequest, SocialMediaReportGenerateFormValues } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Markdown } from '@/utils/markdown';
import '@/styles/pages/social.css';

type PlatformKey = 'youtube' | 'tiktok' | 'twitter' | 'reddit';

const PLATFORMS: {
  key: PlatformKey;
  label: string;
  short: string;
  countKey: 'youtube_count' | 'tiktok_count' | 'twitter_count' | 'reddit_count';
}[] = [
  { key: 'youtube', label: 'YouTube', short: 'YT', countKey: 'youtube_count' },
  { key: 'tiktok', label: 'TikTok', short: 'TT', countKey: 'tiktok_count' },
  { key: 'twitter', label: 'Twitter', short: 'X', countKey: 'twitter_count' },
  { key: 'reddit', label: 'Reddit', short: 'RD', countKey: 'reddit_count' },
];

function formatDate(report: SocialMediaReport) {
  return dayjs(report.report_date).format('YYYY-MM-DD');
}

function formatWeekday(report: SocialMediaReport) {
  return dayjs(report.report_date).locale('zh-cn').format('ddd');
}

function ReportRow({
  report,
  active,
  onSelect,
}: {
  report: SocialMediaReport;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`social-row${active ? ' social-row--active' : ''}`}
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
    >
      <span className="social-row__top">
        <span>
          <span className="social-row__date">{formatDate(report)}</span>
          <span className="social-row__weekday">{formatWeekday(report)}</span>
        </span>
        <span className="social-row__total">{report.total_count} 条</span>
      </span>
      <span className="social-row__counts">
        {PLATFORMS.map((p) => {
          const count = report[p.countKey] ?? 0;
          return (
            <span key={p.key} className={`social-count${count ? '' : ' social-count--zero'}`} title={p.label}>
              {p.short} <b>{count}</b>
            </span>
          );
        })}
      </span>
    </button>
  );
}

interface ReportReaderProps {
  report: SocialMediaReport;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onBack?: () => void;
}

function ReportReader({ report, canDelete, deleting, onDelete, onBack }: ReportReaderProps) {
  return (
    <article className="reader social-report">
      <div className="reader__bar">
        <div className="reader__bar-group">
          {onBack && (
            <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
              <ArrowLeftOutlined />
            </button>
          )}
          <span className="chip chip--outline mono">{formatDate(report)}</span>
        </div>
        <div className="reader__bar-group">
          {canDelete && (
            <Tooltip title="删除小报">
              <button
                type="button"
                className="icon-btn"
                onClick={onDelete}
                disabled={deleting}
                aria-label="删除小报"
              >
                <DeleteOutlined />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <header>
        <div className="reader__kicker">
          <span className="chip chip--accent">
            <FireOutlined /> AI 热点小报
          </span>
          {PLATFORMS.filter((p) => report[`${p.key}_enabled` as const]).map((p) => (
            <span key={p.key} className="chip">
              {p.label}
            </span>
          ))}
        </div>
        <h1 className="reader__title">
          {formatDate(report)} 热点小报
        </h1>
        <div className="reader__meta">
          <span className="reader__meta-item">{formatWeekday(report)}</span>
          <span className="reader__meta-item">
            共 <span className="mono">{report.total_count}</span> 条热点
          </span>
          {report.created_at && (
            <span className="reader__meta-item">
              生成于 <span className="mono">{dayjs(report.created_at).format('YYYY-MM-DD HH:mm')}</span>
            </span>
          )}
        </div>
      </header>

      <div className="social-stats">
        {PLATFORMS.map((p) => {
          const count = report[p.countKey] ?? 0;
          return (
            <div key={p.key} className={`social-stats__cell${count ? '' : ' social-stats__cell--off'}`}>
              <span className="social-stats__label">{p.label}</span>
              <span className="social-stats__value">{count}</span>
            </div>
          );
        })}
      </div>

      {report.report_content ? (
        <Markdown>{report.report_content}</Markdown>
      ) : (
        <p className="u-muted">小报内容为空</p>
      )}
    </article>
  );
}

export default function SocialMediaReport() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [modal, modalContextHolder] = Modal.useModal();
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();
  const { createErrorHandler, showSuccess } = useErrorHandler();

  const { data: reports, isLoading } = useQuery({
    queryKey: ['social-media-reports'],
    queryFn: () => apiService.getSocialMediaReports(50),
  });

  // 获取社交平台配置，检查哪些平台已配置
  const { data: socialMediaSettings } = useQuery({
    queryKey: ['social-media-settings'],
    queryFn: () => apiService.getSocialMediaSettings(),
  });

  const configured: Record<PlatformKey, boolean> = {
    youtube: !!socialMediaSettings?.youtube_api_key,
    tiktok: !!socialMediaSettings?.tiktok_api_key,
    twitter: !!socialMediaSettings?.twitter_api_key,
    reddit: !!socialMediaSettings?.reddit_client_id && !!socialMediaSettings?.reddit_client_secret,
  };
  const anyConfigured = Object.values(configured).some(Boolean);

  const generateMutation = useMutation({
    mutationFn: (data: SocialMediaReportRequest) =>
      apiService.generateSocialMediaReport(data),
    onSuccess: () => {
      showSuccess('AI热点小报生成成功');
      setGenerateModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['social-media-reports'] });
    },
    onError: createErrorHandler({
      operationName: '生成AI热点小报',
      customMessages: {
        auth: '需要登录才能生成AI热点小报',
      },
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSocialMediaReport(id),
    onSuccess: () => {
      showSuccess('AI热点小报已删除');
      queryClient.invalidateQueries({ queryKey: ['social-media-reports'] });
    },
    onError: createErrorHandler({
      operationName: '删除AI热点小报',
      customMessages: {
        auth: '需要登录才能删除AI热点小报',
      },
    }),
  });

  const handleDelete = (id: number) => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除这个AI热点小报吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteMutation.mutate(id, {
          onSuccess: () => {
            setSelectedId(null);
            setReaderOpen(false);
          },
        });
      },
    });
  };

  const handleGenerate = (values: SocialMediaReportGenerateFormValues) => {
    // 只启用已配置的平台
    const platforms = values.platforms || [];
    const requestData: SocialMediaReportRequest = {
      youtube_enabled: platforms.includes('youtube') && configured.youtube,
      tiktok_enabled: platforms.includes('tiktok') && configured.tiktok,
      twitter_enabled: platforms.includes('twitter') && configured.twitter,
      reddit_enabled: platforms.includes('reddit') && configured.reddit,
      // 不传递date，让后端使用当前日期（实时数据）
      date: undefined,
    };

    generateMutation.mutate(requestData);
  };

  const closeGenerate = () => {
    if (!generateMutation.isPending) {
      setGenerateModalVisible(false);
      form.resetFields();
    }
  };

  const selected = reports?.find((r) => r.id === selectedId) ?? (isMobile ? undefined : reports?.[0]);

  const platformStatus = (
    <div className="social-platforms" aria-label="平台配置状态">
      {PLATFORMS.map((p) => (
        <Tooltip key={p.key} title={configured[p.key] ? '已配置' : '未配置，请在系统设置中填写 API 密钥'}>
          <span className={`social-platform${configured[p.key] ? '' : ' social-platform--off'}`}>
            <span className={`dot${configured[p.key] ? ' dot--live' : ''}`} />
            {p.label}
          </span>
        </Tooltip>
      ))}
    </div>
  );

  const generateForm = (
    <div className="social-gen">
      <Spin spinning={generateMutation.isPending}>
        {generateMutation.isPending && (
          <Alert
            message="正在生成AI热点小报"
            description="正在从三大社交平台获取实时热点数据并生成报告，请耐心等待。生成完成后会自动刷新列表。"
            type="info"
            showIcon
          />
        )}
        {!anyConfigured && (
          <Alert
            message="未配置任何平台"
            description="请在系统设置中配置至少一个社交平台的API密钥。"
            type="warning"
            showIcon
          />
        )}
        <Form
          form={form}
          onFinish={handleGenerate}
          layout="vertical"
          initialValues={{
            platforms: PLATFORMS.filter((p) => configured[p.key]).map((p) => p.key),
          }}
        >
          <Form.Item
            name="platforms"
            label="选择平台"
            tooltip="只显示已配置的平台，未配置的平台会自动跳过"
          >
            <Checkbox.Group className="social-gen__options">
              {PLATFORMS.filter((p) => configured[p.key]).map((p) => (
                <div key={p.key} className="social-gen__option">
                  <Checkbox value={p.key}>{p.label}</Checkbox>
                </div>
              ))}
              {PLATFORMS.filter((p) => !configured[p.key]).map((p) => (
                <div key={p.key} className="social-gen__option social-gen__option--off">
                  <Checkbox disabled>
                    {p.label}
                    <span className="social-gen__option-hint">未配置</span>
                  </Checkbox>
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Spin>
    </div>
  );

  const emptyState = (
    <div className="social-empty">
      <div className="reader__empty-mark">
        <FireOutlined />
      </div>
      <span>暂无热点小报</span>
      {isAuthenticated && (
        <Button icon={<PlusOutlined />} onClick={() => setGenerateModalVisible(true)}>
          创建AI热点小报
        </Button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="m-social">
        {modalContextHolder}
        <div className="m-social__toolbar">
          <div className="m-social__toolbar-row">
            <span className="social-toolbar__count">
              {isLoading ? '加载中…' : (
                <>
                  <strong>{reports?.length ?? 0}</strong> 份小报
                </>
              )}
            </span>
            {isAuthenticated && (
              <Button size="small" icon={<PlusOutlined />} onClick={() => setGenerateModalVisible(true)}>
                新建
              </Button>
            )}
          </div>
          {platformStatus}
        </div>

        {isLoading ? (
          <div className="mobile-feed-loading"><Spin /></div>
        ) : !reports || reports.length === 0 ? (
          emptyState
        ) : (
          <div className="m-social__list">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                active={false}
                onSelect={() => {
                  setSelectedId(report.id);
                  setReaderOpen(true);
                }}
              />
            ))}
          </div>
        )}

        <Drawer
          open={readerOpen}
          onClose={() => setReaderOpen(false)}
          placement="right"
          width="100%"
          closable={false}
          className="m-reader"
          styles={{ header: { display: 'none' }, body: { padding: 0 } }}
          destroyOnHidden
        >
          {selected && (
            <ReportReader
              report={selected}
              canDelete={isAuthenticated}
              deleting={deleteMutation.isPending}
              onDelete={() => handleDelete(selected.id)}
              onBack={() => setReaderOpen(false)}
            />
          )}
        </Drawer>

        <Drawer
          title="创建AI热点小报"
          placement="bottom"
          height="auto"
          open={generateModalVisible}
          onClose={closeGenerate}
          closable={false}
          maskClosable={!generateMutation.isPending}
          className="m-sheet"
        >
          {generateForm}
          <Button
            type="primary"
            block
            size="large"
            className="social-gen__submit"
            loading={generateMutation.isPending}
            onClick={() => form.submit()}
          >
            {generateMutation.isPending ? '正在生成...' : '生成'}
          </Button>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="social">
      {modalContextHolder}
      <div className="social-toolbar">
        <div className="social-toolbar__left">
          <span className="social-toolbar__count">
            <strong>{reports?.length ?? 0}</strong> 份小报
          </span>
          {platformStatus}
        </div>
        {isAuthenticated && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setGenerateModalVisible(true)}>
            创建AI热点小报
          </Button>
        )}
      </div>

      <div className="panel social-split">
        <aside className="social-split__list" aria-label="小报列表">
          <div className="social-split__list-head">
            <span className="eyebrow">Reports</span>
            <span className="social-row__total">最近 50 份</span>
          </div>
          <div className="social-split__rows">
            {isLoading ? (
              <div style={{ padding: 12 }}>
                <Skeleton active title={false} paragraph={{ rows: 6 }} />
              </div>
            ) : !reports || reports.length === 0 ? (
              <div className="social-empty">暂无热点小报</div>
            ) : (
              reports.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  active={selected?.id === report.id}
                  onSelect={() => setSelectedId(report.id)}
                />
              ))
            )}
          </div>
        </aside>
        <section className="social-split__reader">
          {isLoading ? (
            <div className="reader" style={{ paddingTop: 32 }}>
              <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 10 }} />
            </div>
          ) : selected ? (
            <ReportReader
              key={selected.id}
              report={selected}
              canDelete={isAuthenticated}
              deleting={deleteMutation.isPending}
              onDelete={() => handleDelete(selected.id)}
            />
          ) : (
            <div className="reader__empty">{emptyState}</div>
          )}
        </section>
      </div>

      <Modal
        title="创建AI热点小报"
        open={generateModalVisible}
        onCancel={closeGenerate}
        onOk={() => form.submit()}
        confirmLoading={generateMutation.isPending}
        okText={generateMutation.isPending ? '正在生成...' : '生成'}
        cancelButtonProps={{ disabled: generateMutation.isPending }}
        width={520}
        closable={!generateMutation.isPending}
        maskClosable={!generateMutation.isPending}
      >
        {generateForm}
      </Modal>
    </div>
  );
}
