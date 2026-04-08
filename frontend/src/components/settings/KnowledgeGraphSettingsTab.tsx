import { useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { safeSetFieldsValue } from '@/utils/form';
import type { KnowledgeGraphSettings } from '@/types';

export default function KnowledgeGraphSettingsTab() {
  const [form] = Form.useForm<KnowledgeGraphSettings>();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess } = useErrorHandler();

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['knowledge-graph-settings'],
    queryFn: () => apiService.getKnowledgeGraphSettings(),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['knowledge-graph-stats'],
    queryFn: () => apiService.getKnowledgeGraphStats(),
  });

  useEffect(() => {
    if (settings) {
      safeSetFieldsValue(form, settings);
    }
  }, [form, settings]);

  const updateMutation = useMutation({
    mutationFn: (data: KnowledgeGraphSettings) => apiService.updateKnowledgeGraphSettings(data),
    onSuccess: () => {
      showSuccess('知识图谱设置已保存');
      queryClient.invalidateQueries({ queryKey: ['knowledge-graph-settings'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-graph-stats'] });
    },
    onError: createErrorHandler({
      operationName: '保存知识图谱设置',
      customMessages: {
        auth: '需要登录后才能保存知识图谱设置',
      },
    }),
  });

  const handleSave = (values: KnowledgeGraphSettings) => {
    updateMutation.mutate(values);
  };

  return (
    <Spin spinning={settingsLoading || statsLoading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="知识图谱配置说明"
          description="知识图谱在现有 RAG 之外补充实体、关系、社区和路径能力。建议默认开启，并保持运行模式为自动。"
        />

        {stats && (
          <Card title="当前状态" size="small">
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Statistic title="节点总数" value={stats.total_nodes} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="边总数" value={stats.total_edges} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic title="已同步文章" value={stats.synced_articles} />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="覆盖率"
                  value={Number((stats.coverage * 100).toFixed(1))}
                  suffix="%"
                />
              </Col>
            </Row>
          </Card>
        )}

        <Card title="图谱设置">
          <Form<KnowledgeGraphSettings>
            form={form}
            layout="vertical"
            onFinish={handleSave}
            initialValues={settings}
          >
            <Form.Item
              name="enabled"
              label="启用知识图谱"
              valuePropName="checked"
            >
              <Switch disabled={!isAuthenticated} />
            </Form.Item>

            <Form.Item
              name="auto_sync_enabled"
              label="采集后自动同步"
              valuePropName="checked"
            >
              <Switch disabled={!isAuthenticated} />
            </Form.Item>

            <Form.Item
              name="run_mode"
              label="抽取模式"
              rules={[{ required: true, message: '请选择抽取模式' }]}
              extra="自动模式会在可用时启用 AI 抽取，否则退化为确定性抽取。"
            >
              <Select
                disabled={!isAuthenticated}
                options={[
                  { label: '自动（推荐）', value: 'auto' },
                  { label: 'Agent 语义抽取', value: 'agent' },
                  { label: '确定性抽取', value: 'deterministic' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="max_articles_per_sync"
              label="单次最大同步文章数"
              rules={[{ required: true, message: '请输入单次最大同步文章数' }]}
            >
              <InputNumber min={1} max={1000} style={{ width: '100%' }} disabled={!isAuthenticated} />
            </Form.Item>

            <Form.Item
              name="query_depth"
              label="默认查询深度"
              rules={[{ required: true, message: '请输入默认查询深度' }]}
              extra="更大的深度会扩展更多邻居和边，但也会带来更长的响应时间。"
            >
              <InputNumber min={1} max={6} style={{ width: '100%' }} disabled={!isAuthenticated} />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={updateMutation.isPending}
                  disabled={!isAuthenticated}
                >
                  保存设置
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    if (settings) {
                      safeSetFieldsValue(form, settings);
                    }
                  }}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </Spin>
  );
}
