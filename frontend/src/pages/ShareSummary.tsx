/**
 * 摘要分享页
 * 外部用户可直接访问，独立展示摘要内容
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout, Typography, Spin, Tag, Space, Button, Divider, Empty } from 'antd';
import {
  ArrowLeftOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import type { CSSProperties } from 'react';

const { Content } = Layout;
const { Title, Text } = Typography;

export default function ShareSummary() {
  const { id } = useParams();
  const summaryId = Number(id);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['share-summary', summaryId],
    queryFn: () => apiService.getSummary(summaryId),
    enabled: Number.isFinite(summaryId) && summaryId > 0,
    staleTime: 60 * 1000,
  });

  const containerStyle: CSSProperties = {
    background: getThemeColor(theme, 'bgElevated'),
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    borderRadius: 12,
    padding: 24,
  };

  const summaryTitle = summary
    ? summary.summary_type === 'daily'
      ? `每日摘要 - ${dayjs(summary.summary_date).format('YYYY-MM-DD')}`
      : `每周摘要 - ${dayjs(summary.start_date).format('YYYY-MM-DD')} 至 ${dayjs(summary.end_date).format('YYYY-MM-DD')}`
    : '';

  const summaryRange = summary
    ? summary.summary_type === 'daily'
      ? dayjs(summary.summary_date).format('YYYY-MM-DD')
      : `${dayjs(summary.start_date).format('YYYY-MM-DD')} 至 ${dayjs(summary.end_date).format('YYYY-MM-DD')}`
    : '';

  return (
    <Layout style={{ minHeight: '100vh', background: getThemeColor(theme, 'bgContainer') }}>
      <Content style={{ padding: '24px', maxWidth: 980, margin: '0 auto', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Text type="secondary">AI News Tracker</Text>
            <Button
              type="text"
              icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{
                color: getThemeColor(theme, 'text'),
                fontSize: '18px',
                padding: '4px 8px',
              }}
              title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            />
          </div>
        </div>

        <div style={containerStyle}>
          {!Number.isFinite(summaryId) || summaryId <= 0 ? (
            <Empty description="分享链接无效" />
          ) : isLoading ? (
            <div style={{ textAlign: 'center', padding: '50px 0' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, color: getThemeColor(theme, 'textSecondary') }}>
                加载中...
              </div>
            </div>
          ) : error ? (
            <Empty description="加载摘要失败" />
          ) : summary ? (
            <>
              <div style={{ marginBottom: 20 }}>
                <Space wrap size={[8, 8]}>
                  <Tag color={summary.summary_type === 'daily' ? 'blue' : 'purple'}>
                    {summary.summary_type === 'daily' ? '日报' : '周报'}
                  </Tag>
                  <Tag>文章数: {summary.total_articles}</Tag>
                  <Tag color="red">高重要性: {summary.high_importance_count}</Tag>
                  <Tag color="orange">中重要性: {summary.medium_importance_count}</Tag>
                </Space>
                <Title level={2} style={{ marginTop: 12, color: getThemeColor(theme, 'text') }}>
                  {summaryTitle}
                </Title>
                <Space size="middle" wrap>
                  <Text type="secondary">
                    <strong>覆盖范围：</strong>
                    {summaryRange}
                  </Text>
                </Space>
              </div>

              {summary.summary_content ? (
                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      padding: '16px',
                      backgroundColor: getThemeColor(theme, 'bgSecondary'),
                      borderRadius: '8px',
                      border: `1px solid ${getThemeColor(theme, 'border')}`,
                      color: getThemeColor(theme, 'text'),
                      lineHeight: '1.8',
                    }}
                  >
                    <ReactMarkdown
                      components={createMarkdownComponents(theme)}
                      remarkPlugins={[remarkGfm]}
                    >
                      {summary.summary_content}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 24 }}>
                  <Text type="secondary">摘要内容为空</Text>
                </div>
              )}

              {summary.key_topics && summary.key_topics.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                    关键主题：
                  </Text>
                  <Space size={[8, 8]} wrap style={{ marginLeft: 8 }}>
                    {summary.key_topics.map((topic, idx) => (
                      <Tag key={`${topic}-${idx}`}>{topic}</Tag>
                    ))}
                  </Space>
                </div>
              )}

              <Divider />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <Space wrap size="middle">
                  <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
                    返回首页
                  </Button>
                </Space>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  生成时间：{dayjs(summary.created_at).format('YYYY-MM-DD HH:mm:ss')}
                </Text>
              </div>
            </>
          ) : null}
        </div>
      </Content>
    </Layout>
  );
}
