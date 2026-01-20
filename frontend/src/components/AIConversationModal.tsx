/**
 * AI 对话模态层组件
 * 全屏居中的悬浮层，支持流式响应、引用跳转、多轮对话
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Modal, 
  Input, 
  Button, 
  Typography, 
  Spin, 
  List, 
  Avatar, 
  Space, 
  Tag,
  Empty,
  Collapse
} from 'antd';
import { 
  CloseOutlined, 
  SendOutlined, 
  UserOutlined, 
  RobotOutlined,
  HistoryOutlined,
  DeleteOutlined,
  UpOutlined,
  DownOutlined
} from '@ant-design/icons';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { apiService } from '@/services/api';
import type { RAGQueryRequest, ArticleSearchResult } from '@/types';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor, getMessageBubbleStyle } from '@/utils/theme';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { TextArea } = Input;
const { Text } = Typography;

export default function AIConversationModal() {
  const { theme } = useTheme();
  const {
    isModalOpen,
    closeModal,
    currentChatId,
    setCurrentChatId,
    currentMessages,
    setCurrentMessages,
    chatHistories,
    createNewChat,
    updateChatHistory,
    deleteChatHistory,
    loadChatHistory,
  } = useAIConversation();

  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isHistoryDrawerClosing, setIsHistoryDrawerClosing] = useState(false);
  const [topK] = useState(5);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const citationRefs = useRef<Record<number, HTMLDivElement>>({});
  const hasAutoTriggeredRef = useRef(false); // 用于防止重复自动触发

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, isStreaming]);

  // 处理引用跳转
  const scrollToCitation = (index: number) => {
    const ref = citationRefs.current[index];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 闪烁高亮
      ref.style.transition = 'background-color 0.3s';
      ref.style.backgroundColor = getThemeColor(theme, 'selectedBg');
      setTimeout(() => {
        ref.style.backgroundColor = 'transparent';
      }, 1000);
    }
  };

  // 发送AI请求的核心逻辑（可复用）
  const sendAIRequest = useCallback((question: string, existingMessages: typeof currentMessages) => {
    if (!question.trim() || isStreaming) {
      return;
    }

    // 创建或更新聊天 ID
    let chatId = currentChatId;
    if (!chatId) {
      chatId = Date.now().toString();
      // 设置当前聊天ID，确保同一对话使用同一个ID
      setCurrentChatId(chatId);
    }

    // 创建初始的 AI 消息
    const assistantMessageId = (Date.now() + 1).toString();
    const initialAssistantMessage = {
      id: assistantMessageId,
      type: 'assistant' as const,
      content: '',
      timestamp: new Date(),
      articles: [] as ArticleSearchResult[],
      sources: [] as string[],
    };

    setCurrentMessages([...existingMessages, initialAssistantMessage]);
    setIsStreaming(true);

    // 构建对话历史（只包含用户和助手消息，排除当前问题）
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = existingMessages
      .filter(msg => msg.type === 'user' || msg.type === 'assistant')
      .map(msg => ({
        role: msg.type === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content
      }));

    // 发送流式请求，包含对话历史
    const request: RAGQueryRequest = {
      question: question.trim(),
      top_k: topK,
      conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
    };

    let accumulatedContent = '';
    let receivedArticles: ArticleSearchResult[] = [];
    let receivedSources: string[] = [];

    apiService.queryArticlesStream(request, (chunk) => {
      if (chunk.type === 'articles') {
        receivedArticles = chunk.data.articles || [];
        receivedSources = chunk.data.sources || [];
        
        setCurrentMessages((prevMessages: typeof currentMessages) => {
          return prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                articles: receivedArticles,
                sources: receivedSources,
              };
            }
            return msg;
          });
        });
      } else if (chunk.type === 'content') {
        accumulatedContent += chunk.data.content || '';
        
        setCurrentMessages((prevMessages: typeof currentMessages) => {
          return prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                content: accumulatedContent,
              };
            }
            return msg;
          });
        });
      } else if (chunk.type === 'done') {
        setIsStreaming(false);
        
        const finalMessages = [...existingMessages, {
          ...initialAssistantMessage,
          content: accumulatedContent,
          articles: receivedArticles,
          sources: receivedSources,
        }];
        
        setCurrentMessages(finalMessages);
        updateChatHistory(chatId!, finalMessages);
      } else if (chunk.type === 'error') {
        setIsStreaming(false);
        const errorMessage = chunk.data.message || '未知错误';
        
        setCurrentMessages((prevMessages: typeof currentMessages) => {
          return prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
              };
            }
            return msg;
          });
        });

        const errorMessages = [...existingMessages, {
          ...initialAssistantMessage,
          content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
        }];
        updateChatHistory(chatId!, errorMessages);
      }
    }).catch((error) => {
      setIsStreaming(false);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      setCurrentMessages((prevMessages: typeof currentMessages) => {
        return prevMessages.map((msg) => {
          if (msg.id === assistantMessageId) {
            return {
              ...msg,
              content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
            };
          }
          return msg;
        });
      });
    });
  }, [isStreaming, currentChatId, topK, setCurrentMessages, updateChatHistory, setCurrentChatId]);

  // 处理发送消息（从输入框）
  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) {
      return;
    }

    const question = inputValue.trim();
    setInputValue('');

    // 添加用户消息
    const userMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: question,
      timestamp: new Date(),
    };

    const newMessages = [...currentMessages, userMessage];
    setCurrentMessages(newMessages);

    // 发送AI请求
    sendAIRequest(question, newMessages);
  };

  // 自动触发AI回复：当模态层打开且只有一条用户消息时（新对话）
  useEffect(() => {
    if (!isModalOpen) {
      // 模态层关闭时重置标记
      hasAutoTriggeredRef.current = false;
      return;
    }

    // 如果已经自动触发过，不再触发
    if (hasAutoTriggeredRef.current) {
      return;
    }

    // 检查是否应该自动触发：
    // 1. 模态层已打开
    // 2. 是新对话（没有chatId）
    // 3. 只有一条消息
    // 4. 这条消息是用户消息
    // 5. 不在流式响应中
    if (
      !currentChatId && // 确保是新对话，不是加载的历史对话
      currentMessages.length === 1 &&
      currentMessages[0].type === 'user' &&
      !isStreaming
    ) {
      const question = currentMessages[0].content;
      if (question.trim()) {
        hasAutoTriggeredRef.current = true;
        // 延迟一小段时间，确保UI已渲染
        setTimeout(() => {
          sendAIRequest(question, currentMessages);
        }, 100);
      }
    }
  }, [isModalOpen, currentMessages, isStreaming, sendAIRequest, currentChatId]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 处理回答文本中的引用格式
  const processAnswerText = (text: string): string => {
    let processed = text;
    processed = processed.replace(/文章\s*(\d+)/g, '[$1]');
    processed = processed.replace(/[———]\s*《[^》]+》[，,]\s*来源[：:]\s*[^\n]+/g, '');
    processed = processed.replace(/[———]\s*《[^》]+》/g, '');
    return processed;
  };

  // 提取引用编号
  // const extractCitations = (text: string): number[] => {
  //   const matches = text.match(/\[(\d+)\]/g);
  //   if (!matches) return [];
  //   return matches.map((match) => parseInt(match.replace(/[\[\]]/g, '')));
  // };

  // 响应式：检测移动端
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 模态层样式
  const modalStyle: React.CSSProperties = {
    top: 0,
    paddingBottom: 0,
    maxWidth: isMobile ? '100%' : '900px',
    margin: isMobile ? 0 : '0 auto',
  };

  const modalBodyStyle: React.CSSProperties = {
    padding: 0,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: theme === 'dark' 
      ? 'rgba(26, 26, 26, 0.95)' 
      : 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(10px)',
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: isMobile ? '16px' : '24px',
    maxWidth: isMobile ? '100%' : '800px',
    margin: '0 auto',
    width: '100%',
  };

  if (!isModalOpen) return null;

  const modalContent = (
    <Modal
      open={isModalOpen}
      onCancel={closeModal}
      footer={null}
      closable={false}
      width="100%"
      style={{
        ...modalStyle,
        position: 'relative',
      }}
      styles={{
        body: {
          ...modalBodyStyle,
          position: 'relative',
        },
        mask: {
          backgroundColor: theme === 'dark' 
            ? 'rgba(0, 0, 0, 0.6)' 
            : 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(10px)',
        },
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${getThemeColor(theme, 'border')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: getThemeColor(theme, 'bgElevated'),
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => {
              setIsHistoryDrawerClosing(false);
              setIsHistoryDrawerOpen(true);
            }}
            title="历史记录"
          >
            历史
          </Button>
          <Text strong style={{ color: getThemeColor(theme, 'text') }}>
            {currentMessages.find((m) => m.type === 'user')?.content || 'AI 对话中...'}
          </Text>
        </div>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={closeModal}
          title="关闭 (Esc)"
        />
      </div>

      {/* 中间滚动区域 - 添加容器用于裁剪历史抽屉 */}
      <div 
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden', // 关键：裁剪历史抽屉，让它看起来像是从容器内部拉出
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 实际的内容滚动区域 */}
        <div 
          style={{
            ...contentStyle,
            flex: 1,
            overflowY: 'auto',
            position: 'relative',
          }}
        >
        {currentMessages.length === 0 ? (
          <Empty
            description="开始与 AI 对话，询问关于文章内容的问题"
            style={{ marginTop: 100 }}
          />
        ) : (
          <List
            dataSource={currentMessages}
            renderItem={(message) => {
              const isUser = message.type === 'user';
              // const citations = !isUser ? extractCitations(message.content) : [];

              return (
                <List.Item style={{ border: 'none', padding: '16px 0' }}>
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: isUser ? 'row-reverse' : 'row',
                      gap: 12,
                    }}
                  >
                    <Avatar
                      icon={isUser ? <UserOutlined /> : <RobotOutlined />}
                      style={{
                        backgroundColor: isUser 
                          ? getThemeColor(theme, 'userAvatarBg')
                          : getThemeColor(theme, 'assistantAvatarBg'),
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        maxWidth: '75%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {!isUser && message.articles && message.articles.length > 0 && (
                        <div style={{ marginBottom: 8, width: '100%' }}>
                          <Collapse
                            ghost
                            size="small"
                            activeKey={expandedSources[message.id] ? ['sources'] : []}
                            onChange={(keys) => {
                              setExpandedSources((prev) => ({
                                ...prev,
                                [message.id]: keys.includes('sources'),
                              }));
                            }}
                            style={{
                              backgroundColor: 'transparent',
                            }}
                            items={[
                              {
                                key: 'sources',
                                label: (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontSize: '12px',
                                      color: getThemeColor(theme, 'textSecondary'),
                                      padding: '2px 0',
                                    }}
                                  >
                                    <span>📚 参考来源 ({message.articles.length})</span>
                                    {expandedSources[message.id] ? (
                                      <UpOutlined style={{ fontSize: '10px' }} />
                                    ) : (
                                      <DownOutlined style={{ fontSize: '10px' }} />
                                    )}
                                  </div>
                                ),
                                children: (
                                  <div style={{ paddingTop: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
                                    {message.articles.map((article, idx) => {
                                      const articleNumber = idx + 1;
                                      return (
                                        <div
                                          key={article.id}
                                          ref={(el) => {
                                            if (el) citationRefs.current[articleNumber] = el;
                                          }}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 6,
                                            padding: '1px 0',
                                            cursor: 'pointer',
                                            borderBottom: idx < message.articles!.length - 1
                                              ? `1px solid ${getThemeColor(theme, 'border')}`
                                              : 'none',
                                            width: '100%',
                                            maxWidth: '100%',
                                            overflow: 'hidden',
                                          }}
                                          onClick={() => {
                                            window.open(article.url, '_blank');
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = getThemeColor(theme, 'selectedBg');
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                          }}
                                        >
                                          <Text
                                            strong
                                            style={{
                                              color: getThemeColor(theme, 'primary'),
                                              fontSize: '12px',
                                              minWidth: '18px',
                                              flexShrink: 0,
                                              lineHeight: '1.2',
                                            }}
                                          >
                                            [{articleNumber}]
                                          </Text>
                                          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                            <Text
                                              ellipsis
                                              style={{
                                                display: 'block',
                                                color: getThemeColor(theme, 'text'),
                                                fontSize: '12px',
                                                marginBottom: 0,
                                                lineHeight: '1.2',
                                                wordBreak: 'break-word',
                                                overflowWrap: 'break-word',
                                                maxWidth: '100%',
                                              }}
                                            >
                                              {article.title_zh || article.title}
                                            </Text>
                                            <Space size={2} style={{ fontSize: '10px', lineHeight: '1.1' }}>
                                              <Tag color="blue" style={{ margin: 0, fontSize: '10px', padding: '0 3px', lineHeight: '12px' }}>
                                                {article.source}
                                              </Tag>
                                              {article.published_at && (
                                                <Text type="secondary" style={{ fontSize: '10px' }}>
                                                  {dayjs(article.published_at).format('YYYY-MM-DD')}
                                                </Text>
                                              )}
                                              {article.similarity && (
                                                <Text type="secondary" style={{ fontSize: '10px' }}>
                                                  {Math.round(article.similarity * 100)}%
                                                </Text>
                                              )}
                                            </Space>
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
                      
                      <div
                        style={{
                          ...getMessageBubbleStyle(theme, message.type),
                          padding: '12px 16px',
                          borderRadius: '12px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {isUser ? (
                          <Text style={{ color: getThemeColor(theme, 'userMessageText') }}>
                            {message.content}
                          </Text>
                        ) : (
                          <div>
                            <ReactMarkdown 
                              components={{
                                ...createMarkdownComponents(theme),
                                // 自定义引用链接
                                a: ({ href, children }: any) => {
                                  const match = href?.match(/\[(\d+)\]/);
                                  if (match) {
                                    const index = parseInt(match[1]);
                                    return (
                                      <a
                                        href="#"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          scrollToCitation(index);
                                        }}
                                        style={{
                                          color: getThemeColor(theme, 'primary'),
                                          textDecoration: 'none',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {children}
                                      </a>
                                    );
                                  }
                                  return <a href={href}>{children}</a>;
                                },
                              }}
                              remarkPlugins={[remarkGfm]}
                            >
                              {processAnswerText(message.content)}
                            </ReactMarkdown>
                            {isStreaming && 
                             message.id === currentMessages[currentMessages.length - 1]?.id && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: '2px',
                                  height: '1em',
                                  backgroundColor: getThemeColor(theme, 'assistantMessageText'),
                                  marginLeft: '2px',
                                  animation: 'blink 1s step-end infinite',
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      <Text
                        type="secondary"
                        style={{
                          fontSize: 11,
                          marginTop: 4,
                          textAlign: isUser ? 'right' : 'left',
                        }}
                      >
                        {dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        )}

        {/* 加载状态 - 仅当最后一条消息不是AI消息时显示（避免与消息气泡内的加载状态重复） */}
        {isStreaming && 
         currentMessages.length > 0 && 
         currentMessages[currentMessages.length - 1]?.type !== 'assistant' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <Avatar 
              icon={<RobotOutlined />} 
              style={{ 
                backgroundColor: getThemeColor(theme, 'assistantAvatarBg'),
                flexShrink: 0 
              }} 
            />
            <div style={{
              ...getMessageBubbleStyle(theme, 'assistant'),
              padding: '12px 16px',
              borderRadius: '12px',
            }}>
              <Spin size="small" />
              <Text style={{
                marginLeft: 8,
                color: getThemeColor(theme, 'assistantMessageText'),
              }}>
                正在生成回答...
              </Text>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>

        {/* 历史记录侧边栏 - 从聊天容器内部右侧拉出，被外层容器的 overflow: hidden 裁剪 */}
        {(isHistoryDrawerOpen || isHistoryDrawerClosing) && (
          <>
            {/* 遮罩层 - 只覆盖聊天内容区域，带淡入/淡出动画 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.15)',
                zIndex: 1000,
                animation: isHistoryDrawerClosing 
                  ? 'fadeOut 0.3s ease-out forwards'
                  : 'fadeIn 0.3s ease-out',
              }}
              onClick={() => {
                setIsHistoryDrawerClosing(true);
                setTimeout(() => {
                  setIsHistoryDrawerOpen(false);
                  setIsHistoryDrawerClosing(false);
                }, 300);
              }}
            />
            {/* 抽屉内容 - 从容器左侧边缘拉出，被容器裁剪，看起来像是从内部展开 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: '300px',
                backgroundColor: getThemeColor(theme, 'bgElevated'),
                borderRight: `1px solid ${getThemeColor(theme, 'border')}`,
                zIndex: 1001,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '2px 0 8px rgba(0, 0, 0, 0.15)',
                animation: isHistoryDrawerClosing
                  ? 'slideOutLeft 0.3s ease-out forwards'
                  : 'slideInLeft 0.3s ease-out',
              }}
            >
            {/* 抽屉头部 */}
            <div
              style={{
                padding: '16px',
                borderBottom: `1px solid ${getThemeColor(theme, 'border')}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text strong style={{ color: getThemeColor(theme, 'text'), fontSize: '16px' }}>
                对话历史
              </Text>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={() => {
                  setIsHistoryDrawerClosing(true);
                  setTimeout(() => {
                    setIsHistoryDrawerOpen(false);
                    setIsHistoryDrawerClosing(false);
                  }, 300);
                }}
                size="small"
              />
            </div>
            {/* 抽屉内容 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
                <Button
                  type="primary"
                  block
                  onClick={() => {
                    createNewChat();
                    setIsHistoryDrawerClosing(true);
                    setTimeout(() => {
                      setIsHistoryDrawerOpen(false);
                      setIsHistoryDrawerClosing(false);
                    }, 300);
                  }}
                >
                  新建对话
                </Button>
              </Space>
              <List
                dataSource={chatHistories}
                renderItem={(history) => (
                  <List.Item
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      backgroundColor: currentChatId === history.id 
                        ? getThemeColor(theme, 'selectedBg')
                        : 'transparent',
                    }}
                    onClick={() => {
                      loadChatHistory(history.id);
                      setIsHistoryDrawerClosing(true);
                      setTimeout(() => {
                        setIsHistoryDrawerOpen(false);
                        setIsHistoryDrawerClosing(false);
                      }, 300);
                    }}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Text
                          strong={currentChatId === history.id}
                          ellipsis
                          style={{ flex: 1, fontSize: 13 }}
                        >
                          {history.title}
                        </Text>
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          danger
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChatHistory(history.id);
                          }}
                        />
                      </div>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                        {dayjs(history.updatedAt).fromNow()}
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            </div>
            </div>
          </>
        )}

        {/* 底部追问栏 */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: `1px solid ${getThemeColor(theme, 'border')}`,
            background: getThemeColor(theme, 'bgElevated'),
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            flexShrink: 0,
          }}
        >
          <Space.Compact style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={handleKeyPress}
              placeholder="继续提问..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={isStreaming}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={isStreaming}
              disabled={!inputValue.trim() || isStreaming}
              style={{ height: 'auto' }}
            >
              发送
            </Button>
          </Space.Compact>
        </div>
      </div>
    </Modal>
  );

  // 使用 Portal 挂载到 body
  return (
    <>
      {/* 添加 CSS 动画样式 */}
      <style>{`
        @keyframes slideInLeft {
          from {
            transform: translateX(-100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        @keyframes slideOutLeft {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(-100%);
            opacity: 0;
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
      `}</style>
      {createPortal(modalContent, document.body)}
    </>
  );
}
