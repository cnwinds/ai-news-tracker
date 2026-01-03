/**
 * 文章卡片组件
 */
import { useState } from 'react';
import { Card, Tag, Button, Space, Typography, Popconfirm } from 'antd';
import { LinkOutlined, DeleteOutlined, RobotOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import type { Article } from '@/types';
import { useAnalyzeArticle, useDeleteArticle } from '@/hooks/useArticles';

const { Title, Text, Paragraph } = Typography;

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const analyzeMutation = useAnalyzeArticle();
  const deleteMutation = useDeleteArticle();

  // 处理 summary 字段：如果是 JSON 字符串，尝试解析并提取 summary 字段
  const getSummaryText = (): string => {
    if (!article.summary) return '';
    
    const summaryStr = String(article.summary).trim();
    if (!summaryStr) return '';
    
    // 检查是否以 { 开头，可能是 JSON 对象字符串
    if (summaryStr.startsWith('{') && summaryStr.includes('"summary"')) {
      try {
        // 尝试解析 JSON
        const parsed = JSON.parse(summaryStr);
        // 如果解析成功且是对象，提取 summary 字段
        if (typeof parsed === 'object' && parsed !== null && parsed !== undefined) {
          if ('summary' in parsed && typeof parsed.summary === 'string') {
            return parsed.summary;
          }
          // 如果 summary 字段不存在，但整个对象看起来像是摘要内容，返回原始字符串
        }
      } catch (e) {
        // JSON 解析失败，可能是格式不完整，返回原始字符串
        console.warn('Failed to parse summary JSON:', e);
      }
    }
    
    // 如果不是 JSON 格式，直接返回原始字符串
    return summaryStr;
  };

  const summaryText = getSummaryText();

  const importanceColors: Record<string, string> = {
    high: 'red',
    medium: 'orange',
    low: 'green',
  };

  const handleAnalyze = () => {
    // 如果已分析，使用 force=true 强制重新分析
    analyzeMutation.mutate({ 
      id: article.id, 
      force: article.is_processed 
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(article.id);
  };

  return (
    <Card
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {/* 第一行：importance + 标题 + source */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          {article.importance && (
            <Tag color={importanceColors[article.importance]} style={{ flexShrink: 0 }}>
              {article.importance === 'high' ? '高' : article.importance === 'medium' ? '中' : '低'}
            </Tag>
          )}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
            <Title level={5} style={{ marginBottom: 0 }}>
              {article.title_zh || article.title}
            </Title>
            <Space size="small">
              <Tag color="blue">{article.source}</Tag>
              {!article.is_processed && <Tag>未分析</Tag>}
            </Space>
          </div>
        </div>

        {/* 第二行：日期和作者 */}
        <div>
          <Space size="small">
            <Text type="secondary" style={{ fontSize: 12 }}>
              {article.published_at
                ? dayjs(article.published_at).format('YYYY-MM-DD HH:mm')
                : '未知时间'}
            </Text>
            {article.author && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                作者: {article.author}
              </Text>
            )}
          </Space>
        </div>

        {/* 摘要区域：摘要内容（Markdown格式） */}
        {summaryText ? (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                marginBottom: 8,
                maxHeight: expanded ? 'none' : '4.5em', // 约3行高度 (1.5em * 3)
                overflow: 'hidden',
                lineHeight: '1.5em',
                position: 'relative',
              }}
            >
              {!expanded && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: '100%',
                    height: '1.5em',
                    background: 'linear-gradient(to bottom, transparent, white)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(0, 0, 0, 0.88)',
                }}
              >
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p style={{ marginBottom: '0.5em', marginTop: 0 }}>{children}</p>,
                    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                    em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                    ul: ({ children }) => <ul style={{ marginBottom: '0.5em', paddingLeft: '1.5em' }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ marginBottom: '0.5em', paddingLeft: '1.5em' }}>{children}</ol>,
                    li: ({ children }) => <li style={{ marginBottom: '0.25em' }}>{children}</li>,
                    h1: ({ children }) => <h1 style={{ fontSize: '1.5em', fontWeight: 600, marginBottom: '0.5em', marginTop: 0 }}>{children}</h1>,
                    h2: ({ children }) => <h2 style={{ fontSize: '1.3em', fontWeight: 600, marginBottom: '0.5em', marginTop: 0 }}>{children}</h2>,
                    h3: ({ children }) => <h3 style={{ fontSize: '1.1em', fontWeight: 600, marginBottom: '0.5em', marginTop: 0 }}>{children}</h3>,
                    code: ({ children }) => <code style={{ backgroundColor: '#f5f5f5', padding: '2px 4px', borderRadius: '3px', fontSize: '0.9em' }}>{children}</code>,
                    blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d9d9d9', paddingLeft: '1em', margin: '0.5em 0', color: 'rgba(0, 0, 0, 0.65)' }}>{children}</blockquote>,
                  }}
                >
                  {summaryText}
                </ReactMarkdown>
              </div>
            </div>
            {/* AI生成的精简摘要标签（右边）+ 查看原文 + 折叠按钮（左边） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Button
                  type="link"
                  icon={<LinkOutlined />}
                  href={article.url}
                  target="_blank"
                  size="small"
                >
                  查看原文
                </Button>
                <Button
                  type="text"
                  icon={expanded ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setExpanded(!expanded)}
                  size="small"
                  title={expanded ? '收起' : '展开'}
                />
              </Space>
              {article.is_processed && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  🤖 AI生成的精简摘要
                </Text>
              )}
            </div>
          </div>
        ) : (
          /* 未分析的文章：显示查看原文和折叠按钮 */
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <Space>
                <Button
                  type="link"
                  icon={<LinkOutlined />}
                  href={article.url}
                  target="_blank"
                  size="small"
                >
                  查看原文
                </Button>
                <Button
                  type="text"
                  icon={expanded ? <UpOutlined /> : <DownOutlined />}
                  onClick={() => setExpanded(!expanded)}
                  size="small"
                />
              </Space>
            </div>
          </div>
        )}

        {/* 展开区域：标签（tags）和功能按钮 */}
        {expanded && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
            {/* 标签区域（文章标签） */}
            {article.tags && article.tags.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Space size="small" wrap>
                  {article.tags.map((tag, index) => (
                    <Tag key={index}>{tag}</Tag>
                  ))}
                </Space>
              </div>
            )}
            
            {/* 功能按钮 */}
            <Space>
              <Button
                type="text"
                icon={<RobotOutlined />}
                onClick={handleAnalyze}
                loading={analyzeMutation.isPending}
              >
                {article.is_processed ? '重新分析' : 'AI分析'}
              </Button>
              <Popconfirm
                title="确定要删除这篇文章吗？"
                onConfirm={handleDelete}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleteMutation.isPending}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </div>
        )}
      </Space>
    </Card>
  );
}

