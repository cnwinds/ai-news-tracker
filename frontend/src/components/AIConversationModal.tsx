import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Modal, Select, Tooltip } from 'antd';
import {
  ArrowUpOutlined,
  CloseOutlined,
  DownOutlined,
  HistoryOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { apiService } from '@/services/api';
import { useAIConversation, type Message } from '@/contexts/AIConversationContext';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Markdown } from '@/utils/markdown';
import {
  AssistantMark,
  ComposerHint,
  HistoryList,
  ReferenceCards,
  ThinkingIndicator,
} from '@/components/assistant/ChatParts';
import type {
  AIQueryEngine,
  ArticleSearchResult,
  RAGQueryRequest,
} from '@/types';
import '@/styles/pages/assistant.css';

dayjs.extend(relativeTime);

const { TextArea } = Input;

type ReferenceArticle = ArticleSearchResult;

const RAIL_COLLAPSED_KEY = 'ai_conversation_rail_collapsed';
const HISTORY_DRAWER_ANIMATION_MS = 260;

const SUGGESTIONS = [
  '最近一周有哪些重要的大模型发布？',
  '总结今天值得关注的 AI 行业动态',
  '最近有哪些热门的开源 AI 项目？',
];

function buildErrorText(message: string) {
  return `抱歉，处理当前问题时出现错误：${message}`;
}

function getReferenceArticles(message: Message): ReferenceArticle[] {
  return message.articles || [];
}

