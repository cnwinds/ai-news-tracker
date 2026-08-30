/**
 * 全局导航栏组件
 * 包含搜索框和快捷键支持
 */
import { useState, useRef, useEffect } from 'react';
import { Layout, Input, Button, Space } from 'antd';
import type { InputRef } from 'antd';
import { SearchOutlined, SunOutlined, MoonOutlined, SettingOutlined } from '@ant-design/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import SmartDropdown from './SmartDropdown';
import ArticleDetailModal from './ArticleDetailModal';
import { getThemeColor } from '@/utils/theme';
import { apiService } from '@/services/api';
import type { ApiError } from '@/components/settings/types';

const { Header } = Layout;

interface GlobalNavigationProps {
  onSettingsClick?: () => void;
}

export default function GlobalNavigation({ onSettingsClick }: GlobalNavigationProps) {
  const { theme, toggleTheme } = useTheme();
  const { openModal, setSearchQuery, searchQuery } = useAIConversation();
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const { isMobile } = useBreakpoint();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [, setIsFocused] = useState(false);
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

  // 全局快捷键 Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        if (inputRef.current && searchQuery) {
          inputRef.current.select();
        }
        setIsDropdownOpen(true);
        setIsFocused(true);
      }
      if (e.key === 'Escape') {
        if (articleDetailModalOpen) {
          setArticleDetailModalOpen(false);
          setSelectedArticleId(null);
          setIsDropdownOpen(true);
          setIsFocused(true);
        } else {
          setIsDropdownOpen(false);
          setIsFocused(false);
          inputRef.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, articleDetailModalOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setIsDropdownOpen(true);
  };

  const handleInputFocus = () => {
    setIsFocused(true);
    setIsDropdownOpen(true);
  };

  const handleInputBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      if (!articleDetailModalOpen) {
        setIsFocused(false);
        setIsDropdownOpen(false);
      }
      blurTimeoutRef.current = null;
    }, 200);
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
          const articleId = parseInt(match[1]);
          setSelectedArticleId(articleId);
          setArticleDetailModalOpen(true);
        }
      } else {
        const errorMessage = apiError.message || (apiError.response?.data?.detail) || '采集文章失败';
        message.error(errorMessage);
      }
    }
  };

  const headerStyle: React.CSSProperties = {
    padding: isMobile ? '8px 12px' : '0 24px',
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'stretch' : 'center',
    gap: isMobile ? '8px' : '16px',
    background: theme === 'dark' ? '#1a1a1a' : '#001529',
    borderBottom: theme === 'dark' ? '1px solid #303030' : 'none',
    position: 'relative',
    zIndex: 1000,
    height: isMobile ? 'auto' : undefined,
    lineHeight: isMobile ? 'normal' : undefined,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    width: '100%',
    maxWidth: isMobile ? '100%' : '800px',
    height: '40px',
    borderRadius: '8px',
  };

  const actionButtons = (
    <Space size="middle">
      <Button
        type="text"
        icon={theme === 'dark' ? <SunOutlined style={{ fontSize: '18px' }} /> : <MoonOutlined style={{ fontSize: '18px' }} />}
        onClick={toggleTheme}
        style={{ color: '#fff', fontSize: '18px', padding: '8px 12px' }}
        title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      />
      {isAuthenticated && (
        <Button
          type="text"
          icon={<SettingOutlined style={{ fontSize: '18px' }} />}
          style={{ color: '#fff', fontSize: '18px', padding: '8px 12px' }}
          title="设置"
          onClick={onSettingsClick}
        />
      )}
    </Space>
  );

  const searchInput = (
    <Input
      ref={inputRef}
      placeholder={isMobile ? '搜索或提问...' : '搜索新闻，或向 AI 提问，或输入文章URL (Cmd+K)'}
      value={searchQuery}
      onChange={handleInputChange}
      onFocus={handleInputFocus}
      onBlur={handleInputBlur}
      onPressEnter={(e) => {
        if (!isDropdownOpen) {
          const value = (e.target as HTMLInputElement).value;
          handleSearch(value);
        }
      }}
      prefix={<SearchOutlined style={{ color: getThemeColor(theme, 'textSecondary') }} />}
      suffix={
        !isMobile && (
          <span style={{
            fontSize: '12px',
            color: getThemeColor(theme, 'textTertiary'),
            paddingRight: '8px',
          }}>
            {navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'}
          </span>
        )
      }
      style={inputStyle}
      size="large"
    />
  );

  const dropdownProps = {
    query: searchQuery,
    onSelectArticle: (article: { id: number }) => {
      setSelectedArticleId(article.id);
      setArticleDetailModalOpen(true);
    },
    onSelectHistory: (chatId: string) => {
      openModal(undefined, chatId);
      setIsDropdownOpen(false);
      setSearchQuery('');
    },
    onSelectAIQuery: (query: string) => {
      handleSearch(query);
    },
    onSelectSearchHistory: (historyQuery: string) => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      setSearchQuery(historyQuery);
      setIsDropdownOpen(true);
      setIsFocused(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    },
    onSearchExecuted: () => {},
    onCollectUrl: handleCollectUrl,
    onKeepDropdownOpen: () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      setIsDropdownOpen(true);
      setIsFocused(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    },
  };

  return (
    <Header style={headerStyle}>
      {isMobile ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div
              style={{
                color: '#fff',
                fontSize: '16px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <img
                src="/favicon.svg"
                alt="AI News Tracker"
                style={{ width: 26, height: 26, display: 'block' }}
              />
              <span>AI News</span>
            </div>
            {actionButtons}
          </div>
          <div style={{ position: 'relative', width: '100%' }}>
            {searchInput}
            {isDropdownOpen && <SmartDropdown {...dropdownProps} />}
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              color: '#fff',
              fontSize: '20px',
              fontWeight: 'bold',
              minWidth: '200px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <img
              src="/favicon.svg"
              alt="AI News Tracker"
              style={{ width: 32, height: 32, display: 'block' }}
            />
            <span>AI News Tracker</span>
          </div>

          <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
            {searchInput}
            {isDropdownOpen && <SmartDropdown {...dropdownProps} />}
          </div>

          <div style={{ marginLeft: 'auto', minWidth: '120px', paddingRight: '8px', display: 'flex', justifyContent: 'flex-end' }}>
            {actionButtons}
          </div>
        </>
      )}

      <ArticleDetailModal
        articleId={selectedArticleId}
        open={articleDetailModalOpen}
        onClose={() => {
          setArticleDetailModalOpen(false);
          setSelectedArticleId(null);
          setIsDropdownOpen(true);
          setIsFocused(true);
        }}
      />
    </Header>
  );
}
