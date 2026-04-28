import type { WebSocketMessage } from '@/types';

function resolveWebSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_BASE_URL;
  if (configured) {
    if (configured.startsWith('ws://') || configured.startsWith('wss://')) {
      return configured;
    }
    if (configured.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}${configured}`;
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/ws`;
}

const WS_BASE_URL = resolveWebSocketUrl();
const HEARTBEAT_INTERVAL = 30000;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  private readonly reconnectDelay = RECONNECT_DELAY;
  private readonly listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private heartbeatInterval: number | null = null;

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (this.reconnectAttempts > 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_BASE_URL);

      this.ws.onopen = () => {
        if (import.meta.env.DEV) {
          console.log('WebSocket 连接成功');
        }
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connected', { message: '连接成功' });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('解析 WebSocket 消息失败:', error);
          }
        }
      };

      this.ws.onerror = (error) => {
        if (import.meta.env.DEV) {
          console.warn('WebSocket 连接错误（可能是后端未启动）:', error);
        }
        this.emit('error', { error });
      };

      this.ws.onclose = (event) => {
        if (event.code !== 1000) {
          if (import.meta.env.DEV) {
            console.log('WebSocket 连接关闭，代码:', event.code);
          }
          this.stopHeartbeat();
          this.emit('close', { code: event.code, reason: event.reason });
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
      if (import.meta.env.DEV) {
        console.error('WebSocket 连接失败:', error);
      }
      this.attemptReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.reconnectAttempts = this.maxReconnectAttempts;
    
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, '正常关闭');
      }
      
      this.ws = null;
    }
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
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (import.meta.env.DEV) {
        console.warn('WebSocket 重连次数已达上限（可能是后端未启动）');
      }
      this.emit('error', { error: '连接失败，请刷新页面或检查后端服务' });
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
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
    this.listeners.get(event)?.add(callback);

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
          if (import.meta.env.DEV) {
            console.error(`WebSocket 事件回调错误 (${event}):`, error);
          }
        }
      });
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();

