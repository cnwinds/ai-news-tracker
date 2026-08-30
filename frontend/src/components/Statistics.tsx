/**
 * 统计数据组件
 */
import { Card, Row, Col, Statistic, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { apiService } from '@/services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const MUTED_BAR = '#8b95a5';

export default function Statistics() {
  const { isMobile } = useBreakpoint();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['statistics'],
    queryFn: () => apiService.getStatistics(),
  });

  if (isLoading || !stats) {
    return isMobile ? (
      <div className="mobile-feed-loading"><Spin /></div>
    ) : (
      <div>加载中...</div>
    );
  }

  const sourceData = Object.entries(stats.source_distribution)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const importanceData = [
    { name: '高', value: stats.importance_distribution.high || 0 },
    { name: '中', value: stats.importance_distribution.medium || 0 },
    { name: '低', value: stats.importance_distribution.low || 0 },
    { name: '未分析', value: stats.importance_distribution.unanalyzed || 0 },
  ];

  const statRows = [
    { label: '总文章数', value: stats.total_articles },
    { label: '今日新增', value: stats.today_count },
    { label: '高重要性', value: stats.high_importance },
    { label: '待分析', value: stats.unanalyzed },
  ];

  if (isMobile) {
    return (
      <div className="mobile-list-page">
        <div className="mobile-list-toolbar">
          <span className="mobile-list-toolbar__meta">数据概览</span>
        </div>
        <div className="mobile-list">
          {statRows.map((row) => (
            <div key={row.label} className="mobile-stat-row">
              <span className="mobile-stat-row__label">{row.label}</span>
              <span className="mobile-stat-row__value">{row.value}</span>
            </div>
          ))}
        </div>
        <div className="mobile-section">
          <h3 className="mobile-section__title">来源分布</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-secondary)" />
              <XAxis dataKey="name" angle={-35} textAnchor="end" height={72} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill={MUTED_BAR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mobile-section">
          <h3 className="mobile-section__title">重要性分布</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={importanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-secondary)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill={MUTED_BAR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="总文章数" value={stats.total_articles} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="今日新增" value={stats.today_count} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="高重要性" value={stats.high_importance} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="待分析" value={stats.unanalyzed} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="来源分布">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sourceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#1890ff" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="重要性分布">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={importanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#1890ff" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
