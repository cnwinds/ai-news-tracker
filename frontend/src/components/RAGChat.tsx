/**
 * RAG AI对话组件
 */
import { useState, useRef, useEffect } from 'react';
import { Card, Input, Button, List, Typography, Empty, Spin, Alert, Space, Tag, Avatar, Select } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined, LinkOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { apiService } from '@/services/api';
import type { RAGQueryRequest, RAGQueryResponse, ArticleSearchResult } from '@/types';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Text, Title } = Typography;

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

  // 问答mutation
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
    if (!inputValue.trim() || queryMutation.isPending) {
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

    // 发送请求
    const request: RAGQueryRequest = {
      question,
      top_k: topK,
    };

    queryMutation.mutate(request, {
      onSuccess: (response: RAGQueryResponse) => {
        // 添加AI回复
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: response.answer,
          timestamp: new Date(),
          articles: response.articles,
          sources: response.sources,
        };
        const finalMessages = [...newMessages, assistantMessage];
        setMessages(finalMessages);

        // 更新聊天历史（使用函数式更新确保使用最新状态）
        setChatHistories((prevHistories) => {
          const updatedHistories = prevHistories.map((h) => {
            if (h.id === chatId) {
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
              messages: finalMessages,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          saveChatHistory(updatedHistories);
          return updatedHistories;
        });
      },
      onError: (error) => {
        // 添加错误消息
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: `抱歉，处理您的问题时出现错误：${error instanceof Error ? error.message : '未知错误'}`,
          timestamp: new Date(),
        };
        const finalMessages = [...newMessages, errorMessage];
        setMessages(finalMessages);

        // 更新聊天历史（使用函数式更新确保使用最新状态）
        setChatHistories((prevHistories) => {
          const updatedHistories = prevHistories.map((h) => {
            if (h.id === chatId) {
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
              messages: finalMessages,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          saveChatHistory(updatedHistories);
          return updatedHistories;
        });
      },
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const importanceColors: Record<string, string> = {
    high: 'red',
    medium: 'orange',
    low: 'green',
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
                        backgroundColor: message.type === 'user' ? '#1890ff' : '#52c41a',
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
                          backgroundColor: message.type === 'user' ? '#1890ff' : '#f0f0f0',
                          color: message.type === 'user' ? '#fff' : '#000',
                          padding: '12px 16px',
                          borderRadius: '12px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {message.type === 'assistant' ? (
                          <div>
                            <ReactMarkdown
                              components={{
                                p: ({ children }) => <p style={{ marginBottom: '0.5em', marginTop: 0 }}>{children}</p>,
                                strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                                ul: ({ children }) => <ul style={{ marginBottom: '0.5em', paddingLeft: '1.5em' }}>{children}</ul>,
                                ol: ({ children }) => <ol style={{ marginBottom: '0.5em', paddingLeft: '1.5em' }}>{children}</ol>,
                                li: ({ children }) => <li style={{ marginBottom: '0.25em' }}>{children}</li>,
                                code: ({ children }) => (
                                  <code
                                    style={{
                                      backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                      padding: '2px 4px',
                                      borderRadius: '3px',
                                      fontSize: '0.9em',
                                    }}
                                  >
                                    {children}
                                  </code>
                                ),
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <Text style={{ color: message.type === 'user' ? '#fff' : '#000' }}>
                            {message.content}
                          </Text>
                        )}
                      </div>

                      {/* 引用来源 */}
                      {message.type === 'assistant' && message.articles && message.articles.length > 0 && (
                        <div style={{ marginTop: 12, width: '100%' }}>
                          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
                            参考来源：
                          </Text>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            {message.articles.map((article, idx) => (
                              <Card
                                key={idx}
                                size="small"
                                style={{
                                  backgroundColor: '#fafafa',
                                  border: '1px solid #e8e8e8',
                                }}
                              >
                                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                    {article.importance && (
                                      <Tag color={importanceColors[article.importance]}>
                                        {article.importance === 'high' ? '高' : article.importance === 'medium' ? '中' : '低'}
                                      </Tag>
                                    )}
                                    <Tag color="blue">{article.source}</Tag>
                                  </div>
                                  <Title level={5} style={{ marginBottom: 4, fontSize: 14 }}>
                                    {article.title_zh || article.title}
                                  </Title>
                                  {article.summary && (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: 'rgba(0, 0, 0, 0.65)',
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      <ReactMarkdown
                                        components={{
                                          p: ({ children }) => <p style={{ marginBottom: '0.25em', marginTop: 0, fontSize: 12 }}>{children}</p>,
                                          strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                                          h1: ({ children }) => <h1 style={{ fontSize: '1.2em', fontWeight: 600, marginBottom: '0.25em', marginTop: 0 }}>{children}</h1>,
                                          h2: ({ children }) => <h2 style={{ fontSize: '1.1em', fontWeight: 600, marginBottom: '0.25em', marginTop: 0 }}>{children}</h2>,
                                          h3: ({ children }) => <h3 style={{ fontSize: '1em', fontWeight: 600, marginBottom: '0.25em', marginTop: 0 }}>{children}</h3>,
                                          code: ({ children }) => <code style={{ backgroundColor: '#f5f5f5', padding: '1px 3px', borderRadius: '2px', fontSize: '0.85em' }}>{children}</code>,
                                          a: ({ href, children }) => (
                                            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff', fontSize: 12 }}>
                                              {children}
                                            </a>
                                          ),
                                        }}
                                      >
                                        {article.summary.length > 100
                                          ? `${article.summary.substring(0, 100)}...`
                                          : article.summary}
                                      </ReactMarkdown>
                                    </div>
                                  )}
                                  <Button
                                    type="link"
                                    icon={<LinkOutlined />}
                                    href={article.url}
                                    target="_blank"
                                    size="small"
                                    style={{ padding: 0 }}
                                  >
                                    查看原文
                                  </Button>
                                </Space>
                              </Card>
                            ))}
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
          {queryMutation.isPending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
              <Avatar icon={<RobotOutlined />} style={{ backgroundColor: '#52c41a', flexShrink: 0 }} />
              <div style={{ backgroundColor: '#f0f0f0', padding: '12px 16px', borderRadius: '12px' }}>
                <Spin size="small" /> <Text style={{ marginLeft: 8 }}>正在思考...</Text>
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
              disabled={queryMutation.isPending}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={queryMutation.isPending}
              disabled={!inputValue.trim()}
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
                    backgroundColor: currentChatId === history.id ? '#e6f7ff' : 'transparent',
                    borderLeft: currentChatId === history.id ? '3px solid #1890ff' : '3px solid transparent',
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
