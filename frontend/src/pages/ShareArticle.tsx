/**
 * 文章分享页
 * 外部用户可直接访问，独立展示文章内容
 */
import { useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout, Typography, Spin, Tag, Space, Button, Divider, Empty } from 'antd';
import {
  ArrowLeftOutlined,
  LinkOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor } from '@/utils/theme';
import { createMarkdownComponents } from '@/utils/markdown';

const { Content } = Layout;
const { Title, Text } = Typography;

export default function ShareArticle() {
  const { id } = useParams();
  const articleId = Number(id);
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['share-article', articleId],
    queryFn: () => apiService.getArticle(articleId),
    enabled: Number.isFinite(articleId) && articleId > 0,
    staleTime: 60 * 1000,
  });


  const containerStyle: CSSProperties = {
    background: getThemeColor(theme, 'bgElevated'),
    border: `1px solid ${getThemeColor(theme, 'border')}`,
    borderRadius: 12,
    padding: 24,
  };

  return (
    <Layout style={{ minHeight: '100vh', background: getThemeColor(theme, 'bgContainer') }}>
      <Content style={{ padding: '24px', maxWidth: 980, margin: '0 auto', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: 16,
          }}
        >
          <Text type="secondary">AI News Tracker</Text>
        </div>

        <div style={containerStyle}>
          {!Number.isFinite(articleId) || articleId <= 0 ? (
            <Empty description="分享链接无效" />
          ) : isLoading ? (
            <div style={{ textAlign: 'center', padding: '50px 0' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, color: getThemeColor(theme, 'textSecondary') }}>
                加载中...
              </div>
            </div>
          ) : error ? (
            <Empty description="加载文章失败" />
          ) : article ? (
            <>
              <div style={{ marginBottom: 20 }}>
                <Space wrap size={[8, 8]}>
                  {article.importance && (
                    <Tag
                      color={
                        article.importance === 'high'
                          ? 'red'
                          : article.importance === 'medium'
                          ? 'orange'
                          : 'default'
                      }
                    >
                      {article.importance === 'high'
                        ? '高'
                        : article.importance === 'medium'
                        ? '中'
                        : '低'}
                    </Tag>
                  )}
                  <Tag color="blue">{article.source}</Tag>
                </Space>
                <Title level={2} style={{ marginTop: 12, color: getThemeColor(theme, 'text') }}>
                  {article.title_zh || article.title}
                </Title>
                <Space size="middle" wrap>
                  {article.published_at && (
                    <Text type="secondary">
                      <strong>发布时间：</strong>
                      {dayjs(article.published_at).format('YYYY-MM-DD HH:mm')}
                    </Text>
                  )}
                  {article.author && (
                    <Text type="secondary">
                      <strong>作者：</strong>
                      {article.author}
                    </Text>
                  )}
                </Space>
              </div>

              {article.summary && (
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
                    <ReactMarkdown components={createMarkdownComponents(theme)}>
                      {article.summary}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {article.content ? (
                <div style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      marginBottom: 12,
                    }}
                    onClick={() => setIsContentExpanded(!isContentExpanded)}
                  >
                    <Title level={4} style={{ color: getThemeColor(theme, 'text'), margin: 0 }}>
                      文章内容
                    </Title>
                    <Button
                      type="text"
                      icon={isContentExpanded ? <UpOutlined /> : <DownOutlined />}
                      size="small"
                      style={{ color: getThemeColor(theme, 'textSecondary'), marginLeft: 8 }}
                    />
                  </div>
                  {isContentExpanded && (
                    <div
                      style={{
                        padding: '16px',
                        backgroundColor: getThemeColor(theme, 'bgSecondary'),
                        borderRadius: '8px',
                        border: `1px solid ${getThemeColor(theme, 'border')}`,
                        color: getThemeColor(theme, 'text'),
                        lineHeight: '1.8',
                        wordBreak: 'break-word',
                      }}
                    >
                      <ReactMarkdown components={createMarkdownComponents(theme)}>
                        {article.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginBottom: 24 }}>
                  <Text type="secondary">文章内容未保存，请查看原文链接</Text>
                </div>
              )}

              {article.tags && article.tags.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                    标签：
                  </Text>
                  <Space size={[8, 8]} wrap style={{ marginLeft: 8 }}>
                    {article.tags.map((tag, idx) => (
                      <Tag key={idx}>{tag}</Tag>
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
                  <Button
                    type="primary"
                    icon={<LinkOutlined />}
                    onClick={() => {
                      if (article.url) {
                        window.open(article.url, '_blank');
                      }
                    }}
                >
                  查看原文
                </Button>
                  <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
                    返回首页
                  </Button>
                </Space>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  采集时间：{dayjs(article.collected_at).format('YYYY-MM-DD HH:mm:ss')}
                </Text>
              </div>
            </>
          ) : null}
        </div>
      </Content>
    </Layout>
  );
}
