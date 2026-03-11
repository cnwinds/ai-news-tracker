/**
 * 数据维护组件
 */
import { useMemo } from 'react';
import { Card, Form, InputNumber, Switch, Button, Alert, Select, Divider } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { groupSourcesByType, SOURCE_TYPE_LABELS } from '@/utils/source';
import type { DataCleanupFormValues } from '@/types';

const { Option, OptGroup } = Select;

export default function DataCleanup() {
  const [form] = Form.useForm();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();

  // 获取所有订阅源列表
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => apiService.getSources(),
  });

  // 按类型分组订阅源
  const groupedSources = useMemo(() => {
    if (!sources) return {};
    return groupSourcesByType(sources);
  }, [sources]);

  const cleanupMutation = useMutation({
    mutationFn: (data: {
      delete_articles_older_than_days?: number;
      delete_logs_older_than_days?: number;
      delete_unanalyzed_articles?: boolean;
      delete_articles_by_sources?: string[];
      rerun_unanalyzed_articles?: boolean;
    }) => apiService.cleanupData(data),
    onSuccess: (data) => {
      showSuccess(data.message || '清理完成');
      form.resetFields();
    },
    onError: createErrorHandler({
      operationName: '数据维护',
      customMessages: {
        auth: '需要登录才能执行数据维护',
      },
    }),
  });

  const handleCleanup = (values: DataCleanupFormValues) => {
    cleanupMutation.mutate(values);
  };

  const handleRerunUnanalyzed = () => {
    cleanupMutation.mutate({ rerun_unanalyzed_articles: true });
  };

  return (
    <div>
      <Card title="🛠️ 数据维护">
        <Alert
          message="警告"
          description="数据维护中的删除操作不可恢复，请谨慎操作！"
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
            <InputNumber min={0} style={{ width: '100%' }} disabled={!isAuthenticated} />
          </Form.Item>

          <Form.Item
            name="delete_logs_older_than_days"
            label="删除超过多少天的日志"
            help="设置为0表示不删除"
          >
            <InputNumber min={0} style={{ width: '100%' }} disabled={!isAuthenticated} />
          </Form.Item>

          <Form.Item
            name="delete_unanalyzed_articles"
            label="删除未分析的文章"
            valuePropName="checked"
          >
            <Switch disabled={!isAuthenticated} />
          </Form.Item>


          <Divider orientation="left" style={{ margin: '16px 0' }}>
            AI分析重跑
          </Divider>

          <Form.Item label="一键重跑未进行AI分析的文章" help="仅重跑已有正文内容且尚未完成AI分析的文章">
            <Button
              type="default"
              onClick={handleRerunUnanalyzed}
              loading={cleanupMutation.isPending}
              disabled={!isAuthenticated}
            >
              一键重跑未分析文章
            </Button>
          </Form.Item>

          <Divider orientation="left" style={{ margin: '16px 0' }}>
            删除清理
          </Divider>

          <Form.Item
            name="delete_articles_by_sources"
            label="删除指定订阅源的文章"
            help="选择订阅源或输入关键词匹配文章（使用标题/内容搜索）"
          >
            <Select
              mode="tags"
              placeholder="选择订阅源或输入关键词"
              style={{ width: '100%' }}
              allowClear
              maxTagCount="responsive"
              showSearch
              disabled={!isAuthenticated}
              tokenSeparators={[',', ' ', '\n']}
              filterOption={(input, option) => {
                if (option?.type === 'group') return true;
                const label = String(option?.label ?? '');
                return label.toLowerCase().includes(input.toLowerCase());
              }}
            >
              {Object.entries(groupedSources).map(([type, sourcesList]) => (
                <OptGroup
                  key={type}
                  label={`${SOURCE_TYPE_LABELS[type] || type} (${sourcesList.length})`}
                >
                  {sourcesList.map((source) => (
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
              disabled={!isAuthenticated}
            >
              执行清理
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

