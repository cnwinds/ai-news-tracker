import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type {
  AIQueryEngine,
  ArticleSearchResult,
  KnowledgeGraphArticleReference,
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphNodeSummary,
} from '@/types';

export interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  engine?: AIQueryEngine;
  resolvedMode?: AIQueryEngine;
  articles?: ArticleSearchResult[];
  sources?: string[];
  matchedNodes?: KnowledgeGraphNodeSummary[];
  matchedCommunities?: KnowledgeGraphCommunitySummary[];
  relatedArticles?: KnowledgeGraphArticleReference[];
  contextNodeCount?: number;
  contextEdgeCount?: number;
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

interface StoredMessage extends Omit<Message, 'timestamp'> {
  timestamp: string;
}

interface StoredChatHistory extends Omit<ChatHistory, 'createdAt' | 'updatedAt' | 'messages'> {
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

interface AIConversationContextType {
  isModalOpen: boolean;
  openModal: (question?: string, chatId?: string) => void;
  closeModal: () => void;
  currentChatId: string | null;
  setCurrentChatId: (chatId: string | null) => void;
  currentMessages: Message[];
  setCurrentMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  chatHistories: ChatHistory[];
  loadChatHistory: (chatId: string) => void;
  createNewChat: () => void;
  updateChatHistory: (chatId: string, messages: Message[]) => void;
  deleteChatHistory: (chatId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedEngine: AIQueryEngine;
  setSelectedEngine: (engine: AIQueryEngine) => void;
}

const AIConversationContext = createContext<AIConversationContextType | undefined>(undefined);

const STORAGE_KEY = 'ai_conversation_history';
const ENGINE_STORAGE_KEY = 'ai_conversation_engine';

function inferEngineFromMessages(messages: Message[]): AIQueryEngine | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.engine) {
      return message.engine;
    }
    if (message.resolvedMode) {
      return message.resolvedMode;
    }
  }
  return null;
}

export function AIConversationProvider({ children }: { children: ReactNode }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessagesState] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEngine, setSelectedEngineState] = useState<AIQueryEngine>(() => {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY);
    if (saved === 'auto' || saved === 'rag' || saved === 'graph' || saved === 'hybrid') {
      return saved;
    }
    return 'auto';
  });

  const setSelectedEngine = useCallback((engine: AIQueryEngine) => {
    setSelectedEngineState(engine);
    localStorage.setItem(ENGINE_STORAGE_KEY, engine);
  }, []);

  const setCurrentMessages = useCallback((messages: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof messages === 'function') {
      setCurrentMessagesState(messages);
      return;
    }
    setCurrentMessagesState(messages);
  }, []);

  const saveHistoriesToStorage = useCallback((histories: ChatHistory[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch (error) {
      console.error('保存聊天历史失败:', error);
    }
  }, []);

  const loadHistoriesFromStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return [];
      }
      const parsed = JSON.parse(saved) as StoredChatHistory[];
      const histories: ChatHistory[] = parsed.map((history) => ({
        ...history,
        createdAt: new Date(history.createdAt),
        updatedAt: new Date(history.updatedAt),
        messages: history.messages.map((message) => ({
          ...message,
          timestamp: new Date(message.timestamp),
        })),
      }));
      setChatHistories(histories);
      return histories;
    } catch (error) {
      console.error('加载聊天历史失败:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    loadHistoriesFromStorage();
  }, [loadHistoriesFromStorage]);

  const loadChatHistory = useCallback((chatId: string) => {
    const history = chatHistories.find((item) => item.id === chatId);
    if (!history) {
      return;
    }
    setCurrentChatId(chatId);
    setCurrentMessages(history.messages);
    const inferredEngine = inferEngineFromMessages(history.messages);
    if (inferredEngine) {
      setSelectedEngine(inferredEngine);
    }
  }, [chatHistories, setCurrentMessages, setSelectedEngine]);

  const openModal = useCallback((question?: string, chatId?: string) => {
    if (chatId) {
      loadChatHistory(chatId);
      setIsModalOpen(true);
      return;
    }

    if (question) {
      setCurrentChatId(null);
      setCurrentMessages([
        {
          id: Date.now().toString(),
          type: 'user',
          content: question,
          timestamp: new Date(),
          engine: selectedEngine,
        },
      ]);
      setIsModalOpen(true);
      return;
    }

    setCurrentChatId(null);
    setCurrentMessages([]);
    setIsModalOpen(true);
  }, [loadChatHistory, selectedEngine, setCurrentMessages]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const createNewChat = useCallback(() => {
    setCurrentChatId(null);
    setCurrentMessages([]);
  }, [setCurrentMessages]);

  const updateChatHistory = useCallback((chatId: string, messages: Message[]) => {
    setChatHistories((previous) => {
      const histories = [...previous];
      const existingIndex = histories.findIndex((history) => history.id === chatId);
      const firstUserMessage = messages.find((message) => message.type === 'user');
      const title = firstUserMessage?.content || '新对话';
      const chatTitle = title.length > 30 ? `${title.slice(0, 30)}...` : title;

      if (existingIndex >= 0) {
        histories[existingIndex] = {
          ...histories[existingIndex],
          messages,
          updatedAt: new Date(),
        };
      } else {
        histories.unshift({
          id: chatId,
          title: chatTitle,
          messages,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      saveHistoriesToStorage(histories);
      return histories;
    });
  }, [saveHistoriesToStorage]);

  const deleteChatHistory = useCallback((chatId: string) => {
    setChatHistories((previous) => {
      const histories = previous.filter((history) => history.id !== chatId);
      saveHistoriesToStorage(histories);
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setCurrentMessages([]);
      }
      return histories;
    });
  }, [currentChatId, saveHistoriesToStorage, setCurrentMessages]);

  return (
    <AIConversationContext.Provider
      value={{
        isModalOpen,
        openModal,
        closeModal,
        currentChatId,
        setCurrentChatId,
        currentMessages,
        setCurrentMessages,
        chatHistories,
        loadChatHistory,
        createNewChat,
        updateChatHistory,
        deleteChatHistory,
        searchQuery,
        setSearchQuery,
        selectedEngine,
        setSelectedEngine,
      }}
    >
      {children}
    </AIConversationContext.Provider>
  );
}

export function useAIConversation() {
  const context = useContext(AIConversationContext);
  if (!context) {
    throw new Error('useAIConversation must be used within AIConversationProvider');
  }
  return context;
}
