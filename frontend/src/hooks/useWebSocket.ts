/**
 * WebSocket Hook
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { wsService } from '@/services/websocket';
import type { WebSocketMessage } from '@/types';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    
    // 延迟连接，避免在开发模式下重复连接
    const connectTimer = setTimeout(() => {
      if (isMountedRef.current) {
        wsService.connect();
      }
    }, 100);

    const unsubscribeConnected = wsService.on('connected', () => {
      if (isMountedRef.current) {
        setConnected(true);
      }
    });

    const unsubscribeError = wsService.on('error', () => {
      if (isMountedRef.current) {
        setConnected(false);
      }
    });

    // 监听连接关闭
    const unsubscribeClose = wsService.on('close', () => {
      if (isMountedRef.current) {
        setConnected(false);
      }
    });

    return () => {
      clearTimeout(connectTimer);
      isMountedRef.current = false;
      unsubscribeConnected();
      unsubscribeError();
      unsubscribeClose();
      // 不在组件卸载时断开连接，让 WebSocket 保持连接
      // 如果需要完全断开，可以在应用关闭时调用 wsService.disconnect()
    };
  }, []);

  const subscribe = useCallback((event: string, callback: (data: unknown) => void) => {
    const unsubscribe = wsService.on(event, (data) => {
      if (isMountedRef.current) {
        setLastMessage({ type: event, ...(data as Record<string, unknown>) } as WebSocketMessage);
        callback(data);
      }
    });
    return unsubscribe;
  }, []);

  return {
    connected,
    lastMessage,
    subscribe,
    isConnected: wsService.isConnected(),
  };
}

