/**
 * 统计数据组件
 */
import type { ReactNode } from 'react';
import { Skeleton } from 'antd';
import {
  AlertOutlined,
  FileTextOutlined,
  HourglassOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { apiService } from '@/services/api';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { axisProps, barCursor, gridProps, tooltipProps } from '@/components/stats/chartTheme';
import '@/styles/pages/stats.css';

const IMPORTANCE_COLORS: Record<string, string> = {
  高: 'var(--c-danger)',
  中: 'var(--c-warning)',
  低: 'var(--c-chart-2)',
  未分析: 'var(--c-border-strong)',
};

function percent(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function MetricTile({
  label,
  icon,
  value,
  valueClass,
  foot,
  accent,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  valueClass?: string;
  foot?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="metric">
      <span className="metric__label">
        <span className={`stats-metric__icon${accent ? ' stats-metric__icon--accent' : ''}`}>{icon}</span>
        {label}
      </span>
      <span className={`metric__value${valueClass ? ` ${valueClass}` : ''}`}>{value.toLocaleString()}</span>
      {foot && <span className="metric__foot">{foot}</span>}
    </div>
  );
}

export default function Statistics() {
  const { isMobile } = useBreakpoint();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['statistics'],
    queryFn: () => apiService.getStatistics(),
  });

  if (isLoading || !stats) {
    return (
      <div className="stats">
        <div className="stats-metrics">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="metric stats-skeleton">
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel__body">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        </div>
      </div>
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
  const importanceTotal = importanceData.reduce((sum, d) => sum + d.value, 0);

  const total = stats.total_articles;
  const sourceChartHeight = Math.max(isMobile ? 200 : 260, sourceData.length * (isMobile ? 26 : 30) + 24);

  return (
    <div className="stats">
      <div className="stats-metrics">
        <MetricTile
          label="总文章数"
          icon={<FileTextOutlined />}
          value={total}
          foot={
            <>
              来源 <span className="stats-metric__foot-num">{Object.keys(stats.source_distribution).length}</span> 个
            </>
          }
        />
        <MetricTile
          label="今日新增"
          icon={<ThunderboltOutlined />}
          value={stats.today_count}
          valueClass="stats-metric__value--accent"
          accent
          foot={
            <>
              占总量 <span className="stats-metric__foot-num">{percent(stats.today_count, total)}</span>
            </>
          }
        />
        <MetricTile
          label="高重要性"
          icon={<AlertOutlined />}
          value={stats.high_importance}
          valueClass="stats-metric__value--danger"
          foot={
            <div className="stats-bar" aria-hidden>
              <div className="stats-bar__fill stats-bar__fill--danger" style={{ width: percent(stats.high_importance, total) }} />
            </div>
          }
        />
        <MetricTile
          label="待分析"
          icon={<HourglassOutlined />}
          value={stats.unanalyzed}
          foot={
            <div className="stats-bar" aria-hidden>
              <div className="stats-bar__fill stats-bar__fill--warning" style={{ width: percent(stats.unanalyzed, total) }} />
            </div>
          }
        />
      </div>

      <div className="stats-grid">
        <section className="panel stats-panel">
          <div className="panel__head">
            <span className="panel__title">来源分布</span>
            <span className="stats-panel__hint">Top {sourceData.length}</span>
          </div>
          <div className="panel__body">
            <ResponsiveContainer width="100%" height={sourceChartHeight}>
              <BarChart data={sourceData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={isMobile ? 96 : 140}
                  {...axisProps}
                  tick={{ ...axisProps.tick, fontFamily: 'var(--font-sans)', fill: 'var(--c-text-secondary)' }}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip {...tooltipProps} cursor={barCursor} formatter={(v: number) => [v, '文章数']} />
                <Bar dataKey="value" fill="var(--c-chart-1)" radius={[0, 4, 4, 0]} barSize={isMobile ? 12 : 14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel stats-panel">
          <div className="panel__head">
            <span className="panel__title">重要性分布</span>
            <span className="stats-panel__hint mono">{importanceTotal.toLocaleString()}</span>
          </div>
          <div className="panel__body">
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 210}>
              <BarChart data={importanceData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} vertical={false} />
                <XAxis
                  dataKey="name"
                  {...axisProps}
                  tick={{ ...axisProps.tick, fontFamily: 'var(--font-sans)', fontSize: 12 }}
                />
                <YAxis allowDecimals={false} {...axisProps} axisLine={false} />
                <Tooltip {...tooltipProps} cursor={barCursor} formatter={(v: number) => [v, '文章数']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {importanceData.map((d) => (
                    <Cell key={d.name} fill={IMPORTANCE_COLORS[d.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="stats-legend">
              {importanceData.map((d) => (
                <div key={d.name} className="stats-legend__row">
                  <span className="stats-legend__swatch" style={{ background: IMPORTANCE_COLORS[d.name] }} />
                  <span>{d.name === '未分析' ? d.name : `${d.name}重要度`}</span>
                  <span className="stats-legend__value">{d.value.toLocaleString()}</span>
                  <span className="stats-legend__pct">{percent(d.value, importanceTotal)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
