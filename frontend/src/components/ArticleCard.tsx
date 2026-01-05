/**
 * 文章卡片组件
 */
import { useState } from 'react';
import { Card, Tag, Button, Space, Typography, Popconfirm, Tooltip, Input } from 'antd';
import { LinkOutlined, DeleteOutlined, RobotOutlined, UpOutlined, DownOutlined, StarOutlined, StarFilled, EditOutlined, SaveOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import type { Article } from '@/types';
import { useAnalyzeArticle, useDeleteArticle, useFavoriteArticle, useUnfavoriteArticle, useUpdateArticle } from '@/hooks/useArticles';
import { useTheme } from '@/contexts/ThemeContext';
import { createMarkdownComponents } from '@/utils/markdown';
import { getThemeColor } from '@/utils/theme';

const { TextArea } = Input;

const { Title, Text } = Typography;

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(article.user_notes || '');
  const analyzeMutation = useAnalyzeArticle();
  const deleteMutation = useDeleteArticle();
  const favoriteMutation = useFavoriteArticle();
  const unfavoriteMutation = useUnfavoriteArticle();
  const updateMutation = useUpdateArticle();
  const { theme } = useTheme();

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

  const handleFavorite = () => {
    if (article.is_favorited) {
      unfavoriteMutation.mutate(article.id);
    } else {
      favoriteMutation.mutate(article.id);
    }
  };

  const handleSaveNotes = () => {
    updateMutation.mutate({
      id: article.id,
      data: { user_notes: notesValue },
    }, {
      onSuccess: () => {
        setIsEditingNotes(false);
      },
    });
  };

  const handleCancelEditNotes = () => {
    setNotesValue(article.user_notes || '');
    setIsEditingNotes(false);
  };

  return (
    <Card
      style={{ marginBottom: 8 }}
      bodyStyle={{ padding: '12px 16px' }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {/* 第一行（概览）：日期Tag + 重要程度Tag + 标题 + 来源Tag，整行可点击 */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            flexWrap: 'wrap', 
            gap: 6,
            cursor: 'pointer',
            padding: '2px 0',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          {/* 日期Tag（最前面） */}
          <Tag color="default" style={{ flexShrink: 0 }}>
            {article.published_at
              ? dayjs(article.published_at).format('YYYY-MM-DD')
              : '未知日期'}
          </Tag>
          
          {/* 重要程度Tag */}
          {article.importance && (
            <Tag color={importanceColors[article.importance]} style={{ flexShrink: 0 }}>
              {article.importance === 'high' ? '高' : article.importance === 'medium' ? '中' : '低'}
            </Tag>
          )}
          
          {/* 标题 + 来源Tag + 收藏标记（紧跟在标题后面，靠左显示） */}
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {article.title_zh ? (
              <Tooltip title={article.title} placement="top">
                <Title level={5} style={{ marginBottom: 0, display: 'inline', cursor: 'help' }}>
                  {article.title_zh}
                </Title>
              </Tooltip>
            ) : (
              <Title level={5} style={{ marginBottom: 0, display: 'inline' }}>
                {article.title}
              </Title>
            )}
            <Tag color="blue" style={{ flexShrink: 0 }}>{article.source}</Tag>
            {article.is_favorited && (
              <Tooltip title="已收藏">
                <StarFilled style={{ color: '#faad14', fontSize: 14 }} />
              </Tooltip>
            )}
          </div>
          
          {/* 展开/收起图标 */}
          <Button
            type="text"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            size="small"
            style={{ flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          />
        </div>

        {/* 展开后的详情区域 */}
        {expanded && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${getThemeColor(theme, 'border')}` }}>
            {/* 日期和作者 */}
            <div style={{ marginBottom: 8 }}>
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
                {!article.is_processed && <Tag>未分析</Tag>}
              </Space>
            </div>

            {/* 摘要区域：摘要内容（Markdown格式） */}
            {summaryText ? (
              <div style={{ marginBottom: 12 }}>
                {article.is_processed && (
                  <Tag icon={<RobotOutlined />} color="purple" style={{ marginBottom: 8 }}>
                    AI生成的精简摘要
                  </Tag>
                )}
                <div
                  style={{
                    fontSize: 14,
                    color: getThemeColor(theme, 'text'),
                    lineHeight: '1.6',
                  }}
                >
                  <ReactMarkdown components={createMarkdownComponents(theme)}>
                    {summaryText}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}

            {/* 查看原文按钮 */}
            <div style={{ marginBottom: 12 }}>
              <Button
                type="link"
                icon={<LinkOutlined />}
                href={article.url}
                target="_blank"
                size="small"
              >
                查看原文
              </Button>
            </div>

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

            {/* 用户笔记区域 */}
            {isEditingNotes ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14 }}>我的笔记</Text>
                </div>
                <div>
                  <TextArea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="记录你的思考或评论..."
                    rows={4}
                    style={{ marginBottom: 8 }}
                  />
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SaveOutlined />}
                      onClick={handleSaveNotes}
                      loading={updateMutation.isPending}
                    >
                      保存
                    </Button>
                    <Button
                      size="small"
                      onClick={handleCancelEditNotes}
                    >
                      取消
                    </Button>
                  </Space>
                </div>
              </div>
            ) : article.user_notes ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 14 }}>我的笔记</Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setIsEditingNotes(true)}
                  >
                    编辑
                  </Button>
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: getThemeColor(theme, 'background'),
                    border: `1px solid ${getThemeColor(theme, 'border')}`,
                    borderRadius: 4,
                    minHeight: 40,
                    fontSize: 14,
                    color: getThemeColor(theme, 'text'),
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {article.user_notes}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <Button
                  type="dashed"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setIsEditingNotes(true)}
                  style={{ width: '100%' }}
                >
                  增加笔记
                </Button>
              </div>
            )}
            
            {/* 功能按钮 */}
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
              <Button
                type={article.is_favorited ? "primary" : "default"}
                icon={article.is_favorited ? <StarFilled /> : <StarOutlined />}
                onClick={handleFavorite}
                loading={favoriteMutation.isPending || unfavoriteMutation.isPending}
              >
                {article.is_favorited ? '已收藏' : '收藏'}
              </Button>
              <Button
                type="default"
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
                  type="primary"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleteMutation.isPending}
                >
                  删除
                </Button>
              </Popconfirm>
              <Button
                type="default"
                icon={<UpOutlined />}
                onClick={() => setExpanded(false)}
              >
                收起
              </Button>
            </div>
          </div>
        )}
      </Space>
    </Card>
  );
}

