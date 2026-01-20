/**
 * 数据库管理标签页组件
 */
import { Card, Space, Button, Alert, Typography } from 'antd';
import { DatabaseOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useMessage } from '@/hooks/useMessage';
import type { ApiError } from './types';

export default function DatabaseSettingsTab() {
  const { isAuthenticated } = useAuth();
  const message = useMessage();

  // 数据库备份
  const backupDatabaseMutation = useMutation({
    mutationFn: () => apiService.backupDatabase(),
    onSuccess: async (blob: Blob) => {
      // 创建下载链接
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.href = url;
      a.download = `ai_news_backup_${timestamp}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success('数据库备份下载成功');
    },
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能备份数据库');
      } else {
        message.error(`备份数据库失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  // 数据库还原
  const restoreDatabaseMutation = useMutation({
    mutationFn: (file: File) => apiService.restoreDatabase(file),
    onSuccess: (data: { message: string; filename?: string; auto_backup?: string }) => {
      message.success(data.message || '数据库还原成功，请刷新页面');
      if (data.auto_backup) {
        message.info(`已自动备份原数据库到: ${data.auto_backup}`);
      }
      // 延迟刷新页面，让用户看到消息
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    },
    onError: (error: ApiError) => {
      if (error.status === 401) {
        message.error('需要登录才能还原数据库');
      } else {
        message.error(`还原数据库失败: ${error.response?.data?.detail || error.message}`);
      }
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.db')) {
        message.error('只能上传 .db 格式的数据库文件');
        return;
      }
      restoreDatabaseMutation.mutate(file);
      // 重置input，允许重复选择同一文件
      e.target.value = '';
    }
  };

  return (
    <Card
      title={
        <Space>
          <DatabaseOutlined />
          数据库备份与还原
        </Space>
      }
    >
      <Alert
        message="重要提示"
        description="数据库备份和还原功能允许您备份当前数据库或从备份文件还原。还原操作会替换当前数据库，请谨慎操作。系统会在还原前自动创建备份。"
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="数据库备份" type="inner">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Text>
              点击下方按钮下载当前数据库的备份文件。备份文件包含所有文章、配置和设置。
            </Typography.Text>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => backupDatabaseMutation.mutate()}
              loading={backupDatabaseMutation.isPending}
              disabled={!isAuthenticated}
              size="large"
            >
              下载数据库备份
            </Button>
          </Space>
        </Card>

        <Card title="数据库还原" type="inner">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Text>
              上传之前备份的数据库文件来还原数据库。还原操作会：
            </Typography.Text>
            <ul>
              <li>自动备份当前数据库（以防需要恢复）</li>
              <li>替换当前数据库为上传的备份文件</li>
              <li>需要刷新页面以使用新的数据库</li>
            </ul>
            <input
              type="file"
              accept=".db"
              id="restore-db-input"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Button
              type="primary"
              danger
              icon={<UploadOutlined />}
              onClick={() => {
                const input = document.getElementById('restore-db-input');
                if (input) {
                  input.click();
                }
              }}
              loading={restoreDatabaseMutation.isPending}
              disabled={!isAuthenticated}
              size="large"
            >
              上传数据库备份还原
            </Button>
          </Space>
        </Card>
      </Space>
    </Card>
  );
}
