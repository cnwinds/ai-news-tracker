/**
 * 数据清理组件
 */
import { useMemo } from 'react';
import { Card, Form, InputNumber, Switch, Button, message, Alert, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { RSSSource } from '@/types';

const { Option, OptGroup } = Select;

export default function DataCleanup() {
  const [form] = Form.useForm();

  // 获取所有订阅源列表
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  // 规范化源类型
  const normalizeSourceType = (type: string | undefined): string => {
    if (!type) return 'rss';
    const normalized = type.toLowerCase().trim();
    if (normalized === 'social' || normalized === 'social_media') return 'social';
    if (normalized === 'rss' || normalized === 'rss_feed') return 'rss';
    if (normalized === 'api' || normalized === 'api_source') return 'api';
    if (normalized === 'web' || normalized === 'web_source') return 'web';
    return normalized;
  };

  // 按类型分组订阅源
  const groupedSources = useMemo(() => {
    if (!sources) return {};
    
    return sources.reduce((acc: any, source: RSSSource) => {
      const type = normalizeSourceType(source.source_type);
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(source);
      return acc;
    }, {});
  }, [sources]);

  // 源类型标签映射
  const sourceTypeLabels: Record<string, string> = {
    rss: 'RSS源',
    api: 'API源',
    web: 'Web源',
    social: '社交媒体源',
  };

  const cleanupMutation = useMutation({
    mutationFn: (data: {
      delete_articles_older_than_days?: number;
      delete_logs_older_than_days?: number;
      delete_unanalyzed_articles?: boolean;
      delete_articles_by_sources?: string[];
    }) => apiService.cleanupData(data),
    onSuccess: (data) => {
      message.success(data.message || '清理完成');
      form.resetFields();
    },
    onError: () => {
      message.error('清理失败');
    },
  });

  const handleCleanup = (values: any) => {
    cleanupMutation.mutate(values);
  };

  return (
    <div>
      <Card title="🗑️ 数据清理">
        <Alert
          message="警告"
          description="数据清理操作不可恢复，请谨慎操作！"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={form} onFinish={handleCleanup} layout="vertical">
          <Form.Item
            name="delete_articles_older_than_days"
            label="删除超过多少天的文章"
            help="设置为0表示不删除"
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="delete_logs_older_than_days"
            label="删除超过多少天的日志"
            help="设置为0表示不删除"
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="delete_unanalyzed_articles"
            label="删除未分析的文章"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="delete_articles_by_sources"
            label="删除指定订阅源的文章"
            help="选择要删除的订阅源，可多选"
          >
            <Select
              mode="multiple"
              placeholder="选择订阅源"
              style={{ width: '100%' }}
              allowClear
              maxTagCount="responsive"
              showSearch
              filterOption={(input, option) => {
                if (option?.type === 'group') return true;
                const label = String(option?.label ?? '');
                return label.toLowerCase().includes(input.toLowerCase());
              }}
            >
              {Object.entries(groupedSources).map(([type, sourcesList]: [string, any]) => (
                <OptGroup 
                  key={type} 
                  label={`${sourceTypeLabels[type] || type} (${sourcesList.length})`}
                >
                  {sourcesList.map((source: RSSSource) => (
                    <Option key={source.id} value={source.name} label={source.name}>
                      {source.name}
                    </Option>
                  ))}
                </OptGroup>
              ))}
            </Select>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              danger
              htmlType="submit"
              loading={cleanupMutation.isPending}
            >
              执行清理
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}


