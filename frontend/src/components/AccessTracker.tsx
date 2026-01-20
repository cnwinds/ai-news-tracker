/**
 * 访问追踪组件 - 在 Router 内部使用
 */
import { useMemo } from 'react';
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

export default function AccessTracker() {
  // 这个组件不直接使用 username，但保留 useAuth 调用以备将来使用
  useAuth();

  // 使用 useMemo 确保 sessionId 只生成一次
  // 这个 session ID 会在文章展开和查看详情时使用
  useMemo(() => getOrCreateSessionId(), []);

  // 这个组件不渲染任何内容
  // 只负责生成和存储 session ID
  return null;
}
