/**
 * 统计数据组件
 */
import { Card, Row, Col, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function Statistics() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['statistics'],
    queryFn: () => apiService.getStatistics(),
  });

  if (isLoading || !stats) {
    return <div>加载中...</div>;
  }

  // 准备图表数据
  const sourceData = Object.entries(stats.source_distribution)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // 准备重要性分布数据
  const importanceData = [
    { name: '高重要性', value: stats.importance_distribution.high || 0 },
    { name: '中重要性', value: stats.importance_distribution.medium || 0 },
    { name: '低重要性', value: stats.importance_distribution.low || 0 },
    { name: '未分析', value: stats.importance_distribution.unanalyzed || 0 },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总文章数" value={stats.total_articles} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="今日新增" value={stats.today_count} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="高重要性" value={stats.high_importance} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待分析" value={stats.unanalyzed} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
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
        <Col span={12}>
          <Card title="重要性分布">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={importanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value">
                  {importanceData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`}
                      fill={
                        entry.name === '高重要性' ? '#cf1322' :
                        entry.name === '中重要性' ? '#fa8c16' :
                        entry.name === '低重要性' ? '#52c41a' : '#d9d9d9'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
}



