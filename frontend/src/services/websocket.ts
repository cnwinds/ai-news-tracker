/**
 * WebSocket 服务
 */
import type { WebSocketMessage } from '@/types';

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000/api/v1/ws';

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private heartbeatInterval: number | null = null;

  connect(): void {
    // 如果已经连接或正在连接，不重复连接
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // 如果正在重连，不重复连接
    if (this.reconnectAttempts > 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_BASE_URL);

      this.ws.onopen = () => {
        console.log('WebSocket 连接成功');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connected', { message: '连接成功' });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('解析 WebSocket 消息失败:', error);
        }
      };

      this.ws.onerror = (error) => {
        // 只在开发环境输出详细错误
        if (import.meta.env.DEV) {
          console.warn('WebSocket 连接错误（可能是后端未启动）:', error);
        }
        this.emit('error', { error });
      };

      this.ws.onclose = (event) => {
        // 如果不是正常关闭，尝试重连
        if (event.code !== 1000) {
          if (import.meta.env.DEV) {
            console.log('WebSocket 连接关闭，代码:', event.code);
          }
          this.stopHeartbeat();
          this.emit('close', { code: event.code, reason: event.reason });
          // 延迟重连，避免立即重连
          setTimeout(() => {
            this.attemptReconnect();
          }, 1000);
        } else {
          if (import.meta.env.DEV) {
            console.log('WebSocket 正常关闭');
          }
          this.stopHeartbeat();
          this.emit('close', { code: event.code, reason: event.reason });
        }
      };
    } catch (error) {
      console.error('WebSocket 连接失败:', error);
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    // 重置重连计数
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      // 移除所有事件监听器，避免触发重连
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, '正常关闭');
      }
      this.ws = null;
    }
    // 不清除监听器，因为可能只是暂时断开
    // this.listeners.clear();
  }

  private handleMessage(message: WebSocketMessage): void {
    const { type, ...data } = message;
    this.emit(type, data);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30秒
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // 只在开发环境输出错误
      if (import.meta.env.DEV) {
        console.warn('WebSocket 重连次数已达上限（可能是后端未启动）');
      }
      this.emit('error', { error: '连接失败，请刷新页面或检查后端服务' });
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
      // 只在开发环境输出日志
      if (import.meta.env.DEV) {
        console.log(`尝试重连 WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      }
      this.connect();
    }, this.reconnectDelay);
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // 返回取消监听的函数
    return () => {
      this.off(event, callback);
    };
  }

  off(event: string, callback: (data: unknown) => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  private emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`WebSocket 事件回调错误 (${event}):`, error);
        }
      });
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();

