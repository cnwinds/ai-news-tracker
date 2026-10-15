/**
 * 全局命令搜索：搜索文章 / 向 AI 提问 / 粘贴 URL 采集（Cmd/Ctrl+K）
 */
import { useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import type { InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useMessage } from '@/hooks/useMessage';
import { apiService } from '@/services/api';
import type { ApiError } from '@/components/settings/types';
import SmartDropdown from '@/components/SmartDropdown';
import ArticleDetailModal from '@/components/ArticleDetailModal';

interface CommandSearchProps {
  compact?: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export default function CommandSearch({ compact = false }: CommandSearchProps) {
  const { openModal, setSearchQuery, searchQuery } = useAIConversation();
  const message = useMessage();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [articleDetailModalOpen, setArticleDetailModalOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const inputRef = useRef<InputRef>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        if (searchQuery) {
          inputRef.current?.select();
        }
        setIsDropdownOpen(true);
      }
      if (e.key === 'Escape') {
        if (articleDetailModalOpen) {
          setArticleDetailModalOpen(false);
          setSelectedArticleId(null);
          setIsDropdownOpen(true);
        } else if (isDropdownOpen) {
          setIsDropdownOpen(false);
          inputRef.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, articleDetailModalOpen, isDropdownOpen]);

  const cancelBlur = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const keepOpen = () => {
    cancelBlur();
    setIsDropdownOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSearch = (value: string) => {
    if (value.trim()) {
      openModal(value.trim());
      setIsDropdownOpen(false);
      setSearchQuery('');
    }
  };

  const handleCollectUrl = async (url: string) => {
    try {
      const article = await apiService.collectArticleFromUrl(url);
      message.success(`成功采集文章: ${article.title}`);
      setSearchQuery('');
      setIsDropdownOpen(false);
      setSelectedArticleId(article.id);
      setArticleDetailModalOpen(true);
    } catch (error: unknown) {
      const apiError = error as ApiError;
      if (apiError.status === 409) {
        message.warning('文章已存在');
        const match = apiError.message?.match(/ID:\s*(\d+)/);
        if (match) {
          setSelectedArticleId(parseInt(match[1]));
          setArticleDetailModalOpen(true);
        }
      } else {
        message.error(apiError.message || apiError.response?.data?.detail || '采集文章失败');
      }
    }
  };

  return (
    <div className="cmd-search">
      <Input
        ref={inputRef}
        className="cmd-search__input"
        placeholder={compact ? '搜索资讯或向 AI 提问' : '搜索资讯、向 AI 提问，或粘贴文章链接'}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setIsDropdownOpen(true);
        }}
        onFocus={() => setIsDropdownOpen(true)}
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => {
            if (!articleDetailModalOpen) {
              setIsDropdownOpen(false);
            }
            blurTimeoutRef.current = null;
          }, 200);
        }}
        onPressEnter={(e) => {
          if (!isDropdownOpen) {
            handleSearch((e.target as HTMLInputElement).value);
          }
        }}
        prefix={<SearchOutlined />}
        suffix={compact ? undefined : <span className="kbd">{isMac ? '⌘' : 'Ctrl'} K</span>}
        allowClear={compact}
      />
      {isDropdownOpen && (
        <SmartDropdown
          query={searchQuery}
          onSelectArticle={(article) => {
            setSelectedArticleId(article.id);
            setArticleDetailModalOpen(true);
          }}
          onSelectHistory={(chatId) => {
            openModal(undefined, chatId);
            setIsDropdownOpen(false);
            setSearchQuery('');
          }}
          onSelectAIQuery={handleSearch}
          onSelectSearchHistory={(historyQuery) => {
            setSearchQuery(historyQuery);
            keepOpen();
          }}
          onCollectUrl={handleCollectUrl}
          onKeepDropdownOpen={keepOpen}
        />
      )}

      <ArticleDetailModal
        articleId={selectedArticleId}
        open={articleDetailModalOpen}
        onClose={() => {
          setArticleDetailModalOpen(false);
          setSelectedArticleId(null);
          setIsDropdownOpen(true);
        }}
      />
    </div>
  );
}
