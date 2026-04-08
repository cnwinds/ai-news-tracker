import type { FormInstance } from 'antd/es/form';

/**
 * 安全地设置 Form 字段值
 * 确保 Form 组件已挂载后再调用 setFieldsValue
 */
export function safeSetFieldsValue<T extends object = Record<string, unknown>>(
  form: FormInstance<T> | null | undefined,
  values: Partial<T>
): void {
  if (!form) {
    return;
  }

  setTimeout(() => {
    try {
      // Ant Design 的 FormInstance.setFieldsValue 接受 Partial<T>，但类型定义可能不匹配
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (form.setFieldsValue as (values: Partial<T>) => void)(values);
    } catch {
      // 忽略表单未连接的错误
    }
  }, 0);
}