export default function AIConversationModal() {
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

  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isHistoryDrawerClosing, setIsHistoryDrawerClosing] = useState(false);
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({});
  const [isRailCollapsed, setIsRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { isMobile } = useBreakpoint();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasAutoTriggeredRef = useRef(false);
  const topK = 5;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, isStreaming, scrollToBottom]);

  const toggleRail = useCallback(() => {
    setIsRailCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const openHistoryDrawer = useCallback(() => {
    setIsHistoryDrawerClosing(false);
    setIsHistoryDrawerOpen(true);
  }, []);

  const closeHistoryDrawer = useCallback(() => {
    setIsHistoryDrawerClosing(true);
    setTimeout(() => {
      setIsHistoryDrawerOpen(false);
      setIsHistoryDrawerClosing(false);
    }, HISTORY_DRAWER_ANIMATION_MS);
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
      resolvedMode: engine === 'rag' || engine === 'auto' ? 'rag' : undefined,
      articles: [],
      sources: [],
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
        resolvedMode,
        contextNodeCount,
        contextEdgeCount,
      };
      updateAssistantMessage(assistantMessageId, () => finalAssistantMessage);
      finishAssistantMessage(chatId!, existingMessages, finalAssistantMessage);
    };

    apiService.queryArticlesStream(request, (chunk) => {
      if (chunk.type === 'articles') {
        receivedArticles = chunk.data.articles || [];
        receivedSources = chunk.data.sources || [];
        resolvedMode = 'rag';
        updateAssistantMessage(assistantMessageId, (message) => ({
          ...message,
          articles: receivedArticles,
          sources: receivedSources,
          resolvedMode,
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

  if (!isModalOpen) {
    return null;
  }

  const conversationTitle =
    currentMessages.find((message) => message.type === 'user')?.content || 'AI 对话';
  const lastMessageId = currentMessages[currentMessages.length - 1]?.id;
  const showRail = !isMobile && !isRailCollapsed;

  const handleSelectHistory = (chatId: string) => {
    loadChatHistory(chatId);
    if (isHistoryDrawerOpen) {
      closeHistoryDrawer();
    }
  };

  const handleNewChat = () => {
    createNewChat();
    if (isHistoryDrawerOpen) {
      closeHistoryDrawer();
    }
  };

  const renderRail = (inDrawer: boolean) => (
    <aside className={`ai-rail${inDrawer ? ' ai-rail--drawer' : ''}`}>
      <div className="ai-rail__head">
        <span className="eyebrow">对话历史</span>
        <span className="ai-rail__head-actions">
          {inDrawer ? (
            <button type="button" className="icon-btn" aria-label="关闭历史" onClick={closeHistoryDrawer}>
              <CloseOutlined />
            </button>
          ) : (
            <Tooltip title="收起侧栏">
              <button type="button" className="icon-btn" aria-label="收起侧栏" onClick={toggleRail}>
                <MenuFoldOutlined />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
      <div className="ai-rail__new">
        <Button block icon={<PlusOutlined />} onClick={handleNewChat}>
          新建对话
        </Button>
      </div>
      <div className="ai-rail__list">
        <HistoryList
          histories={chatHistories}
          currentChatId={currentChatId}
          onSelect={handleSelectHistory}
          onDelete={(chatId) => deleteChatHistory(chatId)}
        />
      </div>
    </aside>
  );

  const renderReferences = (message: Message, referenceArticles: ReferenceArticle[]) => {
    const expanded = !!expandedPanels[message.id];
    const sourceNames = Array.from(new Set(referenceArticles.map((article) => article.source))).slice(0, 4);

    return (
      <div className={`ai-refs${expanded ? ' ai-refs--open' : ''}`}>
        <button
          type="button"
          className="ai-refs__toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpandedPanels((previous) => ({
              ...previous,
              [message.id]: !previous[message.id],
            }));
          }}
        >
          <LinkOutlined className="ai-refs__icon" />
          <span>参考来源</span>
          <span className="mono u-tnum ai-refs__count">{referenceArticles.length}</span>
          {!expanded && (
            <span className="ai-refs__sources">
              {sourceNames.map((source) => (
                <span key={source} className="chip">{source}</span>
              ))}
            </span>
          )}
          <DownOutlined className="ai-refs__chevron" />
        </button>

        {expanded && <ReferenceCards articles={referenceArticles} />}
      </div>
    );
  };

  const renderMessage = (message: Message) => {
    const isUser = message.type === 'user';
    const timestamp = dayjs(message.timestamp).format('YYYY-MM-DD HH:mm:ss');

    if (isUser) {
      return (
        <div key={message.id} className="ai-msg ai-msg--user">
          <div className="ai-bubble">{message.content}</div>
          <span className="ai-msg__time mono u-tnum">{timestamp}</span>
        </div>
      );
    }

    const referenceArticles = getReferenceArticles(message);
    const isLive = isStreaming && message.id === lastMessageId;
    const isThinking = isLive && !message.content;

    return (
      <div key={message.id} className="ai-msg ai-msg--assistant">
        <AssistantMark />
        <div className="ai-msg__main">
          <div className="ai-msg__head">
            <span className="ai-msg__name">AI 助手</span>
            {message.engine && <span className="chip mono">{message.engine}</span>}
            {message.resolvedMode && (
              <span className="chip chip--accent mono">实际模式 {message.resolvedMode}</span>
            )}
            {typeof message.contextNodeCount === 'number' && message.contextNodeCount > 0 && (
              <span className="chip mono u-tnum">节点 {message.contextNodeCount}</span>
            )}
            {typeof message.contextEdgeCount === 'number' && message.contextEdgeCount > 0 && (
              <span className="chip mono u-tnum">边 {message.contextEdgeCount}</span>
            )}
            <span className="ai-msg__time mono u-tnum">{timestamp}</span>
          </div>

          {referenceArticles.length > 0 && renderReferences(message, referenceArticles)}

          {isThinking ? (
            <ThinkingIndicator label={referenceArticles.length > 0 ? '正在整理答案…' : '正在检索资讯…'} />
          ) : (
            <div className={`ai-answer${isLive ? ' ai-answer--streaming' : ''}`}>
              <Markdown>{message.content}</Markdown>
            </div>
          )}
        </div>
      </div>
    );
  };

  const modalContent = (
    <Modal
      open={isModalOpen}
      onCancel={closeModal}
      footer={null}
      closable={false}
      centered={!isMobile}
      width={isMobile ? '100%' : 'min(1180px, calc(100vw - 48px))'}
      className={`ai-modal${isMobile ? ' ai-modal--mobile' : ''}`}
      styles={{ mask: { backdropFilter: 'blur(6px)' } }}
    >
      <div className={`ai-chat${showRail ? ' ai-chat--with-rail' : ''}`}>
        {showRail && renderRail(false)}

        <section className="ai-main">
          <header className="ai-main__head">
            {isMobile ? (
              <button type="button" className="icon-btn" aria-label="对话历史" onClick={openHistoryDrawer}>
                <HistoryOutlined />
              </button>
            ) : isRailCollapsed ? (
              <Tooltip title="展开对话历史">
                <button type="button" className="icon-btn" aria-label="展开对话历史" onClick={toggleRail}>
                  <MenuUnfoldOutlined />
                </button>
              </Tooltip>
            ) : null}
            <div className="ai-main__title-wrap">
              <span className="eyebrow">AI 助手</span>
              <span className="ai-main__title" title={conversationTitle}>{conversationTitle}</span>
            </div>
            <span className="ai-main__actions">
              {(isMobile || isRailCollapsed) && (
                <Tooltip title="新建对话">
                  <button type="button" className="icon-btn" aria-label="新建对话" onClick={handleNewChat}>
                    <PlusOutlined />
                  </button>
                </Tooltip>
              )}
              {!isMobile && <span className="kbd">Esc</span>}
              <button type="button" className="icon-btn" aria-label="关闭" onClick={closeModal}>
                <CloseOutlined />
              </button>
            </span>
          </header>

          <div className="ai-thread">
            <div className="ai-thread__inner">
              {currentMessages.length === 0 ? (
                <div className="ai-welcome">
                  <AssistantMark size="lg" />
                  <h2 className="ai-welcome__title">有什么想了解的？</h2>
                  <p className="ai-welcome__desc">
                    开始和 AI 对话，或从历史记录继续之前的话题。回答基于已采集并索引的资讯，并附上参考来源。
                  </p>
                  <div className="ai-welcome__suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="ai-suggestion"
                        onClick={() => setInputValue(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                currentMessages.map(renderMessage)
              )}

              {isStreaming && currentMessages[currentMessages.length - 1]?.type !== 'assistant' && (
                <div className="ai-msg ai-msg--assistant">
                  <AssistantMark />
                  <div className="ai-msg__main">
                    <ThinkingIndicator label="正在生成回答…" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <footer className="ai-composer">
            <div className={`ai-composer__box${isStreaming ? ' ai-composer__box--busy' : ''}`}>
              <TextArea
                className="ai-composer__input"
                variant="borderless"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onPressEnter={handleKeyPress}
                placeholder={currentMessages.length > 0 ? '继续提问…' : '问点什么，例如：本周最值得关注的 AI 新闻？'}
                autoSize={{ minRows: 1, maxRows: 6 }}
                disabled={isStreaming}
              />
              <div className="ai-composer__bar">
                <Select<AIQueryEngine>
                  className="ai-composer__engine"
                  size="small"
                  variant="borderless"
                  value={selectedEngine}
                  onChange={setSelectedEngine}
                  popupMatchSelectWidth={false}
                  options={[
                    { label: '引擎 · 自动', value: 'auto' },
                    { label: '引擎 · RAG', value: 'rag' },
                  ]}
                />
                <ComposerHint />
                <Button
                  type="primary"
                  shape="circle"
                  className="ai-composer__send"
                  icon={<ArrowUpOutlined />}
                  aria-label="发送"
                  onClick={handleSend}
                  loading={isStreaming}
                  disabled={!inputValue.trim() || isStreaming}
                />
              </div>
            </div>
          </footer>
        </section>

        {isMobile && (isHistoryDrawerOpen || isHistoryDrawerClosing) && (
          <div className={`ai-drawer${isHistoryDrawerClosing ? ' ai-drawer--closing' : ''}`}>
            <div className="ai-drawer__mask" onClick={closeHistoryDrawer} />
            {renderRail(true)}
          </div>
        )}
      </div>
    </Modal>
  );

  return createPortal(modalContent, document.body);
}
