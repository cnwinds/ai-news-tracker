/**
 * RAG AI对话组件
 */
import { useState, useRef, useEffect } from 'react';
import { Input, Button, Alert, Select } from 'antd';
import { ArrowUpOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { RAGQueryRequest, ArticleSearchResult } from '@/types';
import dayjs from 'dayjs';
import { Markdown } from '@/utils/markdown';
import {
  AssistantMark,
  ComposerHint,
  HistoryList,
  ReferenceCards,
  ThinkingIndicator,
} from '@/components/assistant/ChatParts';
import '@/styles/pages/assistant.css';

const { TextArea } = Input;

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

  // 问答mutation（保留用于非流式查询，作为后备）
  const queryMutation = useMutation({
    mutationFn: (request: RAGQueryRequest) => apiService.queryArticles(request),
  });

  // 从 localStorage 加载聊天历史
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsedHistories = JSON.parse(saved) as Array<Omit<ChatHistory, 'createdAt' | 'updatedAt'> & {
          createdAt: string;
          updatedAt: string;
          messages: Array<Omit<Message, 'timestamp'> & { timestamp: string }>;
        }>;
        const histories: ChatHistory[] = parsedHistories.map((h) => ({
          ...h,
          createdAt: new Date(h.createdAt),
          updatedAt: new Date(h.updatedAt),
          messages: h.messages.map((m) => ({
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

  const lastMessage = messages[messages.length - 1];
  const isBusy = queryMutation.isPending || isStreaming;
  const showThinking =
    queryMutation.isPending ||
    (isStreaming && messages.length > 0 && lastMessage?.type === 'assistant' && !lastMessage?.content);

  return (
    <div className="rag-chat">
      {/* 历史记录侧栏 */}
      <aside className="ai-rail">
        <div className="ai-rail__head">
          <span className="eyebrow">聊天记录</span>
          <span className="ai-rail__head-actions mono u-tnum u-muted">{chatHistories.length}</span>
        </div>
        <div className="ai-rail__new">
          <Button block icon={<PlusOutlined />} onClick={createNewChat}>
            新对话
          </Button>
        </div>
        <div className="ai-rail__list">
          <HistoryList
            histories={chatHistories}
            currentChatId={currentChatId}
            onSelect={loadChatHistory}
            onDelete={deleteChatHistory}
            showCount
            emptyText="暂无聊天记录"
          />
        </div>
      </aside>

      {/* 主聊天区域 */}
      <section className="ai-main">
        <header className="ai-main__head">
          <div className="ai-main__title-wrap">
            <span className="eyebrow">AI 智能问答</span>
            <span className="ai-main__title">
              {messages.find((message) => message.type === 'user')?.content || '新对话'}
            </span>
          </div>
        </header>

        {/* 消息列表 */}
        <div className="ai-thread">
          <div className="ai-thread__inner">
            {messages.length === 0 ? (
              <div className="ai-welcome">
                <AssistantMark size="lg" />
                <h2 className="ai-welcome__title">询问资讯库</h2>
                <p className="ai-welcome__desc">开始与 AI 对话，询问关于文章内容的问题。</p>
              </div>
            ) : (
              messages.map((message) => {
                const timestamp = dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss');

                if (message.type === 'user') {
                  return (
                    <div key={message.id} className="ai-msg ai-msg--user">
                      <div className="ai-bubble">{message.content}</div>
                      <span className="ai-msg__time mono u-tnum">{timestamp}</span>
                    </div>
                  );
                }

                const isLive = isStreaming && message.id === lastMessage?.id;
                if (isLive && !message.content) {
                  return null;
                }

                return (
                  <div key={message.id} className="ai-msg ai-msg--assistant">
                    <AssistantMark />
                    <div className="ai-msg__main">
                      <div className="ai-msg__head">
                        <span className="ai-msg__name">AI 助手</span>
                        <span className="ai-msg__time mono u-tnum">{timestamp}</span>
                      </div>

                      <div className={`ai-answer${isLive ? ' ai-answer--streaming' : ''}`}>
                        <Markdown>{processAnswerText(message.content)}</Markdown>
                      </div>

                      {/* 引用来源 */}
                      {message.articles && message.articles.length > 0 && (
                        <div className="ai-refs ai-refs--open">
                          <div className="ai-refs__toggle ai-refs__toggle--static">
                            <LinkOutlined className="ai-refs__icon" />
                            <span>参考来源</span>
                            <span className="mono u-tnum ai-refs__count">{message.articles.length}</span>
                          </div>
                          <ReferenceCards articles={message.articles} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {showThinking && (
              <div className="ai-msg ai-msg--assistant">
                <AssistantMark />
                <div className="ai-msg__main">
                  <ThinkingIndicator label={isStreaming ? '正在生成回答…' : '正在思考…'} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区域 */}
        <footer className="ai-composer">
          {queryMutation.error && (
            <Alert
              className="ai-composer__alert"
              message="请求失败"
              description={queryMutation.error instanceof Error ? queryMutation.error.message : '未知错误'}
              type="error"
              showIcon
            />
          )}
          <div className="ai-composer__box">
            <TextArea
              variant="borderless"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={handleKeyPress}
              placeholder="输入您的问题，例如：最近有哪些关于大语言模型的重要突破？"
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={isBusy}
            />
            <div className="ai-composer__bar">
              <span className="ai-composer__field">
                <span>检索数量</span>
                <Select
                  className="ai-composer__engine"
                  size="small"
                  variant="borderless"
                  value={topK}
                  onChange={setTopK}
                  popupMatchSelectWidth={false}
                  options={[
                    { label: '3', value: 3 },
                    { label: '5', value: 5 },
                    { label: '10', value: 10 },
                  ]}
                />
              </span>
              <ComposerHint />
              <Button
                type="primary"
                shape="circle"
                className="ai-composer__send"
                icon={<ArrowUpOutlined />}
                aria-label="发送"
                onClick={handleSend}
                loading={isBusy}
                disabled={!inputValue.trim() || isBusy}
              />
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
