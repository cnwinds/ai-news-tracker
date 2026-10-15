/**
 * 订阅管理组件
 */
import { useState, useMemo } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Switch,
  InputNumber,
  Popconfirm,
  Checkbox,
  Tabs,
  Alert,
  Spin,
  Select,
  Row,
  Col,
  Table,
  Tooltip,
  Segmented,
  Empty,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { RSSSource, RSSSourceCreate, RSSSourceUpdate, SourceFormValues, DefaultSource, FixHistoryEntry } from '@/types';
import { groupSourcesByType, SOURCE_TYPE_LABELS, sourceTypeSupportsSubType, getSubTypeOptions } from '@/utils/source';
import { getDaysAgo, getDaysAgoText, formatDate } from '@/utils/date';
import { SettingsNote, SettingsPanel, StatusDot, type StatusTone } from '@/components/settings/SettingsKit';

const SOURCE_TYPES = ['rss', 'api', 'web', 'email'] as const;

/** 最后更新距今天数 → 状态色：7 天内正常，30 天内提醒，更久视为异常 */
function freshnessTone(daysAgo: number | null): StatusTone {
  if (daysAgo === null) return 'off';
  if (daysAgo > 30) return 'error';
  if (daysAgo > 7) return 'warn';
  return 'ok';
}

function SourceTags({ source }: { source: Pick<RSSSource, 'category' | 'tier' | 'sub_type'> }) {
  return (
    <>
      {source.category && <span className="chip">{source.category}</span>}
      {source.tier && <span className="chip">{source.tier}</span>}
      {source.sub_type && <span className="chip chip--accent">{source.sub_type}</span>}
    </>
  );
}

function SourceFreshness({ source }: { source: RSSSource }) {
  const daysAgo = getDaysAgo(source.latest_article_published_at);
  const lastUpdateText = source.latest_article_published_at
    ? formatDate(source.latest_article_published_at)
    : '暂无';
  return (
    <Tooltip title={`最后更新：${lastUpdateText}`}>
      <span className="source-fresh">
        <span className={`dot settings-dot--${freshnessTone(daysAgo)}`} />
        <span className="settings-num">{daysAgo !== null ? getDaysAgoText(daysAgo) : '暂无'}</span>
      </span>
    </Tooltip>
  );
}

