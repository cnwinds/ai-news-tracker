/**
 * 全局导航栏组件
 * 包含搜索框和快捷键支持
 */
import { useState, useRef, useEffect } from 'react';
import { Layout, Input, Button, Space } from 'antd';
import { SearchOutlined, SunOutlined, MoonOutlined, SettingOutlined } from '@ant-design/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useAIConversation } from '@/contexts/AIConversationContext';
import SmartDropdown from './SmartDropdown';
import ArticleDetailModal from './ArticleDetailModal';
import { getThemeColor } from '@/utils/theme';

const { Header } = Layout;

export default function GlobalNavigation() {
  const { theme, toggleTheme } = useTheme();
  const { openModal, setSearchQuery, searchQuery } = useAIConversation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [articleDetailModalOpen, setArticleDetailModalOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const inputRef = useRef<any>(null);

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
    setTimeout(() => {
      if (!articleDetailModalOpen) {
        setIsFocused(false);
        setIsDropdownOpen(false);
      }
    }, 200);
  };

  const handleSearch = (value: string) => {
    if (value.trim()) {
      openModal(value.trim());
      setIsDropdownOpen(false);
      setSearchQuery('');
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
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const inputStyle: React.CSSProperties = {
    flex: 1,
    maxWidth: isMobile ? '100%' : '800px',
    height: '40px',
    borderRadius: '8px',
  };

  return (
    <Header style={headerStyle}>
      <div style={{ 
        color: '#fff', 
        fontSize: isMobile ? '16px' : '20px', 
        fontWeight: 'bold', 
        minWidth: isMobile ? '120px' : '200px' 
      }}>
        {isMobile ? '🤖 AI News' : '🤖 AI News Tracker'}
      </div>
      
      <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
        <Input
          ref={inputRef}
          placeholder="搜索新闻，或向 AI 提问 (Cmd+K)"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onPressEnter={(e) => {
            // 只有在没有打开下拉窗口时，才直接触发AI聊天
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
              // 选择搜索历史，填充到输入框并触发搜索
              setSearchQuery(searchQuery);
              handleSearch(searchQuery);
            }}
            onSearchExecuted={(searchQuery) => {
              // 搜索已执行，可以在这里做额外处理
              // 搜索历史已在 SmartDropdown 中保存
            }}
          />
        )}
      </div>

      <div style={{ marginLeft: 'auto', minWidth: '120px' }}>
        <Space>
          <Button
            type="text"
            icon={theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            style={{ color: '#fff' }}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </Button>
          <Button
            type="text"
            icon={<SettingOutlined />}
            style={{ color: '#fff' }}
            title="设置"
          />
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
