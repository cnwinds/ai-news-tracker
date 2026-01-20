/**
 * 访问追踪组件 - 在 Router 内部使用
 */
import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

// 获取或生成 session ID（使用 localStorage 持久化）
function getOrCreateSessionId(): string {
  const STORAGE_KEY = 'access_session_id';

  // 尝试从 localStorage 获取
  let sessionId = localStorage.getItem(STORAGE_KEY);

  // 如果不存在，生成新的并保存
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(STORAGE_KEY, sessionId);
  }

  return sessionId;
}

let lastPath: string = '';

export default function AccessTracker() {
  const location = useLocation();
  const { user } = useAuth();

  // 使用 useMemo 确保 sessionId 只生成一次
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  useEffect(() => {
    // 只在路径变化时记录
    if (location.pathname !== lastPath) {
      const currentPath = location.pathname;

      // 记录页面浏览
      apiService.logAccess(
        'page_view',
        currentPath,
        `浏览页面: ${currentPath}`,
        user?.username || sessionId
      ).catch((error) => {
        // 静默失败，不影响用户体验
        console.debug('Failed to log access:', error);
      });

      lastPath = currentPath;
    }
  }, [location.pathname, user?.username, sessionId]);

  // 这个组件不渲染任何内容
  return null;
}
