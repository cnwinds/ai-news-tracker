/**
 * 访问追踪 Hook
 * 用于自动记录用户访问行为
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

// 生成简单的 session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function useAccessTracking() {
  const location = useLocation();
  const { username } = useAuth();
  const sessionIdRef = useRef<string>(generateSessionId());
  const lastPathRef = useRef<string>('');

  useEffect(() => {
    // 只在路径变化时记录
    if (location.pathname !== lastPathRef.current) {
      const currentPath = location.pathname;

      // 记录页面浏览
      apiService.logAccess(
        'page_view',
        currentPath,
        `浏览页面: ${currentPath}`,
        username || sessionIdRef.current
      ).catch((error) => {
        // 静默失败，不影响用户体验
        console.debug('Failed to log access:', error);
      });

      lastPathRef.current = currentPath;
    }
  }, [location.pathname, username]);

  // 返回一个函数用于记录点击事件
  const trackClick = (action: string, pagePath?: string) => {
    apiService.logAccess(
      'click',
      pagePath || location.pathname,
      action,
      username || sessionIdRef.current
    ).catch((error) => {
      console.debug('Failed to log click:', error);
    });
  };

  return { trackClick };
}
