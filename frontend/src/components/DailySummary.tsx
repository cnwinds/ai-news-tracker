/**
 * 内容摘要组件
 */
import { useState } from 'react';
import {
  Card,
  Button,
  List,
  Typography,
  Space,
  Tag,
  Modal,
  Form,
  Radio,
  DatePicker,
  message,
  Spin,
  Alert,
} from 'antd';
import { FileTextOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const { Title, Paragraph } = Typography;

export default function DailySummary() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: summaries, isLoading } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => apiService.getSummaries(50),
  });

  const generateMutation = useMutation({
    mutationFn: (data: { summary_type: string; date?: string; week?: string }) =>
      apiService.generateSummary(data),
    onSuccess: () => {
      message.success('摘要生成成功');
      setGenerateModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error: any) => {
      message.error(`生成摘要失败: ${error?.response?.data?.detail || error?.message || '未知错误'}`);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (data: { summary_type: string; date?: string; week?: string }) =>
      apiService.generateSummary(data),
    onSuccess: () => {
      message.success('摘要重新生成成功');
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error: any) => {
      message.error(`重新生成摘要失败: ${error?.response?.data?.detail || error?.message || '未知错误'}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSummary(id),
    onSuccess: () => {
      message.success('摘要已删除');
      queryClient.invalidateQueries({ queryKey: ['summaries'] });
    },
    onError: (error: any) => {
      message.error(`删除摘要失败: ${error?.response?.data?.detail || error?.message || '未知错误'}`);
    },
  });

  const handleRegenerate = (summary: any) => {
    const requestData: any = {
      summary_type: summary.summary_type,
    };

    if (summary.summary_type === 'daily') {
      // 从summary_date提取日期
      requestData.date = dayjs(summary.summary_date).format('YYYY-MM-DD');
    } else if (summary.summary_type === 'weekly') {
      // 从summary_date提取周
      const summaryDate = dayjs(summary.summary_date);
      requestData.week = `${summaryDate.year()}-${summaryDate.isoWeek().toString().padStart(2, '0')}`;
    }

    regenerateMutation.mutate(requestData);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个摘要吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteMutation.mutate(id);
      },
    });
  };

  const handleGenerate = (values: any) => {
    const requestData: any = {
      summary_type: values.summary_type,
    };

    // 根据类型设置不同的参数
    if (values.summary_type === 'daily') {
      if (values.date) {
        requestData.date = dayjs(values.date).format('YYYY-MM-DD');
      }
    } else if (values.summary_type === 'weekly') {
      if (values.week) {
        // week格式: YYYY-WW
        const weekDate = dayjs(values.week);
        requestData.week = `${weekDate.year()}-${weekDate.isoWeek().toString().padStart(2, '0')}`;
      }
    }

    generateMutation.mutate(requestData);
  };

  return (
    <div>
      <Card
        title="📊 内容总结"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setGenerateModalVisible(true)}
          >
            生成新摘要
          </Button>
        }
      >
        {isLoading ? (
          <div>加载中...</div>
        ) : !summaries || summaries.length === 0 ? (
          <div>暂无摘要</div>
        ) : (
          <List
            dataSource={summaries}
            renderItem={(summary) => (
              <List.Item>
                <Card style={{ width: '100%' }}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Title level={5}>
                        {summary.summary_type === 'daily' ? '每日' : '每周'}摘要 -{' '}
                        {dayjs(summary.summary_date).format('YYYY-MM-DD')}
                      </Title>
                      <Space>
                        <Tag>文章数: {summary.total_articles}</Tag>
                        <Tag color="red">高重要性: {summary.high_importance_count}</Tag>
                        <Tag color="orange">中重要性: {summary.medium_importance_count}</Tag>
                      </Space>
                    </div>
                    <div
                      style={{
                        padding: '16px',
                        backgroundColor: '#fafafa',
                        borderRadius: '4px',
                        border: '1px solid #e8e8e8',
                      }}
                    >
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => (
                            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginTop: '16px', marginBottom: '12px' }}>
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginTop: '16px', marginBottom: '12px' }}>
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '14px', marginBottom: '10px' }}>
                              {children}
                            </h3>
                          ),
                          p: ({ children }) => (
                            <p style={{ marginBottom: '12px', lineHeight: '1.6' }}>{children}</p>
                          ),
                          ul: ({ children }) => (
                            <ul style={{ marginBottom: '12px', paddingLeft: '24px' }}>{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol style={{ marginBottom: '12px', paddingLeft: '24px' }}>{children}</ol>
                          ),
                          li: ({ children }) => (
                            <li style={{ marginBottom: '6px', lineHeight: '1.6' }}>{children}</li>
                          ),
                          strong: ({ children }) => (
                            <strong style={{ fontWeight: 'bold' }}>{children}</strong>
                          ),
                          em: ({ children }) => (
                            <em style={{ fontStyle: 'italic' }}>{children}</em>
                          ),
                          code: ({ children, className }: any) => {
                            const isInline = !className;
                            if (isInline) {
                              return (
                                <code
                                  style={{
                                    backgroundColor: '#f4f4f4',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9em',
                                  }}
                                >
                                  {children}
                                </code>
                              );
                            }
                            return (
                              <code
                                style={{
                                  display: 'block',
                                  backgroundColor: '#f4f4f4',
                                  padding: '12px',
                                  borderRadius: '4px',
                                  fontFamily: 'monospace',
                                  fontSize: '0.9em',
                                  overflow: 'auto',
                                  marginBottom: '12px',
                                }}
                              >
                                {children}
                              </code>
                            );
                          },
                          blockquote: ({ children }) => (
                            <blockquote
                              style={{
                                borderLeft: '4px solid #1890ff',
                                paddingLeft: '16px',
                                marginLeft: '0',
                                marginBottom: '12px',
                                color: '#666',
                                fontStyle: 'italic',
                              }}
                            >
                              {children}
                            </blockquote>
                          ),
                          a: ({ children, href }) => (
                            <a
                              href={href}
                              style={{ color: '#1890ff', textDecoration: 'none' }}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {summary.summary_content}
                      </ReactMarkdown>
                    </div>
                    {summary.key_topics && summary.key_topics.length > 0 && (
                      <div>
                        <strong>关键主题：</strong>
                        {summary.key_topics.map((topic, index) => (
                          <Tag key={index} style={{ marginBottom: 4 }}>
                            {topic}
                          </Tag>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                      <Button
                        type="default"
                        icon={<ReloadOutlined />}
                        onClick={() => handleRegenerate(summary)}
                        loading={regenerateMutation.isPending}
                      >
                        重新生成
                      </Button>
                      <Button
                        type="primary"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(summary.id)}
                        loading={deleteMutation.isPending}
                      >
                        删除
                      </Button>
                    </div>
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title="生成新摘要"
        open={generateModalVisible}
        onCancel={() => {
          if (!generateMutation.isPending) {
            setGenerateModalVisible(false);
            form.resetFields();
          }
        }}
        onOk={() => form.submit()}
        confirmLoading={generateMutation.isPending}
        okText={generateMutation.isPending ? '正在生成...' : '生成'}
        cancelButtonProps={{ disabled: generateMutation.isPending }}
        width={600}
        closable={!generateMutation.isPending}
        maskClosable={!generateMutation.isPending}
      >
        <Spin spinning={generateMutation.isPending} tip="正在生成摘要，请稍候...">
          {generateMutation.isPending && (
            <Alert
              message="正在生成摘要"
              description="摘要生成可能需要一些时间，请耐心等待。生成完成后会自动刷新列表。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={form} onFinish={handleGenerate} layout="vertical">
          <Form.Item
            name="summary_type"
            label="摘要类型"
            initialValue="daily"
            rules={[{ required: true }]}
          >
            <Radio.Group>
              <Radio value="daily">按天总结</Radio>
              <Radio value="weekly">按周总结</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.summary_type !== currentValues.summary_type}
          >
            {({ getFieldValue }) => {
              const summaryType = getFieldValue('summary_type');
              return (
                <>
                  {summaryType === 'daily' && (
                    <Form.Item
                      name="date"
                      label="选择日期"
                      tooltip="不选择则默认为今天，已总结的日期会显示为灰色"
                    >
                      <DatePicker
                        style={{ width: '100%' }}
                        format="YYYY-MM-DD"
                        placeholder="选择日期（默认今天）"
                        dateRender={(current) => {
                          if (!summaries) {
                            return <div>{current.date()}</div>;
                          }
                          const dateStr = current.format('YYYY-MM-DD');
                          const isSummarized = summaries.some(
                            (s) =>
                              s.summary_type === 'daily' &&
                              dayjs(s.summary_date).format('YYYY-MM-DD') === dateStr
                          );
                          return (
                            <div
                              style={{
                                color: isSummarized ? '#bfbfbf' : 'inherit',
                                backgroundColor: isSummarized ? '#f5f5f5' : 'transparent',
                                borderRadius: '2px',
                                padding: '2px',
                                width: '100%',
                                textAlign: 'center',
                              }}
                            >
                              {current.date()}
                            </div>
                          );
                        }}
                      />
                    </Form.Item>
                  )}
                  {summaryType === 'weekly' && (
                    <Form.Item
                      name="week"
                      label="选择周"
                      tooltip="选择该周的任意一天，系统会自动识别该周。不选择则默认为本周，已总结的周会显示为灰色"
                    >
                      <DatePicker
                        style={{ width: '100%' }}
                        format="YYYY-MM-DD"
                        placeholder="选择周（默认本周）"
                        picker="week"
                        dateRender={(current) => {
                          if (!summaries) {
                            return <div>{current.date()}</div>;
                          }
                          const currentYear = current.year();
                          const currentWeek = current.isoWeek();
                          const isSummarized = summaries.some((s) => {
                            if (s.summary_type !== 'weekly') return false;
                            const summaryDate = dayjs(s.summary_date);
                            return (
                              summaryDate.year() === currentYear &&
                              summaryDate.isoWeek() === currentWeek
                            );
                          });
                          return (
                            <div
                              style={{
                                color: isSummarized ? '#bfbfbf' : 'inherit',
                                backgroundColor: isSummarized ? '#f5f5f5' : 'transparent',
                                borderRadius: '2px',
                                padding: '2px',
                                width: '100%',
                                textAlign: 'center',
                              }}
                            >
                              {current.date()}
                            </div>
                          );
                        }}
                      />
                    </Form.Item>
                  )}
                </>
              );
            }}
          </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}



