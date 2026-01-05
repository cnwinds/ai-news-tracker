/**
 * RAG AI对话组件
 */
import { useState, useRef, useEffect } from 'react';
import { Card, Input, Button, List, Typography, Empty, Spin, Alert, Space, Tag, Avatar, Select, Tooltip } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { apiService } from '@/services/api';
import type { RAGQueryRequest, ArticleSearchResult } from '@/types';
import dayjs from 'dayjs';
import { useTheme } from '@/contexts/ThemeContext';
import { createMarkdownComponents } from '@/utils/markdown';
import { getMessageBubbleStyle, getSelectedStyle, getThemeColor } from '@/utils/theme';

const { TextArea } = Input;
const { Text } = Typography;

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  articles?: ArticleSearchResult[];
  sources?: string[];
}

interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

const STORAGE_KEY = 'rag_chat_history';

export default function RAGChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [topK, setTopK] = useState(5);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const { theme } = useTheme();

  // 问答mutation（保留用于非流式查询，作为后备）
  const queryMutation = useMutation({
    mutationFn: (request: RAGQueryRequest) => apiService.queryArticles(request),
  });

  // 从 localStorage 加载聊天历史
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const histories: ChatHistory[] = JSON.parse(saved).map((h: any) => ({
          ...h,
          createdAt: new Date(h.createdAt),
          updatedAt: new Date(h.updatedAt),
          messages: h.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          })),
        }));
        setChatHistories(histories);
      } catch (e) {
        console.error('加载聊天历史失败:', e);
      }
    }
  }, []);

  // 保存聊天历史到 localStorage
  const saveChatHistory = (histories: ChatHistory[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch (e) {
      console.error('保存聊天历史失败:', e);
    }
  };

  // 创建新对话
  const createNewChat = () => {
    setMessages([]);
    setCurrentChatId(null);
  };

  // 加载历史对话
  const loadChatHistory = (chatId: string) => {
    const history = chatHistories.find((h) => h.id === chatId);
    if (history) {
      setMessages(history.messages);
      setCurrentChatId(chatId);
    }
  };

  // 删除历史对话
  const deleteChatHistory = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newHistories = chatHistories.filter((h) => h.id !== chatId);
    setChatHistories(newHistories);
    saveChatHistory(newHistories);
    if (currentChatId === chatId) {
      createNewChat();
    }
  };

  // 更新当前对话的标题（使用第一条用户消息）
  const updateChatTitle = (firstUserMessage: string) => {
    const title = firstUserMessage.length > 30 ? firstUserMessage.substring(0, 30) + '...' : firstUserMessage;
    return title;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim() || queryMutation.isPending || isStreaming) {
      return;
    }

    const question = inputValue.trim();
    setInputValue('');

    // 添加用户消息
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: question,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    // 如果是新对话，创建聊天历史
    let chatId = currentChatId;
    if (!chatId) {
      chatId = Date.now().toString();
      setCurrentChatId(chatId);
      const newHistory: ChatHistory = {
        id: chatId,
        title: updateChatTitle(question),
        messages: newMessages,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedHistories = [newHistory, ...chatHistories];
      setChatHistories(updatedHistories);
      saveChatHistory(updatedHistories);
    }

    // 创建初始的AI消息（用于流式更新）
    const assistantMessageId = (Date.now() + 1).toString();
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      articles: [],
      sources: [],
    };
    setMessages([...newMessages, initialAssistantMessage]);
    setIsStreaming(true);

    // 发送流式请求
    const request: RAGQueryRequest = {
      question,
      top_k: topK,
    };

    let accumulatedContent = '';
    let receivedArticles: ArticleSearchResult[] = [];
    let receivedSources: string[] = [];

    apiService.queryArticlesStream(request, (chunk) => {
      if (chunk.type === 'articles') {
        // 收到文章信息
        receivedArticles = chunk.data.articles || [];
        receivedSources = chunk.data.sources || [];
        
        // 更新消息，添加文章信息
        setMessages((prevMessages) => {
          const updated = prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                articles: receivedArticles,
                sources: receivedSources,
              };
            }
            return msg;
          });
          return updated;
        });
      } else if (chunk.type === 'content') {
        // 收到内容块，累积并更新
        accumulatedContent += chunk.data.content || '';
        
        // 实时更新消息内容
        setMessages((prevMessages) => {
          const updated = prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                content: accumulatedContent,
              };
            }
            return msg;
          });
          return updated;
        });
      } else if (chunk.type === 'done') {
        // 流式输出完成
        setIsStreaming(false);
        
        // 更新聊天历史
        setChatHistories((prevHistories) => {
          const updatedHistories = prevHistories.map((h) => {
            if (h.id === chatId) {
              const finalMessages = [...newMessages, {
                ...initialAssistantMessage,
                content: accumulatedContent,
                articles: receivedArticles,
                sources: receivedSources,
              }];
              return {
                ...h,
                messages: finalMessages,
                updatedAt: new Date(),
              };
            }
            return h;
          });
          // 如果找不到对应的历史记录（新对话），添加它
          if (!updatedHistories.find((h) => h.id === chatId)) {
            updatedHistories.unshift({
              id: chatId!,
              title: updateChatTitle(question),
              messages: [...newMessages, {
                ...initialAssistantMessage,
                content: accumulatedContent,
                articles: receivedArticles,
                sources: receivedSources,
              }],
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          saveChatHistory(updatedHistories);
          return updatedHistories;
        });
      } else if (chunk.type === 'error') {
        // 处理错误
        setIsStreaming(false);
        const errorMessage = chunk.data.message || '未知错误';
        
        setMessages((prevMessages) => {
          const updated = prevMessages.map((msg) => {
            if (msg.id === assistantMessageId) {
              return {
                ...msg,
                content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
              };
            }
            return msg;
          });
          return updated;
        });

        // 更新聊天历史
        setChatHistories((prevHistories) => {
          const updatedHistories = prevHistories.map((h) => {
            if (h.id === chatId) {
              const finalMessages = [...newMessages, {
                ...initialAssistantMessage,
                content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
              }];
              return {
                ...h,
                messages: finalMessages,
                updatedAt: new Date(),
              };
            }
            return h;
          });
          if (!updatedHistories.find((h) => h.id === chatId)) {
            updatedHistories.unshift({
              id: chatId!,
              title: updateChatTitle(question),
              messages: [...newMessages, {
                ...initialAssistantMessage,
                content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
              }],
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          saveChatHistory(updatedHistories);
          return updatedHistories;
        });
      }
    }).catch((error) => {
      // 处理流式请求失败
      setIsStreaming(false);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      setMessages((prevMessages) => {
        const updated = prevMessages.map((msg) => {
          if (msg.id === assistantMessageId) {
            return {
              ...msg,
              content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
            };
          }
          return msg;
        });
        return updated;
      });

      // 更新聊天历史
      setChatHistories((prevHistories) => {
        const updatedHistories = prevHistories.map((h) => {
          if (h.id === chatId) {
            const finalMessages = [...newMessages, {
              ...initialAssistantMessage,
              content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
            }];
            return {
              ...h,
              messages: finalMessages,
              updatedAt: new Date(),
            };
          }
          return h;
        });
        if (!updatedHistories.find((h) => h.id === chatId)) {
          updatedHistories.unshift({
            id: chatId!,
            title: updateChatTitle(question),
            messages: [...newMessages, {
              ...initialAssistantMessage,
              content: `抱歉，处理您的问题时出现错误：${errorMessage}`,
            }],
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        saveChatHistory(updatedHistories);
        return updatedHistories;
      });
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 处理回答文本中的引用格式：将"文章 X"转换为"[X]"，并移除文章标题和来源
  const processAnswerText = (text: string): string => {
    let processed = text;

    // 1. 将"文章 X"或"文章X"转换为"[X]"
    processed = processed.replace(/文章\s*(\d+)/g, '[$1]');

    // 2. 移除类似"——《文章标题》，来源：来源名称"的格式
    // 匹配：——（或长破折号）《标题》，来源：来源名
    processed = processed.replace(/[———]\s*《[^》]+》[，,]\s*来源[：:]\s*[^\n]+/g, '');

    // 3. 移除类似"——《文章标题》"的格式（没有来源的情况）
    processed = processed.replace(/[———]\s*《[^》]+》/g, '');

    return processed;
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 200px)' }}>
      {/* 主聊天区域 */}
      <Card
        title="💬 AI智能问答"
        extra={
          <Space>
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={createNewChat}
              title="新建对话"
            >
              新对话
            </Button>
            <Text type="secondary">检索数量：</Text>
            <Select
              value={topK}
              onChange={setTopK}
              style={{ width: 80 }}
              options={[
                { label: '3', value: 3 },
                { label: '5', value: 5 },
                { label: '10', value: 10 },
              ]}
            />
          </Space>
        }
        style={{ flex: 1, minHeight: 600, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 消息列表 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            marginBottom: 16,
            padding: '0 8px',
          }}
        >
          {messages.length === 0 ? (
            <Empty
              description="开始与AI对话，询问关于文章内容的问题"
              style={{ marginTop: 100 }}
            />
          ) : (
            <List
              dataSource={messages}
              renderItem={(message) => (
                <List.Item style={{ border: 'none', padding: '12px 0' }}>
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: message.type === 'user' ? 'row-reverse' : 'row',
                      gap: 12,
                    }}
                  >
                    <Avatar
                      icon={message.type === 'user' ? <UserOutlined /> : <RobotOutlined />}
                      style={{
                        backgroundColor: message.type === 'user' ? getThemeColor(theme, 'userAvatarBg') : getThemeColor(theme, 'assistantAvatarBg'),
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        maxWidth: '75%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: message.type === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          ...getMessageBubbleStyle(theme, message.type),
                          padding: '12px 16px',
                          borderRadius: '12px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {message.type === 'assistant' ? (
                          <div>
                            <ReactMarkdown components={createMarkdownComponents(theme)}>
                              {processAnswerText(message.content)}
                            </ReactMarkdown>
                            {isStreaming && message.id === messages[messages.length - 1]?.id && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: '2px',
                                  height: '1em',
                                  backgroundColor: getThemeColor(theme, 'assistantMessageText'),
                                  marginLeft: '2px',
                                  verticalAlign: 'baseline',
                                  animation: 'blink 1s step-end infinite',
                                }}
                              />
                            )}
                          </div>
                        ) : (
                          <Text style={{ color: getThemeColor(theme, 'userMessageText') }}>
                            {message.content}
                          </Text>
                        )}
                      </div>

                      {/* 引用来源 */}
                      {message.type === 'assistant' && message.articles && message.articles.length > 0 && (
                        <div style={{ marginTop: 8, width: '100%' }}>
                          <Text
                            type="secondary"
                            style={{
                              fontSize: 12,
                              marginBottom: 4,
                              display: 'inline',
                              color: getThemeColor(theme, 'textSecondary'),
                              marginRight: 8,
                            }}
                          >
                            参考来源：
                          </Text>
                          <Space size={[8, 4]} wrap style={{ display: 'inline-flex' }}>
                            {message.articles.map((article, idx) => {
                              const articleNumber = idx + 1;
                              const primaryColor = getThemeColor(theme, 'primary');
                              return (
                                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                  <a
                                    href={article.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      color: primaryColor,
                                      textDecoration: 'none',
                                      fontWeight: 500,
                                      fontSize: 12,
                                      marginRight: 4,
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.textDecoration = 'underline';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.textDecoration = 'none';
                                    }}
                                  >
                                    [{articleNumber}]
                                  </a>
                                  {article.title_zh ? (
                                    <Tooltip title={article.title} placement="top">
                                      <Text style={{
                                        fontSize: 12,
                                        color: getThemeColor(theme, 'textSecondary'),
                                        cursor: 'help',
                                        marginRight: 4,
                                      }}>
                                        {article.title_zh}
                                      </Text>
                                    </Tooltip>
                                  ) : (
                                    <Text style={{
                                      fontSize: 12,
                                      color: getThemeColor(theme, 'textSecondary'),
                                      marginRight: 4,
                                    }}>
                                      {article.title}
                                    </Text>
                                  )}
                                  <Tag color="blue" style={{ fontSize: 11, padding: '0 4px', margin: 0, lineHeight: '18px' }}>
                                    {article.source}
                                  </Tag>
                                </span>
                              );
                            })}
                          </Space>
                        </div>
                      )}

                      <Text
                        type="secondary"
                        style={{
                          fontSize: 11,
                          marginTop: 4,
                          textAlign: message.type === 'user' ? 'right' : 'left',
                        }}
                      >
                        {dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
          {(queryMutation.isPending || (isStreaming && messages.length > 0 && messages[messages.length - 1]?.type === 'assistant' && !messages[messages.length - 1]?.content)) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
              <Avatar icon={<RobotOutlined />} style={{ backgroundColor: getThemeColor(theme, 'assistantAvatarBg'), flexShrink: 0 }} />
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
                  {isStreaming ? '正在生成回答...' : '正在思考...'}
                </Text>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div>
          {queryMutation.error && (
            <Alert
              message="请求失败"
              description={queryMutation.error instanceof Error ? queryMutation.error.message : '未知错误'}
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
            />
          )}
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={handleKeyPress}
              placeholder="输入您的问题，例如：最近有哪些关于大语言模型的重要突破？"
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={queryMutation.isPending || isStreaming}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={queryMutation.isPending || isStreaming}
              disabled={!inputValue.trim() || queryMutation.isPending || isStreaming}
              style={{ height: 'auto' }}
            >
              发送
            </Button>
          </Space.Compact>
        </div>
      </Card>

      {/* 历史记录侧边栏 */}
      <Card
        title="💭 聊天记录"
        style={{ width: 300, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {chatHistories.length === 0 ? (
            <Empty
              description="暂无聊天记录"
              style={{ marginTop: 50 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <List
              dataSource={chatHistories}
              renderItem={(history) => (
                <List.Item
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    ...(currentChatId === history.id ? getSelectedStyle(theme) : {}),
                  }}
                  onClick={() => loadChatHistory(history.id)}
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
                        onClick={(e) => deleteChatHistory(history.id, e)}
                        style={{ flexShrink: 0, marginLeft: 8 }}
                      />
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                      {dayjs(history.updatedAt).format('MM-DD HH:mm')}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {history.messages.length} 条消息
                    </Text>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
