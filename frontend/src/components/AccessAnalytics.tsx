/**
 * 访问统计组件
 */
import { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Select,
  Spin,
  Alert,
  Table,
  Typography,
  Space,
} from 'antd';
import {
  EyeOutlined,
  UserOutlined,
  ThunderboltOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import type { DailyAccessStats } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import dayjs from 'dayjs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const { Title, Text } = Typography;

export default function AccessAnalytics() {
  const { isAuthenticated } = useAuth();
  const [days, setDays] = useState(30);

  // 获取访问统计数据
  const { data: accessStats, isLoading, error } = useQuery({
    queryKey: ['access-stats', days],
    queryFn: () => apiService.getAccessStats(days),
    enabled: isAuthenticated,
    refetchInterval: 60000, // 每分钟自动刷新
  });

  // 表格列定义
  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
      sorter: (a: DailyAccessStats, b: DailyAccessStats) =>
        dayjs(a.date).unix() - dayjs(b.date).unix(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '文章展开数',
      dataIndex: 'page_views',
      key: 'page_views',
      render: (value: number, _record: DailyAccessStats, index: number) => {
        // 计算与前一天的差异
        const prevRecord = accessStats?.daily_stats[index + 1];
        let trend = null;
        if (prevRecord) {
          const diff = value - prevRecord.page_views;
          if (diff > 0) {
            trend = <Text type="success"><ArrowUpOutlined /> +{diff}</Text>;
          } else if (diff < 0) {
            trend = <Text type="danger"><ArrowDownOutlined /> {diff}</Text>;
          }
        }
        return (
          <Space>
            <Text strong>{value}</Text>
            {trend}
          </Space>
        );
      },
    },
    {
      title: '独立用户数',
      dataIndex: 'unique_users',
      key: 'unique_users',
      render: (value: number, _record: DailyAccessStats, index: number) => {
        // 计算与前一天的差异
        const prevRecord = accessStats?.daily_stats[index + 1];
        let trend = null;
        if (prevRecord) {
          const diff = value - prevRecord.unique_users;
          if (diff > 0) {
            trend = <Text type="success"><ArrowUpOutlined /> +{diff}</Text>;
          } else if (diff < 0) {
            trend = <Text type="danger"><ArrowDownOutlined /> {diff}</Text>;
          }
        }
        return (
          <Space>
            <Text strong>{value}</Text>
            {trend}
          </Space>
        );
      },
    },
    {
      title: '详情查看数',
      dataIndex: 'clicks',
      key: 'clicks',
      render: (value: number, _record: DailyAccessStats, index: number) => {
        // 计算与前一天的差异
        const prevRecord = accessStats?.daily_stats[index + 1];
        let trend = null;
        if (prevRecord) {
          const diff = value - prevRecord.clicks;
          if (diff > 0) {
            trend = <Text type="success"><ArrowUpOutlined /> +{diff}</Text>;
          } else if (diff < 0) {
            trend = <Text type="danger"><ArrowDownOutlined /> {diff}</Text>;
          }
        }
        return (
          <Space>
            <Text strong>{value}</Text>
            {trend}
          </Space>
        );
      },
    },
  ];

  if (!isAuthenticated) {
    return (
      <Card>
        <Alert
          message="需要登录"
          description="请先登录以查看访问统计数据"
          type="warning"
          showIcon
        />
      </Card>
    );
  }

  return (
    <div>
      <Card
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>访问统计</Title>
            <Select
              value={days}
              onChange={setDays}
              style={{ width: 120 }}
              options={[
                { label: '最近7天', value: 7 },
                { label: '最近30天', value: 30 },
                { label: '最近90天', value: 90 },
                { label: '最近180天', value: 180 },
                { label: '最近365天', value: 365 },
              ]}
            />
          </Space>
        }
        extra={<Text type="secondary">数据每分钟自动刷新</Text>}
      >
        <Spin spinning={isLoading}>
          {error && (
            <Alert
              message="加载失败"
              description={(error as Error).message}
              type="error"
              showIcon
              closable
              style={{ marginBottom: 16 }}
            />
          )}

          {accessStats && (
            <>
              {/* 汇总统计卡片 */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                  <Card>
                    <Statistic
                      title="总文章展开数"
                      value={accessStats.total_page_views}
                      prefix={<EyeOutlined />}
                      valueStyle={{ color: '#1890ff' }}
                    />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                      平均日展开数: {accessStats.avg_daily_page_views}
                    </div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card>
                    <Statistic
                      title="总独立用户数"
                      value={accessStats.total_unique_users}
                      prefix={<UserOutlined />}
                      valueStyle={{ color: '#52c41a' }}
                    />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                      平均日用户数: {accessStats.avg_daily_users}
                    </div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card>
                    <Statistic
                      title="总详情查看数"
                      value={accessStats.total_clicks}
                      prefix={<ThunderboltOutlined />}
                      valueStyle={{ color: '#fa8c16' }}
                    />
                  </Card>
                </Col>
              </Row>

              {/* 每日访问趋势折线图 */}
              <Title level={5}>每日访问趋势</Title>
              <Card style={{ marginBottom: 24 }}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={accessStats.daily_stats.map(stat => ({
                      ...stat,
                      date: dayjs(stat.date).format('MM-DD')
                    }))}
                    margin={{
                      top: 5,
                      right: 30,
                      left: 20,
                      bottom: 5,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      style={{ fontSize: 12 }}
                    />
                    <YAxis style={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid #d9d9d9',
                        borderRadius: '4px',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="page_views"
                      stroke="#1890ff"
                      strokeWidth={2}
                      name="文章展开数"
                      dot={{ fill: '#1890ff', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="unique_users"
                      stroke="#52c41a"
                      strokeWidth={2}
                      name="独立用户数"
                      dot={{ fill: '#52c41a', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="clicks"
                      stroke="#fa8c16"
                      strokeWidth={2}
                      name="详情查看数"
                      dot={{ fill: '#fa8c16', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              {/* 每日统计表格 */}
              <Title level={5}>每日访问明细</Title>
              <Table
                dataSource={accessStats.daily_stats}
                columns={columns}
                rowKey="date"
                pagination={{
                  pageSize: 10,
                  showTotal: (total) => `共 ${total} 条记录`,
                  showSizeChanger: true,
                  showQuickJumper: true,
                }}
                scroll={{ x: true }}
              />

              {accessStats.daily_stats.length === 0 && (
                <Alert
                  message="暂无数据"
                  description="当前时间段内没有访问记录"
                  type="info"
                  showIcon
                />
              )}
            </>
          )}
        </Spin>
      </Card>
    </div>
  );
}