export default function SourceManagement() {
  const { isAuthenticated } = useAuth();
  const { isMobile } = useBreakpoint();
  const message = useMessage();
  const { createErrorHandler, showSuccess } = useErrorHandler();
  const [modalVisible, setModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [fixHistoryModalVisible, setFixHistoryModalVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<RSSSource | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [fixingSourceId, setFixingSourceId] = useState<number | null>(null);
  const [activeType, setActiveType] = useState<string>('rss');
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  const { data: defaultSources, isLoading: loadingDefault } = useQuery({
    queryKey: ['default-sources'],
    queryFn: () => apiService.getDefaultSources(),
    enabled: importModalVisible,
  });

  const createMutation = useMutation({
    mutationFn: (data: RSSSourceCreate) => apiService.createSource(data),
    onSuccess: () => {
      showSuccess('订阅源创建成功');
      setModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: createErrorHandler({
      operationName: '创建订阅源',
      customMessages: {
        auth: '需要登录才能创建订阅源',
      },
    }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RSSSourceUpdate }) =>
      apiService.updateSource(id, data),
    onSuccess: () => {
      showSuccess('订阅源更新成功');
      setModalVisible(false);
      setEditingSource(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: createErrorHandler({
      operationName: '更新订阅源',
      customMessages: {
        auth: '需要登录才能更新订阅源',
      },
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSource(id),
    onSuccess: () => {
      showSuccess('订阅源已删除');
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: createErrorHandler({
      operationName: '删除订阅源',
      customMessages: {
        auth: '需要登录才能删除订阅源',
      },
    }),
  });

  const importMutation = useMutation({
    mutationFn: (sourceNames: string[]) => apiService.importDefaultSources(sourceNames),
    onSuccess: (data) => {
      showSuccess(
        `导入完成：成功 ${data.imported} 个，跳过 ${data.skipped} 个${data.errors ? `，错误 ${data.errors.length} 个` : ''}`
      );
      setImportModalVisible(false);
      setSelectedSources([]);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: createErrorHandler({
      operationName: '导入订阅源',
      customMessages: {
        auth: '需要登录才能导入订阅源',
      },
    }),
  });

  // fixParseMutation 可能在未来使用，暂时保留
  // @ts-expect-error - 暂时未使用，但保留以备将来使用
  const fixParseMutation = useMutation({
    mutationFn: (id: number) => apiService.fixSourceParse(id),
    onSuccess: () => {
      showSuccess('AI修复成功！新配置已自动更新');
      setFixingSourceId(null);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (error: unknown) => {
      createErrorHandler({
        operationName: '修复订阅源',
        customMessages: {
          auth: '需要登录才能修复订阅源',
        },
      })(error);
      setFixingSourceId(null);
    },
  });

  const { data: fixHistory } = useQuery({
    queryKey: ['fix-history', fixingSourceId],
    queryFn: () => apiService.getFixHistory(fixingSourceId!),
    enabled: fixHistoryModalVisible && fixingSourceId !== null,
  });

  const handleAdd = () => {
    setEditingSource(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (source: RSSSource) => {
    setEditingSource(source);
    const formValues: Partial<SourceFormValues> = { ...source };

    // 处理 extra_config 字段
    if (source.extra_config) {
      try {
        const extraConfig = typeof source.extra_config === 'string'
          ? JSON.parse(source.extra_config)
          : source.extra_config;

        // 如果是邮件源，将 extra_config 解析为对象用于动态表单
        if (source.source_type === 'email') {
          formValues.extra_config = extraConfig;
          // 设置URL为邮箱地址（从email://xxx格式中提取）
          if (source.url.startsWith('email://')) {
            formValues.url = source.url.replace('email://', '');
          }
          // 将数组转换为逗号分隔的字符串（用于表单显示）
          if (extraConfig.email_filter) {
            // 兼容处理：统一使用 condition 显示
            if (extraConfig.email_filter.condition) {
              // 已是condition格式，直接使用
            } else if (extraConfig.email_filter.regex) {
              extraConfig.email_filter.condition = extraConfig.email_filter.regex;
            } else if (extraConfig.email_filter.keywords) {
              if (Array.isArray(extraConfig.email_filter.keywords)) {
                extraConfig.email_filter.condition = extraConfig.email_filter.keywords.join(', ');
              } else if (typeof extraConfig.email_filter.keywords === 'string') {
                extraConfig.email_filter.condition = extraConfig.email_filter.keywords;
              }
            }
          }
          // 兼容旧的 title_filter 字段名
          if (extraConfig.title_filter && !extraConfig.email_filter) {
            extraConfig.email_filter = extraConfig.title_filter;
          }
          // 兼容旧的内容提取配置
          if (extraConfig.content_extraction) {
            // 如果没有设置 parser_type，设置为 original
            if (!extraConfig.content_extraction.parser_type) {
              extraConfig.content_extraction.parser_type = 'original';
            }

            // 兼容旧的 from_html 和 from_plain，转换为 extract_mode
            const fromPlain = extraConfig.content_extraction.from_plain !== undefined ? extraConfig.content_extraction.from_plain : true;
            const fromHtml = extraConfig.content_extraction.from_html !== undefined ? extraConfig.content_extraction.from_html : false;

            // 如果没有 extract_mode，根据 from_plain 和 from_html 推断
            if (!extraConfig.content_extraction.extract_mode && extraConfig.content_extraction.parser_type === 'tldr') {
              if (fromPlain && fromHtml) {
                extraConfig.content_extraction.extract_mode = 'plain_preferred';
              } else if (fromPlain && !fromHtml) {
                extraConfig.content_extraction.extract_mode = 'plain_only';
              } else if (!fromPlain && fromHtml) {
                extraConfig.content_extraction.extract_mode = 'html_only';
              } else {
                extraConfig.content_extraction.extract_mode = 'plain_preferred';
              }
            }
          }
        } else {
          // 对于其他源类型（API、Web等），将 extra_config 格式化为格式化的 JSON 字符串显示在文本框中
          formValues.extra_config = JSON.stringify(extraConfig, null, 2);
        }
      } catch (e) {
        console.error('解析extra_config失败:', e);
        // 如果解析失败，对于非邮件源，直接使用原始字符串
        if (source.source_type !== 'email') {
          formValues.extra_config = source.extra_config;
        }
      }
    }

    form.setFieldsValue(formValues);
    setModalVisible(true);
  };

  const handleSubmit = (values: SourceFormValues) => {
    const submitData: RSSSourceCreate = {
      name: values.name,
      url: values.url,
      description: values.description,
      category: values.category,
      tier: values.tier,
      source_type: values.source_type,
      sub_type: sourceTypeSupportsSubType(values.source_type) ? values.sub_type : undefined,
      language: values.language,
      enabled: values.enabled,
      priority: values.priority,
      note: values.note,
      analysis_prompt: values.analysis_prompt,
    };

    // 如果是邮件源，需要将表单字段转换为extra_config JSON
    if (values.source_type === 'email') {
      const emailConfig: Record<string, unknown> = {};

      // 邮件服务器配置
      if (values.extra_config && typeof values.extra_config === 'object') {
        const extraConfig = values.extra_config as Record<string, unknown>;
        emailConfig.protocol = extraConfig.protocol || 'imap';
        emailConfig.server = extraConfig.server;
        emailConfig.port = extraConfig.port || 993;
        emailConfig.use_ssl = extraConfig.use_ssl !== false;
        emailConfig.username = extraConfig.username || values.url;
        emailConfig.password = extraConfig.password;
        emailConfig.folder = extraConfig.folder || 'INBOX';
        emailConfig.max_emails = extraConfig.max_emails || 50;

        // 邮件过滤配置
        if (extraConfig.email_filter && typeof extraConfig.email_filter === 'object') {
          const emailFilter = extraConfig.email_filter as { condition?: string; type?: string };
          const condition = emailFilter.condition;

          if (!condition || (typeof condition === 'string' && condition.trim() === '')) {
            // 如果没有设置过滤条件，不添加email_filter配置
          } else {
            emailConfig.email_filter = {
              type: emailFilter.type || 'sender',
              keywords: condition.trim(),  // 统一使用keywords字段，后端会自动识别
            };
          }
        }

        // 内容提取配置
        if (extraConfig.content_extraction && typeof extraConfig.content_extraction === 'object') {
          const contentExtraction = extraConfig.content_extraction as {
            parser_type?: string;
            extract_mode?: string;
          };
          const parserType = contentExtraction.parser_type || 'original';
          const extractMode = contentExtraction.extract_mode || 'plain_preferred';

          // 根据解析器类型设置配置
          const contentExtractionConfig: Record<string, unknown> = {
            parser_type: parserType,
          };

          // 只有TLDR解析器才需要设置extract_mode
          if (parserType === 'tldr') {
            switch (extractMode) {
              case 'plain_preferred':
                contentExtractionConfig.from_plain = true;
                contentExtractionConfig.from_html = true;
                break;
              case 'html_preferred':
                contentExtractionConfig.from_plain = true;
                contentExtractionConfig.from_html = true;
                break;
              case 'plain_only':
                contentExtractionConfig.from_plain = true;
                contentExtractionConfig.from_html = false;
                break;
              case 'html_only':
                contentExtractionConfig.from_plain = false;
                contentExtractionConfig.from_html = true;
                break;
              default:
                contentExtractionConfig.from_html = false;
                contentExtractionConfig.from_plain = true;
            }
          } else {
            // 原始模式不需要这些字段
            contentExtractionConfig.from_html = false;
            contentExtractionConfig.from_plain = true;
          }
          emailConfig.content_extraction = contentExtractionConfig;
        }
      }

      // 设置URL为email://格式
      submitData.url = `email://${values.url}`;
      submitData.extra_config = JSON.stringify(emailConfig);
    } else {
      // 其他源类型（API、Web等）处理 extra_config
      if (values.extra_config) {
        if (typeof values.extra_config === 'string') {
          // 如果是字符串，尝试解析并重新序列化（确保格式正确）
          try {
            const parsed = JSON.parse(values.extra_config);
            submitData.extra_config = JSON.stringify(parsed, null, 0); // 紧凑格式存储
          } catch (e) {
            // 如果解析失败，可能是无效的JSON，直接使用原始字符串
            submitData.extra_config = values.extra_config.trim();
          }
        } else if (typeof values.extra_config === 'object') {
          // 如果是对象，转换为JSON字符串
          submitData.extra_config = JSON.stringify(values.extra_config, null, 0);
        } else {
          submitData.extra_config = '';
        }
      } else {
        submitData.extra_config = '';
      }
    }

    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleImport = () => {
    if (selectedSources.length === 0) {
      message.warning('请至少选择一个要导入的源');
      return;
    }
    importMutation.mutate(selectedSources);
  };

  // 这些函数可能在未来使用，暂时保留但标记为未使用
  // const handleFixParse = (sourceId: number) => {
  //   setFixingSourceId(sourceId);
  //   fixParseMutation.mutate(sourceId);
  // };

  // const handleViewFixHistory = (sourceId: number) => {
  //   setFixingSourceId(sourceId);
  //   setFixHistoryModalVisible(true);
  // };

  // 订阅源排序函数
  const sortSources = (sources: RSSSource[]): RSSSource[] => {
    return [...sources].sort((a, b) => {
      // 1. 首先按启用状态排序：启用的排在前面
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }

      // 2. 然后按最后更新时间排序：时间近的排在前面
      const aTime = a.latest_article_published_at
        ? new Date(a.latest_article_published_at).getTime()
        : 0;
      const bTime = b.latest_article_published_at
        ? new Date(b.latest_article_published_at).getTime()
        : 0;

      // 时间大的（更近的）排在前面
      return bTime - aTime;
    });
  };

  // 按类型分组默认源
  const groupedDefaultSources = useMemo(() => {
    if (!defaultSources) return {};
    const grouped = groupSourcesByType(defaultSources);
    return grouped;
  }, [defaultSources]);

  // 按类型分组现有源并排序
  const groupedSources = useMemo(() => {
    if (!sources) return {};
    const grouped = groupSourcesByType(sources);

    // 对每个类型的源进行排序
    Object.keys(grouped).forEach((type) => {
      grouped[type] = sortSources(grouped[type]);
    });

    return grouped;
  }, [sources]);

  // 检查源是否已存在
  const isSourceExists = (sourceName: string, sourceUrl: string) => {
    return sources?.some(
      (s) => s.name === sourceName || s.url === sourceUrl
    ) || false;
  };

  const visibleSources = useMemo(() => {
    const list = groupedSources[activeType] || [];
    const q = keyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.name, s.url, s.description, s.category]
        .some((field) => field?.toLowerCase().includes(q))
    );
  }, [groupedSources, activeType, keyword]);

  const renderActions = (source: RSSSource) => (
    <span className="settings-icon-actions">
      <Tooltip title="编辑">
        <Button
          type="text"
          size="small"
          className="settings-icon-action"
          aria-label={`编辑 ${source.name}`}
          icon={<EditOutlined />}
          onClick={() => handleEdit(source)}
          disabled={!isAuthenticated}
        />
      </Tooltip>
      <Popconfirm
        title="确定要删除这个订阅源吗？"
        onConfirm={() => deleteMutation.mutate(source.id)}
        okText="确定"
        cancelText="取消"
        disabled={!isAuthenticated}
      >
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            className="settings-icon-action settings-icon-action--danger"
            aria-label={`删除 ${source.name}`}
            icon={<DeleteOutlined />}
            disabled={!isAuthenticated}
          />
        </Tooltip>
      </Popconfirm>
    </span>
  );

  const renderEnabled = (enabled: boolean) => (
    <StatusDot tone={enabled ? 'ok' : 'off'}>{enabled ? '启用' : '禁用'}</StatusDot>
  );

  const typeLabel = SOURCE_TYPE_LABELS[activeType] || activeType;
  const emptyText = keyword ? '没有匹配的订阅源' : `暂无${typeLabel}`;

  const sourceTable = (
    <Table<RSSSource>
      className="settings-table"
      size="small"
      rowKey="id"
      dataSource={visibleSources}
      pagination={false}
      tableLayout="fixed"
      rowClassName={(record) => (record.enabled ? '' : 'source-row--disabled')}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} /> }}
      columns={[
        {
          title: '订阅源',
          key: 'name',
          render: (_, source) => (
            <div title={source.description || undefined} style={{ minWidth: 0 }}>
              <div className="settings-row__title">
                <span className="settings-cell-title">{source.name}</span>
                <SourceTags source={source} />
              </div>
              <span className="settings-cell-sub settings-num">{source.url}</span>
            </div>
          ),
        },
        {
          title: '状态',
          dataIndex: 'enabled',
          key: 'enabled',
          width: 76,
          render: renderEnabled,
        },
        {
          title: '文章',
          dataIndex: 'articles_count',
          key: 'articles_count',
          width: 64,
          align: 'right',
          render: (count?: number) => <span className="settings-num">{count ?? '—'}</span>,
        },
        {
          title: '最后更新',
          key: 'latest',
          width: 96,
          render: (_, source) => <SourceFreshness source={source} />,
        },
        {
          title: '',
          key: 'action',
          width: 72,
          align: 'right',
          render: (_, source) => renderActions(source),
        },
      ]}
    />
  );

  const sourceMobileList = visibleSources.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ padding: '24px 0' }} />
  ) : (
    <div className="source-mlist">
      {visibleSources.map((source) => (
        <div key={source.id} className={`source-mitem${source.enabled ? '' : ' source-row--disabled'}`}>
          <div className="source-mitem__body">
            <div className="settings-row__title">
              <span className="settings-cell-title">{source.name}</span>
            </div>
            <span className="settings-cell-sub settings-num">{source.url}</span>
            <div className="source-mitem__meta">
              {renderEnabled(source.enabled)}
              <span><span className="settings-num">{source.articles_count ?? '—'}</span> 篇</span>
              <SourceFreshness source={source} />
              <SourceTags source={source} />
            </div>
          </div>
          {renderActions(source)}
        </div>
      ))}
    </div>
  );

  const renderImportList = (list: DefaultSource[] | undefined) => (
    <div className="import-list">
      {(list || []).map((source) => {
        const exists = isSourceExists(source.name, source.url);
        return (
          <div key={source.name} className={`import-item${exists ? ' import-item--disabled' : ''}`}>
            <Checkbox
              checked={selectedSources.includes(source.name)}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedSources([...selectedSources, source.name]);
                } else {
                  setSelectedSources(selectedSources.filter((n) => n !== source.name));
                }
              }}
              disabled={exists}
            />
            <div className="import-item__body">
              <div className="import-item__title">
                <span>{source.name}</span>
                {exists && <span className="chip chip--warning">已存在</span>}
                {source.category && <span className="chip">{source.category}</span>}
                {source.tier && <span className="chip">{source.tier}</span>}
                {!source.enabled && <span className="chip chip--danger">禁用</span>}
              </div>
              <div className="import-item__url">{source.url}</div>
            </div>
          </div>
        );
      })}
      {(!list || list.length === 0) && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" style={{ padding: '16px 0' }} />
      )}
    </div>
  );

  return (
    <div>
      <SettingsPanel
        title="订阅源"
        description={sources ? `共 ${sources.length} 个订阅源，启用 ${sources.filter((s) => s.enabled).length} 个` : undefined}
        flush
        extra={
          <>
            <Button
              icon={<ImportOutlined />}
              onClick={() => setImportModalVisible(true)}
              disabled={!isAuthenticated}
            >
              导入默认源
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              disabled={!isAuthenticated}
            >
              添加订阅源
            </Button>
          </>
        }
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : !sources || sources.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无订阅源，点击上方按钮添加或导入订阅源"
            style={{ padding: '32px 0' }}
          />
        ) : (
          <>
            <div className="settings-toolbar">
              <Segmented
                value={activeType}
                onChange={(value) => setActiveType(String(value))}
                options={SOURCE_TYPES.map((type) => ({
                  value: type,
                  label: (
                    <span>
                      {SOURCE_TYPE_LABELS[type]}{' '}
                      <span className="settings-num settings-muted">{groupedSources[type]?.length || 0}</span>
                    </span>
                  ),
                }))}
              />
              <div className="settings-toolbar__grow">
                <Input
                  allowClear
                  prefix={<SearchOutlined className="settings-muted" />}
                  placeholder="筛选名称 / URL / 分类"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
            </div>
            {isMobile ? sourceMobileList : sourceTable}
          </>
        )}
      </SettingsPanel>

      <Modal
        title={editingSource ? '编辑订阅源' : '添加订阅源'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingSource(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={1000}
        style={{ top: 20 }}
      >
        <Form form={form} onFinish={handleSubmit} layout="vertical" className="settings-form">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="source_type" label="源类型" rules={[{ required: true }]} initialValue="rss">
                <Select
                  onChange={() => {
                    // 切换源类型时，清空子类型字段
                    form.setFieldsValue({ sub_type: undefined });
                  }}
                >
                  <Select.Option value="rss">RSS源</Select.Option>
                  <Select.Option value="api">API源</Select.Option>
                  <Select.Option value="web">Web源</Select.Option>
                  <Select.Option value="email">邮件源</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* 子类型选择（仅当源类型支持时显示） */}
          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.source_type !== currentValues.source_type}>
            {({ getFieldValue }) => {
              const sourceType = getFieldValue('source_type');

              if (!sourceTypeSupportsSubType(sourceType)) {
                return null;
              }

              const subTypeOptions = getSubTypeOptions(sourceType);
              const subTypeLabel = 'API子类型';

              return (
                <Form.Item
                  name="sub_type"
                  label={subTypeLabel}
                  rules={[{ required: true, message: `请选择${subTypeLabel}` }]}
                >
                  <Select placeholder={`请选择${subTypeLabel}`}>
                    {subTypeOptions.map(option => (
                      <Select.Option key={option.value} value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.source_type !== currentValues.source_type}>
            {({ getFieldValue }) => {
              const sourceType = getFieldValue('source_type');

              // 邮件源专用配置
              if (sourceType === 'email') {
                return (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="url" label="邮箱地址" rules={[{ required: true, type: 'email' }]}>
                          <Input placeholder="your_email@163.com" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name={['extra_config', 'folder']} label="文件夹" initialValue="INBOX" tooltip="IMAP协议使用">
                          <Input placeholder="INBOX" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} md={6}>
                        <Form.Item name={['extra_config', 'protocol']} label="协议" initialValue="imap">
                          <Select>
                            <Select.Option value="imap">IMAP</Select.Option>
                            <Select.Option value="pop3">POP3</Select.Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={10}>
                        <Form.Item name={['extra_config', 'server']} label="服务器" rules={[{ required: true }]}>
                          <Input placeholder="imap.163.com" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={4}>
                        <Form.Item name={['extra_config', 'port']} label="端口" initialValue={993}>
                          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={4}>
                        <Form.Item name={['extra_config', 'use_ssl']} label="SSL" valuePropName="checked" initialValue={true}>
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name={['extra_config', 'username']} label="用户名" rules={[{ required: true }]}>
                          <Input placeholder="通常为邮箱地址" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name={['extra_config', 'password']} label="密码/授权码" rules={[{ required: true }]}>
                          <Input.Password placeholder="邮箱密码或授权码" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item label="邮件过滤">
                      <Row gutter={16}>
                        <Col xs={24} md={8}>
                          <Form.Item name={['extra_config', 'email_filter', 'type']} label="过滤类型" initialValue="sender">
                            <Select>
                              <Select.Option value="sender">发件人</Select.Option>
                              <Select.Option value="title">标题</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={16}>
                          <Form.Item
                            name={['extra_config', 'email_filter', 'condition']}
                            label="过滤条件"
                            tooltip="自动识别关键字或正则表达式。关键字示例: TLDR AI, AI News（逗号分隔）；正则示例: .*AI.*News.*"
                            rules={[{ required: true, message: '请输入过滤条件' }]}
                          >
                            <Input placeholder="TLDR AI, AI News 或 .*AI.*News.*" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Form.Item>
                    <Form.Item label="内容提取">
                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name={['extra_config', 'content_extraction', 'parser_type']}
                            label="解析器类型"
                            initialValue="original"
                            tooltip="选择如何从邮件中提取文章内容"
                          >
                            <Select>
                              <Select.Option value="original">原始邮件(整封邮件作为一篇文章)</Select.Option>
                              <Select.Option value="tldr">TLDR解析器(从邮件中提取多篇文章)</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                          <Form.Item name={['extra_config', 'max_emails']} label="最大邮件数" initialValue={50}>
                            <InputNumber min={1} max={200} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                          <Form.Item
                            name={['extra_config', 'content_extraction', 'extract_mode']}
                            label="提取模式"
                            initialValue="plain_preferred"
                            dependencies={[['extra_config', 'content_extraction', 'parser_type']]}
                            tooltip="仅TLDR解析器可用"
                          >
                            <Select disabled={form.getFieldValue(['extra_config', 'content_extraction', 'parser_type']) !== 'tldr'}>
                              <Select.Option value="plain_preferred">优先纯文本</Select.Option>
                              <Select.Option value="html_preferred">优先HTML</Select.Option>
                              <Select.Option value="plain_only">仅纯文本</Select.Option>
                              <Select.Option value="html_only">仅HTML</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>
                    </Form.Item>
                  </>
                );
              }

              // 其他源类型使用URL字段
              return (
                <Form.Item name="url" label="URL" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="description" label="描述">
                <Input.TextArea placeholder="订阅源的说明信息" rows={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="category" label="分类">
                <Input placeholder="例如: news, official_blog, academic" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.source_type !== currentValues.source_type}>
            {({ getFieldValue }) => {
              const sourceType = getFieldValue('source_type');
              if (sourceType === 'email') {
                return null; // 邮件源使用动态表单，不需要extra_config JSON字段
              }
              return (
                <Form.Item name="extra_config" label="扩展配置（JSON）">
                  <Input.TextArea
                    className="settings-num"
                    placeholder="扩展配置（JSON格式）。API源示例: {&quot;query&quot;: &quot;cat:cs.AI&quot;, &quot;max_results&quot;: 20}；Web源示例: {&quot;article_selector&quot;: &quot;article.entry-card&quot;, &quot;title_selector&quot;: &quot;h2.entry-title a&quot;}"
                    rows={4}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" initialValue={1}>
                <InputNumber min={1} max={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 导入默认源对话框 */}
      <Modal
        title="导入默认数据源"
        open={importModalVisible}
        onCancel={() => {
          setImportModalVisible(false);
          setSelectedSources([]);
        }}
        onOk={handleImport}
        confirmLoading={importMutation.isPending}
        width={800}
        okText="导入选中"
        cancelText="取消"
      >
        {loadingDefault ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        ) : !defaultSources || defaultSources.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可用的默认数据源" />
        ) : (
          <div>
            <SettingsNote>选择要导入的数据源，已存在的源将被跳过。</SettingsNote>
            <div className="import-head">
              <Checkbox
                checked={selectedSources.length === defaultSources.length}
                indeterminate={
                  selectedSources.length > 0 && selectedSources.length < defaultSources.length
                }
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedSources(defaultSources.map((s: DefaultSource) => s.name));
                  } else {
                    setSelectedSources([]);
                  }
                }}
              >
                全选
              </Checkbox>
              <span className="settings-num settings-muted">
                {selectedSources.length}/{defaultSources.length}
              </span>
            </div>
            <Tabs
              size="small"
              items={SOURCE_TYPES.map((type) => ({
                key: type,
                label: `${SOURCE_TYPE_LABELS[type]} (${groupedDefaultSources[type]?.length || 0})`,
                children: renderImportList(groupedDefaultSources[type]),
              }))}
            />
          </div>
        )}
      </Modal>

      {/* 修复历史查看对话框 */}
      <Modal
        title="解析修复历史"
        open={fixHistoryModalVisible}
        onCancel={() => {
          setFixHistoryModalVisible(false);
          setFixingSourceId(null);
        }}
        footer={[
          <Button key="close" onClick={() => {
            setFixHistoryModalVisible(false);
            setFixingSourceId(null);
          }}>
            关闭
          </Button>,
        ]}
        width={800}
      >
        {fixHistory ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <SettingsNote>源名称: {fixHistory.source_name}</SettingsNote>
            </div>
            {fixHistory.fix_history && fixHistory.fix_history.length > 0 ? (
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {fixHistory.fix_history.map((entry: FixHistoryEntry, index: number) => (
                  <div key={index} className="settings-history-item">
                    <div className="settings-history-item__head">
                      <span className="settings-num">{new Date(entry.timestamp).toLocaleString('zh-CN')}</span>
                      <StatusDot tone={entry.success ? 'ok' : 'error'}>{entry.success ? '成功' : '失败'}</StatusDot>
                    </div>
                    {entry.error_message && (
                      <Alert
                        message="错误信息"
                        description={entry.error_message}
                        type="error"
                        style={{ marginBottom: 12 }}
                      />
                    )}
                    {entry.new_config && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>新配置</div>
                        <pre className="settings-code">
                          {typeof entry.new_config === 'string'
                            ? entry.new_config
                            : JSON.stringify(entry.new_config, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无修复历史" />
            )}
          </div>
        ) : (
          <Spin />
        )}
      </Modal>
    </div>
  );
}
