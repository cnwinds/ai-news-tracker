/**
 * 社交平台组件
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
  Checkbox,
  message,
  Spin,
  Alert,
} from 'antd';
import { PlusOutlined, DeleteOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { SocialMediaReport, SocialMediaReportRequest } from '@/types';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { createMarkdownComponents } from '@/utils/markdown';
import { getThemeColor } from '@/utils/theme';
import { showError } from '@/utils/error';

const { Title } = Typography;

export default function SocialMediaReport() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [expandedReports, setExpandedReports] = useState<Set<number>>(new Set());
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();

  const { data: reports, isLoading } = useQuery({
    queryKey: ['social-media-reports'],
    queryFn: () => apiService.getSocialMediaReports(50),
  });

  // 获取社交平台配置，检查哪些平台已配置
  const { data: socialMediaSettings } = useQuery({
    queryKey: ['social-media-settings'],
    queryFn: () => apiService.getSocialMediaSettings(),
  });

  // 检查哪些平台已配置
  const youtubeConfigured = !!socialMediaSettings?.youtube_api_key;
  const tiktokConfigured = !!socialMediaSettings?.tiktok_api_key;
  const twitterConfigured = !!socialMediaSettings?.twitter_api_key;
  const redditConfigured = !!socialMediaSettings?.reddit_client_id && !!socialMediaSettings?.reddit_client_secret;

  const generateMutation = useMutation({
    mutationFn: (data: SocialMediaReportRequest) =>
      apiService.generateSocialMediaReport(data),
    onSuccess: () => {
      message.success('AI热点小报生成成功');
      setGenerateModalVisible(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['social-media-reports'] });
    },
    onError: (error) => {
      showError(error, '生成AI热点小报失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiService.deleteSocialMediaReport(id),
    onSuccess: () => {
      message.success('AI热点小报已删除');
      queryClient.invalidateQueries({ queryKey: ['social-media-reports'] });
    },
    onError: (error) => {
      showError(error, '删除AI热点小报失败');
    },
  });

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个AI热点小报吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteMutation.mutate(id);
      },
    });
  };

  const handleGenerate = (values: any) => {
    // 只启用已配置的平台
    const platforms = values.platforms || [];
    const requestData: SocialMediaReportRequest = {
      youtube_enabled: platforms.includes('youtube') && youtubeConfigured,
      tiktok_enabled: platforms.includes('tiktok') && tiktokConfigured,
      twitter_enabled: platforms.includes('twitter') && twitterConfigured,
      reddit_enabled: platforms.includes('reddit') && redditConfigured,
      // 不传递date，让后端使用当前日期（实时数据）
      date: undefined,
    };

    generateMutation.mutate(requestData);
  };

  const toggleExpand = (reportId: number) => {
    setExpandedReports((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(reportId)) {
        newSet.delete(reportId);
      } else {
        newSet.add(reportId);
      }
      return newSet;
    });
  };

  return (
    <div>
      <Card
        title="📱 社交平台"
        extra={
          isAuthenticated ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGenerateModalVisible(true)}
            >
              创建AI热点小报
            </Button>
          ) : null
        }
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin tip="加载中..." />
          </div>
        ) : !reports || reports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: getThemeColor(theme, 'textSecondary') }}>
            暂无热点小报，点击右上角按钮创建AI热点小报
          </div>
        ) : (
          <List
            dataSource={reports}
            renderItem={(report) => (
              <List.Item style={{ padding: 0, marginBottom: 8 }}>
                <Card
                  style={{ width: '100%', marginBottom: 0 }}
                  styles={{ body: { padding: '12px 16px' } }}
                >
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {/* 第一行（概览）：标题 + 统计Tag + 展开按钮 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '2px 0',
                      }}
                      onClick={() => toggleExpand(report.id)}
                    >
                      {/* 标题 */}
                      <Title level={5} style={{ marginBottom: 0, display: 'inline', flexShrink: 0 }}>
                        AI热点小报 - {dayjs(report.report_date).format('YYYY-MM-DD')}
                      </Title>

                      {/* 统计Tag */}
                      <Tag color="red" style={{ flexShrink: 0 }}>
                        YouTube: {report.youtube_count}
                      </Tag>
                      <Tag color="blue" style={{ flexShrink: 0 }}>
                        TikTok: {report.tiktok_count}
                      </Tag>
                      <Tag color="cyan" style={{ flexShrink: 0 }}>
                        Twitter: {report.twitter_count}
                      </Tag>
                      <Tag style={{ flexShrink: 0 }}>总计: {report.total_count}</Tag>

                      {/* 展开/收起图标 */}
                      <Button
                        type="text"
                        icon={expandedReports.has(report.id) ? <UpOutlined /> : <DownOutlined />}
                        size="small"
                        style={{ flexShrink: 0, marginLeft: 'auto' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(report.id);
                        }}
                      />
                    </div>

                    {/* 展开后的内容 */}
                    {expandedReports.has(report.id) && (
                      <>
                        <div
                          style={{
                            padding: '16px',
                            backgroundColor: getThemeColor(theme, 'bgSecondary'),
                            borderRadius: '4px',
                            border: `1px solid ${getThemeColor(theme, 'border')}`,
                            color: getThemeColor(theme, 'text'),
                          }}
                        >
                          <ReactMarkdown components={createMarkdownComponents(theme)}>
                            {report.report_content || ''}
                          </ReactMarkdown>
                        </div>
                        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                          {isAuthenticated && (
                            <Button
                              type="primary"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => handleDelete(report.id)}
                              loading={deleteMutation.isPending}
                            >
                              删除
                            </Button>
                          )}
                          <Button
                            type="default"
                            icon={<UpOutlined />}
                            onClick={() => toggleExpand(report.id)}
                          >
                            收起
                          </Button>
                        </div>
                      </>
                    )}
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title="创建AI热点小报"
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
        <Spin spinning={generateMutation.isPending} tip="正在生成AI热点小报，请稍候...">
          {generateMutation.isPending && (
            <Alert
              message="正在生成AI热点小报"
              description="正在从三大社交平台获取实时热点数据并生成报告，请耐心等待。生成完成后会自动刷新列表。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {!youtubeConfigured && !tiktokConfigured && !twitterConfigured && !redditConfigured && (
            <Alert
              message="未配置任何平台"
              description="请在系统设置中配置至少一个社交平台的API密钥。"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form
            form={form}
            onFinish={handleGenerate}
            layout="vertical"
            initialValues={{
              platforms: [
                ...(youtubeConfigured ? ['youtube'] : []),
                ...(tiktokConfigured ? ['tiktok'] : []),
                ...(twitterConfigured ? ['twitter'] : []),
                ...(redditConfigured ? ['reddit'] : []),
              ],
            }}
          >
            <Form.Item
              name="platforms"
              label="选择平台"
              tooltip="只显示已配置的平台，未配置的平台会自动跳过"
            >
              <Checkbox.Group>
                {youtubeConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px' }}>
                    <Checkbox value="youtube">YouTube</Checkbox>
                  </div>
                )}
                {tiktokConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px' }}>
                    <Checkbox value="tiktok">TikTok</Checkbox>
                  </div>
                )}
                {twitterConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px' }}>
                    <Checkbox value="twitter">Twitter</Checkbox>
                  </div>
                )}
                {redditConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px' }}>
                    <Checkbox value="reddit">Reddit</Checkbox>
                  </div>
                )}
                {!youtubeConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px', color: '#999' }}>
                    <Checkbox disabled>YouTube（未配置）</Checkbox>
                  </div>
                )}
                {!tiktokConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px', color: '#999' }}>
                    <Checkbox disabled>TikTok（未配置）</Checkbox>
                  </div>
                )}
                {!twitterConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px', color: '#999' }}>
                    <Checkbox disabled>Twitter（未配置）</Checkbox>
                  </div>
                )}
                {!redditConfigured && (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px', color: '#999' }}>
                    <Checkbox disabled>Reddit（未配置）</Checkbox>
                  </div>
                )}
              </Checkbox.Group>
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}
