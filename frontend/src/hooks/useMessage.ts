/**
 * 统一的消息提示 Hook
 * 使用 App.useApp() 来获取 message API，支持动态主题
 */
import { App } from 'antd';

export function useMessage() {
  const { message } = App.useApp();
  return message;
}
