/**
 * 密码修改标签页组件
 */
import { Form, Input, Button } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { PasswordFormValues } from './types';
import { SettingsPanel, SettingsSaveBar, useSettingsFormLayout } from './SettingsKit';

export default function PasswordSettingsTab() {
  const { isAuthenticated } = useAuth();
  const { createErrorHandler, showSuccess, showError } = useErrorHandler();
  const [passwordForm] = Form.useForm();
  const formLayout = useSettingsFormLayout();

  // 修改密码
  const changePasswordMutation = useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) =>
      apiService.changePassword(oldPassword, newPassword),
    onSuccess: () => {
      showSuccess('密码修改成功');
      passwordForm.resetFields();
    },
    onError: createErrorHandler({
      operationName: '修改密码',
      customMessages: {
        auth: '需要登录才能修改密码',
      },
    }),
  });

  const handlePasswordChange = (values: PasswordFormValues) => {
    if (values.newPassword !== values.confirmPassword) {
      showError(null, '两次输入的新密码不一致');
      return;
    }
    changePasswordMutation.mutate({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
  };

  return (
    <SettingsPanel
      title="登录密码"
      description="新密码长度至少 6 位，建议包含字母、数字和特殊字符。"
    >
      <Form
        form={passwordForm}
        {...formLayout}
        onFinish={handlePasswordChange}
      >
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password
            placeholder="请输入当前密码"
            prefix={<LockOutlined />}
            disabled={!isAuthenticated}
            style={{ maxWidth: 360 }}
          />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码长度至少为6位' },
          ]}
        >
          <Input.Password
            placeholder="请输入新密码（至少6位）"
            prefix={<LockOutlined />}
            disabled={!isAuthenticated}
            style={{ maxWidth: 360 }}
          />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的新密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password
            placeholder="请再次输入新密码"
            prefix={<LockOutlined />}
            disabled={!isAuthenticated}
            style={{ maxWidth: 360 }}
          />
        </Form.Item>

        <SettingsSaveBar hint={isAuthenticated ? undefined : '登录后可修改'}>
          <Button
            type="primary"
            icon={<LockOutlined />}
            htmlType="submit"
            loading={changePasswordMutation.isPending}
            disabled={!isAuthenticated}
          >
            修改密码
          </Button>
        </SettingsSaveBar>
      </Form>
    </SettingsPanel>
  );
}
