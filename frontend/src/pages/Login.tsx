/**
 * 登录页面
 */
import { useState } from 'react';
import { Form, Input, Button, Tooltip } from 'antd';
import { UserOutlined, LockOutlined, ArrowLeftOutlined, SunOutlined, MoonOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useMessage } from '@/hooks/useMessage';
import '@/styles/pages/auth.css';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const message = useMessage();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const success = await login(values.username, values.password);
      if (success) {
        message.success('登录成功');
        navigate('/');
      } else {
        message.error('登录失败，请检查用户名和密码');
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : '登录失败，请检查用户名和密码';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__topbar">
        <button type="button" className="auth__back" onClick={() => navigate('/')}>
          <ArrowLeftOutlined /> 返回首页
        </button>
        <Tooltip title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          </button>
        </Tooltip>
      </div>

      <main className="auth-card">
        <div className="auth-brand">
          <img className="auth-brand__mark" src="/favicon.svg" alt="" width={44} height={44} />
          <div>
            <div className="auth-brand__name">
              AI <span>News</span>
            </div>
            <p className="auth-brand__desc">请登录以修改系统设置</p>
          </div>
        </div>

        <Form
          name="login"
          className="auth-form"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
          requiredMark={false}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
              autoFocus
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item className="auth-form__submit">
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div className="auth-hint">
          默认账号 <span className="kbd">admin</span> / <span className="kbd">admin123</span>
        </div>
      </main>

      <div className="auth-footer">AI News Tracker</div>
    </div>
  );
}
