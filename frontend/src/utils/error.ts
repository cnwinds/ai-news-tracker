/**
 * 错误处理相关的工具函数
 */
import { message } from 'antd';
import type { ApiError } from '@/services/api';

/**
 * 从错误对象中提取错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError;
    if (apiError.message) {
      return apiError.message;
    }
    if (apiError.data && typeof apiError.data === 'object') {
      const data = apiError.data as Record<string, unknown>;
      if (typeof data.detail === 'string') {
        return data.detail;
      }
      if (typeof data.message === 'string') {
        return data.message;
      }
    }
  }
  
  return '未知错误';
}

/**
 * 显示错误消息
 */
export function showError(error: unknown, defaultMessage: string = '操作失败'): void {
  const errorMessage = getErrorMessage(error);
  message.error(errorMessage || defaultMessage);
}

/**
 * 检查是否为认证错误
 */
export function isAuthError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError;
    return apiError.status === 401;
  }
  return false;
}
