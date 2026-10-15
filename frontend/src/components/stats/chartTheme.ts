/**
 * recharts 主题：全部使用 CSS 变量，主题切换无需重渲染
 */
import type { CSSProperties } from 'react';

export const CHART_SERIES = [
  'var(--c-chart-1)',
  'var(--c-chart-2)',
  'var(--c-chart-3)',
  'var(--c-chart-4)',
  'var(--c-chart-5)',
] as const;

const tick = {
  fill: 'var(--c-text-tertiary)',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

export const gridProps = {
  stroke: 'var(--c-border)',
  strokeDasharray: '3 3',
};

export const axisProps = {
  tick,
  stroke: 'var(--c-border)',
  tickLine: false,
  axisLine: { stroke: 'var(--c-border)' },
};

const tooltipContentStyle: CSSProperties = {
  background: 'var(--c-elevated)',
  border: '1px solid var(--c-border)',
  borderRadius: 8,
  boxShadow: 'var(--c-shadow-md)',
  padding: '8px 12px',
  fontSize: 12,
};

export const tooltipProps = {
  contentStyle: tooltipContentStyle,
  labelStyle: { color: 'var(--c-text-secondary)', fontFamily: 'var(--font-mono)', marginBottom: 4 },
  itemStyle: { color: 'var(--c-text)', padding: '1px 0' },
};

export const barCursor = { fill: 'var(--c-hover)' };

export const lineCursor = { stroke: 'var(--c-border-strong)', strokeDasharray: '3 3' };
