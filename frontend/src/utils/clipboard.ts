/**
 * 剪贴板工具函数
 */
import { message } from 'antd';

/**
 * 复制文本到剪贴板
 * @param text 要复制的文本
 * @param successMessage 成功提示消息，默认为 '已复制到剪贴板'
 */
export async function copyToClipboard(text: string, successMessage: string = '已复制到剪贴板'): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      message.success(successMessage);
      return;
    }
  } catch (err) {
    // 如果 Clipboard API 失败，使用降级方案
  }

  // 降级方案：使用传统的 execCommand
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    const success = document.execCommand('copy');
    if (success) {
      message.success(successMessage);
    } else {
      message.info(`文本内容: ${text}`);
    }
  } catch (err) {
    message.info(`文本内容: ${text}`);
  } finally {
    document.body.removeChild(textarea);
  }
}
