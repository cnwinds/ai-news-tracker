/**
 * Form 工具函数
 */
import type { FormInstance } from 'antd/es/form';

/**
 * 安全地设置 Form 字段值
 * 确保 Form 组件已挂载后再调用 setFieldsValue
 * 
 * @param form Form 实例
 * @param values 要设置的字段值
 */
export function safeSetFieldsValue<T extends Record<string, unknown> = Record<string, unknown>>(
  form: FormInstance<T> | null | undefined,
  values: Partial<T>
): void {
  if (!form) {
    return;
  }

  // 使用 setTimeout 确保 Form 组件已挂载
  setTimeout(() => {
    try {
      // Ant Design 的 FormInstance.setFieldsValue 接受 Partial<T>，但类型定义可能不匹配
      // 使用 any 来绕过类型检查，因为实际运行时是安全的
      (form.setFieldsValue as (values: Partial<T>) => void)(values);
    } catch (e) {
      // 忽略表单未连接的错误
    }
  }, 0);
}
