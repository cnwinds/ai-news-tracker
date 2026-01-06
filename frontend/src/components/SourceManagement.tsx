/**
 * 订阅源管理组件
 */
import { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Switch,
  InputNumber,
  message,
  Popconfirm,
  Checkbox,
  Divider,
  Tabs,
  Alert,
  Spin,
  Select,
  Row,
  Col,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { RSSSource, RSSSourceCreate, RSSSourceUpdate } from '@/types';

export default function SourceManagement() {
  const [modalVisible, setModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<RSSSource | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 隐藏滚动条的样式
  const hiddenScrollbarStyle: React.CSSProperties = {
    maxHeight: 600,
    overflowY: 'auto',
    scrollbarWidth: 'none', // Firefox
    msOverflowStyle: 'none', // IE/Edge
  } as React.CSSProperties;

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
      message.success('订阅源创建成功');
      setModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: () => {
      message.error('创建订阅源失败');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RSSSourceUpdate }) =>
      apiService.updateSource(id, data),
    onSuccess: () => {
      message.success('订阅源更新成功');
      setModalVisible(false);
      setEditingSource(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: () => {
      message.error('更新订阅源失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSource(id),
    onSuccess: () => {
      message.success('订阅源已删除');
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: () => {
      message.error('删除订阅源失败');
    },
  });

  const importMutation = useMutation({
    mutationFn: (sourceNames: string[]) => apiService.importDefaultSources(sourceNames),
    onSuccess: (data) => {
      message.success(
        `导入完成：成功 ${data.imported} 个，跳过 ${data.skipped} 个${data.errors ? `，错误 ${data.errors.length} 个` : ''}`
      );
      setImportModalVisible(false);
      setSelectedSources([]);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: () => {
      message.error('导入失败');
    },
  });

  const handleAdd = () => {
    setEditingSource(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (source: RSSSource) => {
    setEditingSource(source);
    form.setFieldsValue(source);
    setModalVisible(true);
  };

  const handleSubmit = (values: any) => {
    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleImport = () => {
    if (selectedSources.length === 0) {
      message.warning('请至少选择一个要导入的源');
      return;
    }
    importMutation.mutate(selectedSources);
  };

  // 规范化源类型
  const normalizeSourceType = (type: string | undefined): string => {
    if (!type) return 'rss';
    const normalized = type.toLowerCase().trim();
    // 支持多种可能的写法
    if (normalized === 'social' || normalized === 'social_media') return 'social';
    if (normalized === 'rss' || normalized === 'rss_feed') return 'rss';
    if (normalized === 'api' || normalized === 'api_source') return 'api';
    if (normalized === 'web' || normalized === 'web_source') return 'web';
    return normalized; // 如果都不匹配，返回原值
  };

  // 按类型分组默认源
  const groupedDefaultSources = defaultSources?.reduce((acc: any, source: any) => {
    const type = normalizeSourceType(source.source_type);
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(source);
    return acc;
  }, {}) || {};

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

  // 按类型分组现有源
  const groupedSources = sources?.reduce((acc: any, source: RSSSource) => {
    const type = normalizeSourceType(source.source_type);
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(source);
    return acc;
  }, {}) || {};

  // 对每个类型的源进行排序
  if (groupedSources.rss) groupedSources.rss = sortSources(groupedSources.rss);
  if (groupedSources.api) groupedSources.api = sortSources(groupedSources.api);
  if (groupedSources.web) groupedSources.web = sortSources(groupedSources.web);
  if (groupedSources.social) groupedSources.social = sortSources(groupedSources.social);

  // 检查源是否已存在
  const isSourceExists = (sourceName: string, sourceUrl: string) => {
    return sources?.some(
      (s) => s.name === sourceName || s.url === sourceUrl
    ) || false;
  };

  // 计算距离今天的天数
  const getDaysAgo = (dateString: string | undefined): number | null => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // 获取天数显示文本
  const getDaysAgoText = (daysAgo: number | null): string => {
    if (daysAgo === null) return '';
    if (daysAgo === 0) return '今天';
    if (daysAgo === 1) return '昨天';
    return `${daysAgo}天前`;
  };

  // 格式化日期显示
  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return '暂无';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 渲染源列表项（网格卡片样式）
  const renderSourceItem = (source: RSSSource) => {
    const daysAgo = getDaysAgo(source.latest_article_published_at);
    const lastUpdateText = source.latest_article_published_at
      ? formatDate(source.latest_article_published_at)
      : '暂无';
    const daysAgoText = getDaysAgoText(daysAgo);
    const daysAgoColor = daysAgo !== null 
      ? (daysAgo > 30 ? '#ff4d4f' : daysAgo > 7 ? '#faad14' : '#52c41a')
      : '#999';

    return (
      <Card
        key={source.id}
        hoverable
        style={{
          borderRadius: 8,
          border: `1px solid ${source.enabled ? '#d9d9d9' : '#ffccc7'}`,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
        bodyStyle={{ 
          padding: 16,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
        actions={[
          <Button
            key="edit"
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(source)}
            size="small"
            style={{ height: 'auto' }}
          >
            编辑
          </Button>,
          <Popconfirm
            key="delete"
            title="确定要删除这个订阅源吗？"
            onConfirm={() => deleteMutation.mutate(source.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small" style={{ height: 'auto' }}>
              删除
            </Button>
          </Popconfirm>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <div style={{ marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8, lineHeight: 1.4 }}>
              {source.name}
            </div>
            <Space size={[4, 4]} wrap style={{ marginBottom: 8 }}>
              <Tag color={source.enabled ? 'green' : 'red'} style={{ margin: 0 }}>
                {source.enabled ? '启用' : '禁用'}
              </Tag>
              {source.category && <Tag style={{ margin: 0 }}>{source.category}</Tag>}
              {source.tier && <Tag style={{ margin: 0 }}>{source.tier}</Tag>}
            </Space>
            {source.articles_count !== undefined && (
              <Tag color="blue" style={{ marginBottom: 8 }}>文章数: {source.articles_count}</Tag>
            )}
          </div>
          
          <div style={{ 
            flex: 1,
            minHeight: 0,
            fontSize: 12, 
            color: '#666', 
            marginBottom: 8,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              marginBottom: 4,
              flexShrink: 0,
            }}>
              {source.url}
            </div>
            {source.description && (
              <div style={{ 
                color: '#999', 
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                lineHeight: 1.4,
                flex: 1,
                minHeight: 0,
              }}>
                {source.description}
              </div>
            )}
          </div>

          <div style={{ 
            fontSize: 12, 
            color: '#666', 
            paddingTop: 8,
            borderTop: '1px solid #f0f0f0',
            flexShrink: 0,
          }}>
            <div style={{ color: '#999', marginBottom: 4 }}>最后更新</div>
            <div>
              <span style={{ fontSize: 11 }}>{lastUpdateText}</span>
              {daysAgo !== null && daysAgoText && (
                <span style={{ 
                  marginLeft: 8, 
                  color: daysAgoColor,
                  fontWeight: 500
                }}>
                  {daysAgoText}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div>
      <Card
        title="⚙️ 订阅源管理"
        extra={
          <Space>
            <Button icon={<ImportOutlined />} onClick={() => setImportModalVisible(true)}>
              导入默认源
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              添加订阅源
            </Button>
          </Space>
        }
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : !sources || sources.length === 0 ? (
          <Alert message="暂无订阅源" description="点击上方按钮添加或导入订阅源" type="info" />
        ) : (
          <Tabs
            items={[
              {
                key: 'rss',
                label: `RSS源 (${groupedSources.rss?.length || 0})`,
                children: (
                  <div className="hidden-scrollbar" style={hiddenScrollbarStyle}>
                    {groupedSources.rss?.length > 0 ? (
                      <Row gutter={[16, 16]}>
                        {groupedSources.rss.map((source: RSSSource) => (
                          <Col key={source.id} xs={24} sm={12} md={8} lg={8}>
                            {renderSourceItem(source)}
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <Alert message="暂无RSS源" type="info" />
                    )}
                  </div>
                ),
              },
              {
                key: 'api',
                label: `API源 (${groupedSources.api?.length || 0})`,
                children: (
                  <div className="hidden-scrollbar" style={hiddenScrollbarStyle}>
                    {groupedSources.api?.length > 0 ? (
                      <Row gutter={[16, 16]}>
                        {groupedSources.api.map((source: RSSSource) => (
                          <Col key={source.id} xs={24} sm={12} md={8} lg={8}>
                            {renderSourceItem(source)}
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <Alert message="暂无API源" type="info" />
                    )}
                  </div>
                ),
              },
              {
                key: 'web',
                label: `Web源 (${groupedSources.web?.length || 0})`,
                children: (
                  <div className="hidden-scrollbar" style={hiddenScrollbarStyle}>
                    {groupedSources.web?.length > 0 ? (
                      <Row gutter={[16, 16]}>
                        {groupedSources.web.map((source: RSSSource) => (
                          <Col key={source.id} xs={24} sm={12} md={8} lg={8}>
                            {renderSourceItem(source)}
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <Alert message="暂无Web源" type="info" />
                    )}
                  </div>
                ),
              },
              {
                key: 'social',
                label: `社交媒体源 (${groupedSources.social?.length || 0})`,
                children: (
                  <div className="hidden-scrollbar" style={hiddenScrollbarStyle}>
                    {groupedSources.social?.length > 0 ? (
                      <Row gutter={[16, 16]}>
                        {groupedSources.social.map((source: RSSSource) => (
                          <Col key={source.id} xs={24} sm={12} md={8} lg={8}>
                            {renderSourceItem(source)}
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <Alert message="暂无社交媒体源" type="info" />
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

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
      >
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="source_type" label="源类型" rules={[{ required: true }]} initialValue="rss">
            <Select>
              <Select.Option value="rss">RSS源</Select.Option>
              <Select.Option value="api">API源</Select.Option>
              <Select.Option value="web">Web源</Select.Option>
              <Select.Option value="social">社交媒体源</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="订阅源的说明信息" rows={3} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="例如: news, official_blog, academic" />
          </Form.Item>
          <Form.Item name="extra_config" label="扩展配置（JSON）">
            <Input.TextArea 
              placeholder="Web源和社交媒体源的扩展配置（JSON格式），例如: {&quot;article_selector&quot;: &quot;article.entry-card&quot;, &quot;title_selector&quot;: &quot;h2.entry-title a&quot;}" 
              rows={4}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue={1}>
            <InputNumber min={1} max={5} />
          </Form.Item>
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
          <div>加载中...</div>
        ) : !defaultSources || defaultSources.length === 0 ? (
          <Alert message="没有可用的默认数据源" type="info" />
        ) : (
          <div>
            <Alert
              message="提示"
              description="选择要导入的数据源。已存在的源将被跳过。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Checkbox
              checked={selectedSources.length === defaultSources.length}
              indeterminate={
                selectedSources.length > 0 && selectedSources.length < defaultSources.length
              }
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedSources(defaultSources.map((s: any) => s.name));
                } else {
                  setSelectedSources([]);
                }
              }}
              style={{ marginBottom: 16 }}
            >
              全选 ({selectedSources.length}/{defaultSources.length})
            </Checkbox>
            <Divider />
            <Tabs
              items={[
                {
                  key: 'rss',
                  label: `RSS源 (${groupedDefaultSources.rss?.length || 0})`,
                  children: (
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {groupedDefaultSources.rss?.map((source: any) => {
                        const exists = isSourceExists(source.name, source.url);
                        return (
                          <div key={source.name} style={{ marginBottom: 8 }}>
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
                            >
                              <Space>
                                <strong>{source.name}</strong>
                                {exists && <Tag color="orange">已存在</Tag>}
                                {source.category && <Tag>{source.category}</Tag>}
                                {source.tier && <Tag>{source.tier}</Tag>}
                                {!source.enabled && <Tag color="red">禁用</Tag>}
                              </Space>
                            </Checkbox>
                            <div style={{ marginLeft: 24, fontSize: 12, color: '#666' }}>
                              {source.url}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                },
                {
                  key: 'api',
                  label: `API源 (${groupedDefaultSources.api?.length || 0})`,
                  children: (
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {groupedDefaultSources.api?.map((source: any) => {
                        const exists = isSourceExists(source.name, source.url);
                        return (
                          <div key={source.name} style={{ marginBottom: 8 }}>
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
                            >
                              <Space>
                                <strong>{source.name}</strong>
                                {exists && <Tag color="orange">已存在</Tag>}
                                {source.category && <Tag>{source.category}</Tag>}
                                {source.tier && <Tag>{source.tier}</Tag>}
                                {!source.enabled && <Tag color="red">禁用</Tag>}
                              </Space>
                            </Checkbox>
                            <div style={{ marginLeft: 24, fontSize: 12, color: '#666' }}>
                              {source.url}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                },
                {
                  key: 'web',
                  label: `Web源 (${groupedDefaultSources.web?.length || 0})`,
                  children: (
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {groupedDefaultSources.web?.map((source: any) => {
                        const exists = isSourceExists(source.name, source.url);
                        return (
                          <div key={source.name} style={{ marginBottom: 8 }}>
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
                            >
                              <Space>
                                <strong>{source.name}</strong>
                                {exists && <Tag color="orange">已存在</Tag>}
                                {source.category && <Tag>{source.category}</Tag>}
                                {source.tier && <Tag>{source.tier}</Tag>}
                                {!source.enabled && <Tag color="red">禁用</Tag>}
                              </Space>
                            </Checkbox>
                            <div style={{ marginLeft: 24, fontSize: 12, color: '#666' }}>
                              {source.url}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                },
                {
                  key: 'social',
                  label: `社交媒体源 (${groupedDefaultSources.social?.length || 0})`,
                  children: (
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {groupedDefaultSources.social?.map((source: any) => {
                        const exists = isSourceExists(source.name, source.url);
                        return (
                          <div key={source.name} style={{ marginBottom: 8 }}>
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
                            >
                              <Space>
                                <strong>{source.name}</strong>
                                {exists && <Tag color="orange">已存在</Tag>}
                                {source.category && <Tag>{source.category}</Tag>}
                                {source.tier && <Tag>{source.tier}</Tag>}
                                {!source.enabled && <Tag color="red">禁用</Tag>}
                              </Space>
                            </Checkbox>
                            <div style={{ marginLeft: 24, fontSize: 12, color: '#666' }}>
                              {source.url}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

