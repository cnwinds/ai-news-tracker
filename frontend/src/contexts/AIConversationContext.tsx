/**
 * AI 对话全局状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

import type { ArticleSearchResult } from '@/types';

export interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  articles?: ArticleSearchResult[];
  sources?: string[];
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

interface AIConversationContextType {
  // 模态层状态
  isModalOpen: boolean;
  openModal: (question?: string, chatId?: string) => void;
  closeModal: () => void;
  
  // 当前对话
  currentChatId: string | null;
  setCurrentChatId: (chatId: string | null) => void;
  currentMessages: Message[];
  setCurrentMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  
  // 对话历史
  chatHistories: ChatHistory[];
  loadChatHistory: (chatId: string) => void;
  createNewChat: () => void;
  updateChatHistory: (chatId: string, messages: Message[]) => void;
  deleteChatHistory: (chatId: string) => void;
  
  // 搜索相关
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const AIConversationContext = createContext<AIConversationContextType | undefined>(undefined);

const STORAGE_KEY = 'ai_conversation_history';

export function AIConversationProvider({ children }: { children: ReactNode }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessagesState] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // 包装 setCurrentMessages 以支持函数式更新
  const setCurrentMessages = useCallback((messages: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof messages === 'function') {
      setCurrentMessagesState(messages);
    } else {
      setCurrentMessagesState(messages);
    }
  }, []);

  // 从 localStorage 加载历史记录
  const loadHistoriesFromStorage = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        interface StoredChatHistory {
          id: string;
          title: string;
          messages: Array<{
            id: string;
            type: 'user' | 'assistant';
            content: string;
            timestamp: string;
            articles?: ArticleSearchResult[];
            sources?: string[];
          }>;
          createdAt: string;
          updatedAt: string;
        }
        const parsed: StoredChatHistory[] = JSON.parse(saved);
        const histories: ChatHistory[] = parsed.map((h) => ({
          ...h,
          createdAt: new Date(h.createdAt),
          updatedAt: new Date(h.updatedAt),
          messages: h.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          })),
        }));
        setChatHistories(histories);
        return histories;
      }
    } catch (e) {
      console.error('加载聊天历史失败:', e);
    }
    return [];
  }, []);

  // 保存历史记录到 localStorage
  const saveHistoriesToStorage = useCallback((histories: ChatHistory[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch (e) {
      console.error('保存聊天历史失败:', e);
    }
  }, []);

  // 初始化时加载历史记录
  useEffect(() => {
    loadHistoriesFromStorage();
  }, [loadHistoriesFromStorage]);

  const openModal = useCallback((question?: string, chatId?: string) => {
    if (chatId) {
      // 加载指定历史对话
      const history = chatHistories.find((h) => h.id === chatId);
      if (history) {
        setCurrentChatId(chatId);
        setCurrentMessages(history.messages);
      }
    } else if (question) {
      // 新对话，使用问题作为初始消息
      setCurrentChatId(null);
      setCurrentMessages([{
        id: Date.now().toString(),
        type: 'user',
        content: question,
        timestamp: new Date(),
      }]);
    } else {
      // 打开空对话
      setCurrentChatId(null);
      setCurrentMessages([]);
    }
    setIsModalOpen(true);
  }, [chatHistories]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    // 不重置当前对话，保留状态以便下次打开
  }, []);

  const loadChatHistory = useCallback((chatId: string) => {
    const history = chatHistories.find((h) => h.id === chatId);
    if (history) {
      setCurrentChatId(chatId);
      setCurrentMessages(history.messages);
    }
  }, [chatHistories]);

  const createNewChat = useCallback(() => {
    setCurrentChatId(null);
    setCurrentMessages([]);
  }, []);

  const updateChatHistory = useCallback((chatId: string, messages: Message[]) => {
    setChatHistories((prevHistories) => {
      const histories = [...prevHistories];
      const index = histories.findIndex((h) => h.id === chatId);
      
      const title = messages.find((m) => m.type === 'user')?.content || '新对话';
      const chatTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
      
      if (index >= 0) {
        // 更新现有历史
        histories[index] = {
          ...histories[index],
          messages,
          updatedAt: new Date(),
        };
      } else {
        // 创建新历史
        const newHistory: ChatHistory = {
          id: chatId,
          title: chatTitle,
          messages,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        histories.unshift(newHistory);
      }
      
      saveHistoriesToStorage(histories);
      return histories;
    });
  }, [saveHistoriesToStorage]);

  const deleteChatHistory = useCallback((chatId: string) => {
    setChatHistories((prevHistories) => {
      const newHistories = prevHistories.filter((h) => h.id !== chatId);
      saveHistoriesToStorage(newHistories);
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setCurrentMessages([]);
      }
      return newHistories;
    });
  }, [currentChatId, saveHistoriesToStorage]);

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
      }}
    >
      {children}
    </AIConversationContext.Provider>
  );
}

export function useAIConversation() {
  const context = useContext(AIConversationContext);
  if (context === undefined) {
    throw new Error('useAIConversation must be used within AIConversationProvider');
  }
  return context;
}
