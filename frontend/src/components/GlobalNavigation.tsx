/**
 * 全局导航栏组件
 * 包含搜索框和快捷键支持
 */
import { useState, useRef, useEffect } from 'react';
import { Layout, Input, Button, Space } from 'antd';
import { SearchOutlined, SunOutlined, MoonOutlined, SettingOutlined } from '@ant-design/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import SmartDropdown from './SmartDropdown';
import ArticleDetailModal from './ArticleDetailModal';
import { getThemeColor } from '@/utils/theme';
import { apiService } from '@/services/api';

const { Header } = Layout;

interface GlobalNavigationProps {
  onSettingsClick?: () => void;
}

export default function GlobalNavigation({ onSettingsClick }: GlobalNavigationProps) {
  const { theme, toggleTheme } = useTheme();
  const { openModal, setSearchQuery, searchQuery } = useAIConversation();
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [, setIsFocused] = useState(false);
  const [articleDetailModalOpen, setArticleDetailModalOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const inputRef = useRef<any>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 全局快捷键 Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        // 如果搜索框有内容，全选
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
          // 关闭详情后，保持下拉窗口打开
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
    // 延迟关闭，以便点击下拉项
    // 如果文章详情模态框打开，不要关闭下拉窗口
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

  // 处理URL采集
  const handleCollectUrl = async (url: string) => {
    try {
      const article = await apiService.collectArticleFromUrl(url);
      message.success(`成功采集文章: ${article.title}`);
      setSearchQuery('');
      setIsDropdownOpen(false);
      // 打开文章详情
      setSelectedArticleId(article.id);
      setArticleDetailModalOpen(true);
    } catch (error: any) {
      if (error.status === 409) {
        message.warning('文章已存在');
        // 尝试从错误消息中提取文章ID
        const match = error.message?.match(/ID:\s*(\d+)/);
        if (match) {
          const articleId = parseInt(match[1]);
          setSelectedArticleId(articleId);
          setArticleDetailModalOpen(true);
        }
      } else {
        message.error(error.message || '采集文章失败');
      }
    }
  };

  const headerStyle: React.CSSProperties = {
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    background: theme === 'dark' ? '#1a1a1a' : '#001529',
    borderBottom: theme === 'dark' ? '1px solid #303030' : 'none',
    position: 'relative',
    zIndex: 1000,
  };

  // 响应式：检测移动端
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      // 清理 blur timeout
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const inputStyle: React.CSSProperties = {
    flex: 1,
    maxWidth: isMobile ? '100%' : '800px',
    height: '40px',
    borderRadius: '8px',
  };

  return (
    <Header style={headerStyle}>
      <div
        style={{
          color: '#fff',
          fontSize: isMobile ? '16px' : '20px',
          fontWeight: 'bold',
          minWidth: isMobile ? '120px' : '200px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <img
          src="/favicon.svg"
          alt="AI News Tracker"
          style={{
            width: isMobile ? 26 : 32,
            height: isMobile ? 26 : 32,
            display: 'block',
          }}
        />
        <span>{isMobile ? 'AI News' : 'AI News Tracker'}</span>
      </div>
      
      <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
        <Input
          ref={inputRef}
          placeholder="搜索新闻，或向 AI 提问，或输入文章URL (Cmd+K)"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onPressEnter={(e) => {
            // 如果下拉窗口打开，SmartDropdown会处理回车键
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
                paddingRight: '8px'
              }}>
                {navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'}
              </span>
            )
          }
          style={inputStyle}
          size="large"
        />
        
        {isDropdownOpen && (
          <SmartDropdown
            query={searchQuery}
            onSelectArticle={(article) => {
              // 点击文章项，打开文章详情模态框，但保持下拉窗口打开
              setSelectedArticleId(article.id);
              setArticleDetailModalOpen(true);
              // 不关闭下拉窗口，不清空搜索内容，方便继续查看其他文章
            }}
            onSelectHistory={(chatId) => {
              // 点击历史记录，打开模态层
              openModal(undefined, chatId);
              setIsDropdownOpen(false);
              setSearchQuery('');
            }}
            onSelectAIQuery={(query) => {
              // 选择 AI 问答
              handleSearch(query);
            }}
            onSelectSearchHistory={(searchQuery) => {
              // 清除可能存在的 blur timeout，防止关闭下拉菜单
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
              // 选择搜索历史，填充到输入框并触发文章搜索（不打开AI对话）
              setSearchQuery(searchQuery);
              // 保持下拉菜单打开，让用户看到搜索结果
              setIsDropdownOpen(true);
              setIsFocused(true);
              // 确保输入框保持焦点，避免 onBlur 关闭下拉菜单
              setTimeout(() => {
                inputRef.current?.focus();
              }, 0);
            }}
            onSearchExecuted={() => {
              // 搜索已执行，可以在这里做额外处理
              // 搜索历史已在 SmartDropdown 中保存
            }}
            onCollectUrl={handleCollectUrl}
            onKeepDropdownOpen={() => {
              // 清除可能存在的 blur timeout，防止关闭下拉菜单
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
              // 保持下拉菜单打开
              setIsDropdownOpen(true);
              setIsFocused(true);
              // 确保输入框保持焦点，避免 onBlur 关闭下拉菜单
              setTimeout(() => {
                inputRef.current?.focus();
              }, 0);
            }}
          />
        )}
      </div>

      <div style={{ marginLeft: 'auto', minWidth: '120px', paddingRight: '8px', display: 'flex', justifyContent: 'flex-end' }}>
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
      </div>

      {/* 文章详情模态框 */}
      <ArticleDetailModal
        articleId={selectedArticleId}
        open={articleDetailModalOpen}
        onClose={() => {
          setArticleDetailModalOpen(false);
          setSelectedArticleId(null);
          // 关闭详情后，保持下拉窗口打开，方便继续查看其他文章
          setIsDropdownOpen(true);
          setIsFocused(true);
        }}
      />
    </Header>
  );
}
