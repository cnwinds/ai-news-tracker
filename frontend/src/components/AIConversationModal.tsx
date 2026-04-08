import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Avatar,
  Button,
  Collapse,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  HistoryOutlined,
  RobotOutlined,
  SendOutlined,
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { apiService } from '@/services/api';
import { useAIConversation, type Message } from '@/contexts/AIConversationContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getThemeColor, getMessageBubbleStyle } from '@/utils/theme';
import { createMarkdownComponents, remarkGfm } from '@/utils/markdown';
import type {
  AIQueryEngine,
  ArticleSearchResult,
  KnowledgeGraphArticleReference,
  RAGQueryRequest,
} from '@/types';

dayjs.extend(relativeTime);

const { TextArea } = Input;
const { Text } = Typography;

type ReferenceArticle = ArticleSearchResult | KnowledgeGraphArticleReference;

function buildErrorText(message: string) {
  return `抱歉，处理当前问题时出现错误：${message}`;
}

function getReferenceArticles(message: Message): ReferenceArticle[] {
  if (message.relatedArticles && message.relatedArticles.length > 0) {
    return message.relatedArticles;
  }
  return message.articles || [];
}

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
    selectedEngine,
    setSelectedEngine,
  } = useAIConversation();
  const { focusArticle, focusCommunity, focusNode } = useKnowledgeGraphView();

  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isHistoryDrawerClosing, setIsHistoryDrawerClosing] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasAutoTriggeredRef = useRef(false);
  const topK = 5;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, isStreaming, scrollToBottom]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const finishAssistantMessage = useCallback((
    chatId: string,
    existingMessages: Message[],
    assistantMessage: Message,
  ) => {
    const finalMessages = [...existingMessages, assistantMessage];
    setCurrentMessages(finalMessages);
    updateChatHistory(chatId, finalMessages);
  }, [setCurrentMessages, updateChatHistory]);

  const updateAssistantMessage = useCallback((assistantMessageId: string, updater: (message: Message) => Message) => {
    setCurrentMessages((previous) =>
      previous.map((message) => (message.id === assistantMessageId ? updater(message) : message))
    );
  }, [setCurrentMessages]);

  const sendAIRequest = useCallback((
    question: string,
    existingMessages: Message[],
    engine: AIQueryEngine
  ) => {
    if (!question.trim() || isStreaming) {
      return;
    }

    let chatId = currentChatId;
    if (!chatId) {
      chatId = Date.now().toString();
      setCurrentChatId(chatId);
    }

    const assistantMessageId = `${Date.now()}-assistant`;
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      engine,
      resolvedMode: engine === 'rag' ? 'rag' : undefined,
      articles: [],
      sources: [],
      matchedNodes: [],
      matchedCommunities: [],
      relatedArticles: [],
      contextNodeCount: 0,
      contextEdgeCount: 0,
    };

    setCurrentMessages([...existingMessages, initialAssistantMessage]);
    setIsStreaming(true);

    const conversationHistory = existingMessages
      .filter((message) => message.type === 'user' || message.type === 'assistant')
      .map((message) => ({
        role: message.type === 'user' ? 'user' as const : 'assistant' as const,
        content: message.content,
      }));

    const request: RAGQueryRequest = {
      question: question.trim(),
      top_k: topK,
      conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
    };

    let accumulatedContent = '';
    let receivedArticles: ArticleSearchResult[] = [];
    let receivedSources: string[] = [];
    let relatedArticles: KnowledgeGraphArticleReference[] = [];
    let matchedNodes = initialAssistantMessage.matchedNodes || [];
    let matchedCommunities = initialAssistantMessage.matchedCommunities || [];
    let resolvedMode: AIQueryEngine = initialAssistantMessage.resolvedMode || engine;
    let contextNodeCount = 0;
    let contextEdgeCount = 0;

    const finalizeSuccess = () => {
      setIsStreaming(false);
      finishAssistantMessage(chatId!, existingMessages, {
        ...initialAssistantMessage,
        content: accumulatedContent,
        articles: receivedArticles,
        sources: receivedSources,
        relatedArticles,
        matchedNodes,
        matchedCommunities,
        resolvedMode,
        contextNodeCount,
        contextEdgeCount,
      });
    };

    const finalizeError = (errorMessage: string) => {
      setIsStreaming(false);
      const errorText = buildErrorText(errorMessage);
      const finalAssistantMessage: Message = {
        ...initialAssistantMessage,
        content: errorText,
        articles: receivedArticles,
        sources: receivedSources,
        relatedArticles,
        matchedNodes,
        matchedCommunities,
        resolvedMode,
        contextNodeCount,
        contextEdgeCount,
      };
      updateAssistantMessage(assistantMessageId, () => finalAssistantMessage);
      finishAssistantMessage(chatId!, existingMessages, finalAssistantMessage);
    };

    if (engine === 'rag') {
      apiService.queryArticlesStream(request, (chunk) => {
        if (chunk.type === 'articles') {
          receivedArticles = chunk.data.articles || [];
          receivedSources = chunk.data.sources || [];
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            articles: receivedArticles,
            sources: receivedSources,
          }));
          return;
        }

        if (chunk.type === 'content') {
          accumulatedContent += chunk.data.content || '';
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            content: accumulatedContent,
          }));
          return;
        }

        if (chunk.type === 'done') {
          finalizeSuccess();
          return;
        }

        if (chunk.type === 'error') {
          finalizeError(chunk.data.message || '未知错误');
        }
      }).catch((error) => {
        finalizeError(error instanceof Error ? error.message : '未知错误');
      });
      return;
    }

    apiService.queryKnowledgeGraphStream(
      {
        question: question.trim(),
        mode: engine,
        top_k: topK,
        query_depth: undefined,
        conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
      },
      (chunk) => {
        if (chunk.type === 'graph_context') {
          matchedNodes = chunk.data.matched_nodes || [];
          matchedCommunities = chunk.data.matched_communities || [];
          relatedArticles = chunk.data.related_articles || [];
          resolvedMode = chunk.data.resolved_mode || engine;
          contextNodeCount = chunk.data.context_node_count || 0;
          contextEdgeCount = chunk.data.context_edge_count || 0;
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            matchedNodes,
            matchedCommunities,
            relatedArticles,
            resolvedMode,
            contextNodeCount,
            contextEdgeCount,
          }));
          return;
        }

        if (chunk.type === 'content') {
          accumulatedContent += chunk.data.content || '';
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            content: accumulatedContent,
          }));
          return;
        }

        if (chunk.type === 'done') {
          finalizeSuccess();
          return;
        }

        if (chunk.type === 'error') {
          finalizeError(chunk.data.message || '未知错误');
        }
      }
    ).catch((error) => {
      finalizeError(error instanceof Error ? error.message : '未知错误');
    });
  }, [
    currentChatId,
    finishAssistantMessage,
    isStreaming,
    setCurrentChatId,
    setCurrentMessages,
    updateAssistantMessage,
  ]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) {
      return;
    }

    const question = inputValue.trim();
    setInputValue('');

    const userMessage: Message = {
      id: `${Date.now()}-user`,
      type: 'user',
      content: question,
      timestamp: new Date(),
      engine: selectedEngine,
    };

    const nextMessages = [...currentMessages, userMessage];
    setCurrentMessages(nextMessages);
    sendAIRequest(question, nextMessages, selectedEngine);
  }, [currentMessages, inputValue, isStreaming, selectedEngine, sendAIRequest, setCurrentMessages]);

  useEffect(() => {
    if (!isModalOpen) {
      hasAutoTriggeredRef.current = false;
      return;
    }

    if (hasAutoTriggeredRef.current) {
      return;
    }

    if (
      !currentChatId &&
      currentMessages.length === 1 &&
      currentMessages[0].type === 'user' &&
      !isStreaming
    ) {
      const initialMessage = currentMessages[0];
      hasAutoTriggeredRef.current = true;
      setTimeout(() => {
        sendAIRequest(
          initialMessage.content,
          currentMessages,
          initialMessage.engine || selectedEngine
        );
      }, 80);
    }
  }, [currentChatId, currentMessages, isModalOpen, isStreaming, selectedEngine, sendAIRequest]);

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const modalStyle: React.CSSProperties = {
    top: 0,
    paddingBottom: 0,
    maxWidth: isMobile ? '100%' : '980px',
    margin: isMobile ? 0 : '0 auto',
  };

  const modalBodyStyle: React.CSSProperties = {
    padding: 0,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: theme === 'dark' ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.96)',
    backdropFilter: 'blur(10px)',
  };

  if (!isModalOpen) {
    return null;
  }

  const modalContent = (
    <Modal
      open={isModalOpen}
      onCancel={closeModal}
      footer={null}
      closable={false}
      width="100%"
      style={modalStyle}
      styles={{
        body: modalBodyStyle,
        mask: {
          backgroundColor: theme === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(10px)',
        },
      }}
    >
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
          gap: 12,
        }}
      >
        <Space>
          <Button
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => {
              setIsHistoryDrawerClosing(false);
              setIsHistoryDrawerOpen(true);
            }}
          >
            历史
          </Button>
          <Text strong style={{ color: getThemeColor(theme, 'text') }}>
            {currentMessages.find((message) => message.type === 'user')?.content || 'AI 对话'}
          </Text>
        </Space>
        <Button type="text" icon={<CloseOutlined />} onClick={closeModal} />
      </div>

      <div
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? '16px' : '24px',
            maxWidth: isMobile ? '100%' : '860px',
            margin: '0 auto',
            width: '100%',
          }}
        >
          {currentMessages.length === 0 ? (
            <Empty
              description="开始和 AI 对话，或从历史记录继续之前的话题"
              style={{ marginTop: 120 }}
            />
          ) : (
            <List
              dataSource={currentMessages}
              renderItem={(message) => {
                const isUser = message.type === 'user';
                const referenceArticles = getReferenceArticles(message);

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
                          maxWidth: '78%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isUser ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {!isUser && (
                          <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
                            {message.engine && <Tag>{message.engine}</Tag>}
                            {message.resolvedMode && <Tag color="blue">实际模式: {message.resolvedMode}</Tag>}
                            {typeof message.contextNodeCount === 'number' && message.contextNodeCount > 0 && (
                              <Tag>节点 {message.contextNodeCount}</Tag>
                            )}
                            {typeof message.contextEdgeCount === 'number' && message.contextEdgeCount > 0 && (
                              <Tag>边 {message.contextEdgeCount}</Tag>
                            )}
                          </Space>
                        )}

                        {!isUser && (message.matchedNodes?.length || message.matchedCommunities?.length) ? (
                          <div style={{ marginBottom: 8, width: '100%' }}>
                            <CardLike theme={theme}>
                              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                <div>
                                  <Text strong>命中节点</Text>
                                    <div style={{ marginTop: 8 }}>
                                      {message.matchedNodes?.length ? (
                                        message.matchedNodes.map((node) => (
                                          <Tag
                                            key={node.node_key}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => focusNode(node.node_key)}
                                          >
                                            {node.label} / {node.node_type}
                                          </Tag>
                                        ))
                                    ) : (
                                      <Text type="secondary">暂无</Text>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <Text strong>命中社区</Text>
                                    <div style={{ marginTop: 8 }}>
                                      {message.matchedCommunities?.length ? (
                                        message.matchedCommunities.map((community) => (
                                          <Tag
                                            key={community.community_id}
                                            color="blue"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => focusCommunity(community.community_id)}
                                          >
                                            {community.label}
                                          </Tag>
                                        ))
                                    ) : (
                                      <Text type="secondary">暂无</Text>
                                    )}
                                  </div>
                                </div>
                              </Space>
                            </CardLike>
                          </div>
                        ) : null}

                        {!isUser && referenceArticles.length > 0 && (
                          <div style={{ marginBottom: 8, width: '100%' }}>
                            <Collapse
                              ghost
                              size="small"
                              activeKey={expandedPanels[message.id] ? ['refs'] : []}
                              onChange={(keys) => {
                                setExpandedPanels((previous) => ({
                                  ...previous,
                                  [message.id]: keys.includes('refs'),
                                }));
                              }}
                              items={[
                                {
                                  key: 'refs',
                                  label: (
                                    <Space size={6}>
                                      <Text type="secondary">参考上下文 ({referenceArticles.length})</Text>
                                      {expandedPanels[message.id] ? (
                                        <UpOutlined style={{ fontSize: 10 }} />
                                      ) : (
                                        <DownOutlined style={{ fontSize: 10 }} />
                                      )}
                                    </Space>
                                  ),
                                  children: (
                                    <List
                                      size="small"
                                      dataSource={referenceArticles}
                                      renderItem={(article) => {
                                        const hasRelationCount = 'relation_count' in article;
                                        const hasSimilarity = 'similarity' in article;
                                        return (
                                          <List.Item
                                            style={{ paddingInline: 0 }}
                                            actions={[
                                              <Button
                                                key="focus-reference-article"
                                                type="link"
                                                size="small"
                                                onClick={() => focusArticle(article.id)}
                                              >
                                                图谱定位
                                              </Button>,
                                            ]}
                                          >
                                            <Space direction="vertical" size={0} style={{ width: '100%' }}>
                                              <a href={article.url} target="_blank" rel="noreferrer">
                                                {article.title_zh || article.title}
                                              </a>
                                              <Text type="secondary">
                                                {article.source}
                                                {hasRelationCount ? ` · 关系数 ${article.relation_count}` : ''}
                                                {hasSimilarity && article.similarity
                                                  ? ` · 相似度 ${Math.round(article.similarity * 100)}%`
                                                  : ''}
                                              </Text>
                                            </Space>
                                          </List.Item>
                                        );
                                      }}
                                    />
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
                            borderRadius: 12,
                            width: '100%',
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
                                components={createMarkdownComponents(theme)}
                                remarkPlugins={[remarkGfm]}
                              >
                                {message.content}
                              </ReactMarkdown>
                              {isStreaming && message.id === currentMessages[currentMessages.length - 1]?.id && (
                                <span
                                  style={{
                                    display: 'inline-block',
                                    width: 2,
                                    height: '1em',
                                    backgroundColor: getThemeColor(theme, 'assistantMessageText'),
                                    marginLeft: 2,
                                    animation: 'blink 1s step-end infinite',
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>

                        <Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
                          {dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                        </Text>
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}

          {isStreaming && currentMessages[currentMessages.length - 1]?.type !== 'assistant' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
              <Avatar
                icon={<RobotOutlined />}
                style={{ backgroundColor: getThemeColor(theme, 'assistantAvatarBg') }}
              />
              <div
                style={{
                  ...getMessageBubbleStyle(theme, 'assistant'),
                  padding: '12px 16px',
                  borderRadius: 12,
                }}
              >
                <Spin size="small" />
                <Text style={{ marginLeft: 8 }}>正在生成回答...</Text>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {(isHistoryDrawerOpen || isHistoryDrawerClosing) && (
          <>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.15)',
                zIndex: 1000,
                animation: isHistoryDrawerClosing ? 'fadeOut 0.3s ease-out forwards' : 'fadeIn 0.3s ease-out',
              }}
              onClick={() => {
                setIsHistoryDrawerClosing(true);
                setTimeout(() => {
                  setIsHistoryDrawerOpen(false);
                  setIsHistoryDrawerClosing(false);
                }, 300);
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: 320,
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
              <div
                style={{
                  padding: 16,
                  borderBottom: `1px solid ${getThemeColor(theme, 'border')}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text strong style={{ fontSize: 16 }}>
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
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
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
                  style={{ marginBottom: 16 }}
                >
                  新建对话
                </Button>

                <List
                  dataSource={chatHistories}
                  renderItem={(history) => (
                    <List.Item
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        backgroundColor:
                          currentChatId === history.id ? getThemeColor(theme, 'selectedBg') : 'transparent',
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
                          <Text strong={currentChatId === history.id} ellipsis style={{ flex: 1 }}>
                            {history.title}
                          </Text>
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            danger
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteChatHistory(history.id);
                            }}
                          />
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
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
          <Space direction="vertical" size="small" style={{ width: '100%', maxWidth: 860, margin: '0 auto' }}>
            <Space wrap>
              <Text type="secondary">问答引擎</Text>
              <Select<AIQueryEngine>
                value={selectedEngine}
                onChange={setSelectedEngine}
                style={{ minWidth: 180 }}
                options={[
                  { label: '自动', value: 'auto' },
                  { label: 'RAG', value: 'rag' },
                  { label: 'Graph', value: 'graph' },
                  { label: 'Hybrid', value: 'hybrid' },
                ]}
              />
            </Space>

            <Space.Compact style={{ width: '100%' }}>
              <TextArea
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
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
          </Space>
        </div>
      </div>
    </Modal>
  );

  return (
    <>
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutLeft {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(-100%); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes blink {
          from { opacity: 1; }
          50% { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      {createPortal(modalContent, document.body)}
    </>
  );
}

function CardLike({ children, theme }: { children: ReactNode; theme: 'light' | 'dark' }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${getThemeColor(theme, 'border')}`,
        background: getThemeColor(theme, 'bgSecondary'),
      }}
    >
      {children}
    </div>
  );
}
