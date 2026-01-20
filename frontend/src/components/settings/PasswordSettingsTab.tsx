/**
 * 密码修改标签页组件
 */
import { Form, Input, Button, Card, Alert } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import type { PasswordFormValues, ApiError } from './types';

export default function PasswordSettingsTab() {
  const { isAuthenticated } = useAuth();
  const message = useMessage();
  const [passwordForm] = Form.useForm();

  // 修改密码
  const changePasswordMutation = useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) =>
      apiService.changePassword(oldPassword, newPassword),
    onSuccess: () => {
      message.success('密码修改成功');
      passwordForm.resetFields();
    },
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能修改密码');
      } else {
        message.error(error.message || '修改密码失败');
      }
    },
  });

  const handlePasswordChange = (values: PasswordFormValues) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    changePasswordMutation.mutate({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
  };

  return (
    <Card>
      <Form
        form={passwordForm}
        layout="vertical"
        onFinish={handlePasswordChange}
        style={{ maxWidth: 500 }}
      >
        <Alert
          message="修改密码说明"
          description="请确保新密码长度至少为6位，建议使用包含字母、数字和特殊字符的强密码。"
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password
            placeholder="请输入当前密码"
            prefix={<LockOutlined />}
            disabled={!isAuthenticated}
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
          />
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            icon={<LockOutlined />}
            htmlType="submit"
            loading={changePasswordMutation.isPending}
            disabled={!isAuthenticated}
          >
            修改密码
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
