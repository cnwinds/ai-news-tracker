/**
 * 访问统计组件
 */
import { useState, type ReactNode } from 'react';
import { Select, Spin, Alert, Table } from 'antd';
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
import { CHART_SERIES, axisProps, gridProps, lineCursor, tooltipProps } from '@/components/stats/chartTheme';
import '@/styles/pages/stats.css';

type MetricKey = 'page_views' | 'unique_users' | 'clicks';

const SERIES: { key: MetricKey; name: string; color: string }[] = [
  { key: 'page_views', name: '文章展开数', color: CHART_SERIES[0] },
  { key: 'unique_users', name: '独立用户数', color: CHART_SERIES[1] },
  { key: 'clicks', name: '详情查看数', color: CHART_SERIES[2] },
];

function TrendValue({ value, prev }: { value: number; prev?: number }) {
  let trend: ReactNode = null;
  if (prev !== undefined) {
    const diff = value - prev;
    if (diff > 0) {
      trend = (
        <span className="access-trend access-trend--up">
          <ArrowUpOutlined /> +{diff}
        </span>
      );
    } else if (diff < 0) {
      trend = (
        <span className="access-trend access-trend--down">
          <ArrowDownOutlined /> {diff}
        </span>
      );
    }
  }
  return (
    <span className="access-cell">
      <span className="access-cell__value">{value}</span>
      {trend}
    </span>
  );
}

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

  // 表格列定义（趋势与前一天比较）
  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (date: string) => <span className="access-date">{dayjs(date).format('YYYY-MM-DD')}</span>,
      sorter: (a: DailyAccessStats, b: DailyAccessStats) =>
        dayjs(a.date).unix() - dayjs(b.date).unix(),
      defaultSortOrder: 'descend' as const,
    },
    ...SERIES.map((s) => ({
      title: s.name,
      dataIndex: s.key,
      key: s.key,
      render: (value: number, _record: DailyAccessStats, index: number) => (
        <TrendValue value={value} prev={accessStats?.daily_stats[index + 1]?.[s.key]} />
      ),
    })),
  ];

  if (!isAuthenticated) {
    return (
      <Alert
        message="需要登录"
        description="请先登录以查看访问统计数据"
        type="warning"
        showIcon
      />
    );
  }

  return (
    <div className="stats">
      <div className="access-toolbar">
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 132 }}
          options={[
            { label: '最近7天', value: 7 },
            { label: '最近30天', value: 30 },
            { label: '最近90天', value: 90 },
            { label: '最近180天', value: 180 },
            { label: '最近365天', value: 365 },
          ]}
        />
        <span className="access-toolbar__live">
          <span className="dot dot--live" />
          数据每分钟自动刷新
        </span>
      </div>

      <Spin spinning={isLoading}>
        <div className="stats-stack">
          {error && (
            <Alert
              message="加载失败"
              description={(error as Error).message}
              type="error"
              showIcon
              closable
            />
          )}

          {accessStats && (
            <>
              <div className="stats-metrics stats-metrics--3">
                <div className="metric">
                  <span className="metric__label">
                    <span className="stats-metric__icon stats-metric__icon--accent"><EyeOutlined /></span>
                    总文章展开数
                  </span>
                  <span className="metric__value">{accessStats.total_page_views.toLocaleString()}</span>
                  <span className="metric__foot">
                    日均 <span className="stats-metric__foot-num">{accessStats.avg_daily_page_views}</span>
                  </span>
                </div>
                <div className="metric">
                  <span className="metric__label">
                    <span className="stats-metric__icon"><UserOutlined /></span>
                    总独立用户数
                  </span>
                  <span className="metric__value">{accessStats.total_unique_users.toLocaleString()}</span>
                  <span className="metric__foot">
                    日均 <span className="stats-metric__foot-num">{accessStats.avg_daily_users}</span>
                  </span>
                </div>
                <div className="metric">
                  <span className="metric__label">
                    <span className="stats-metric__icon"><ThunderboltOutlined /></span>
                    总详情查看数
                  </span>
                  <span className="metric__value">{accessStats.total_clicks.toLocaleString()}</span>
                  <span className="metric__foot">
                    近 <span className="stats-metric__foot-num">{days}</span> 天
                  </span>
                </div>
              </div>

              <section className="panel stats-panel">
                <div className="panel__head">
                  <span className="panel__title">每日访问趋势</span>
                </div>
                <div className="panel__body">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={accessStats.daily_stats.map((stat) => ({
                        ...stat,
                        date: dayjs(stat.date).format('MM-DD'),
                      }))}
                      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid {...gridProps} vertical={false} />
                      <XAxis dataKey="date" {...axisProps} minTickGap={16} />
                      <YAxis allowDecimals={false} {...axisProps} axisLine={false} />
                      <Tooltip {...tooltipProps} cursor={lineCursor} />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: 12, color: 'var(--c-text-secondary)', paddingTop: 8 }}
                      />
                      {SERIES.map((s) => (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stroke={s.color}
                          strokeWidth={2}
                          name={s.name}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-elevated)', fill: s.color }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel stats-panel">
                <div className="panel__head">
                  <span className="panel__title">每日访问明细</span>
                  <span className="stats-panel__hint mono">{accessStats.daily_stats.length} 天</span>
                </div>
                {accessStats.daily_stats.length === 0 ? (
                  <div className="panel__body">
                    <Alert
                      message="暂无数据"
                      description="当前时间段内没有访问记录"
                      type="info"
                      showIcon
                    />
                  </div>
                ) : (
                  <Table
                    className="access-table"
                    dataSource={accessStats.daily_stats}
                    columns={columns}
                    rowKey="date"
                    size="middle"
                    pagination={{
                      pageSize: 10,
                      showTotal: (total) => `共 ${total} 条记录`,
                      showSizeChanger: true,
                      showQuickJumper: true,
                    }}
                    scroll={{ x: true }}
                  />
                )}
              </section>
            </>
          )}
        </div>
      </Spin>
    </div>
  );
}
