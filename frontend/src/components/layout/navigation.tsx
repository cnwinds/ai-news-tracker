import type { ReactNode } from 'react';
import {
  ApartmentOutlined,
  BarChartOutlined,
  FileTextOutlined,
  ReadOutlined,
  RocketOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';

export type PageKey =
  | 'articles'
  | 'summary'
  | 'industry-graph'
  | 'exploration'
  | 'social-media'
  | 'statistics';

export interface PageDef {
  key: PageKey;
  label: string;
  /** 手机底栏等窄位置使用 */
  shortLabel: string;
  description: string;
  icon: ReactNode;
  group: 'core' | 'explore';
}

export const PAGES: PageDef[] = [
  {
    key: 'articles',
    label: '最新资讯',
    shortLabel: '资讯',
    description: '全球 AI 动态实时汇总',
    icon: <FileTextOutlined />,
    group: 'core',
  },
  {
    key: 'summary',
    label: '内容总结',
    shortLabel: '总结',
    description: 'AI 生成的每日 / 每周简报',
    icon: <ReadOutlined />,
    group: 'core',
  },
  {
    key: 'industry-graph',
    label: '行业趋势',
    shortLabel: '趋势',
    description: '技术演进与产业关系图谱',
    icon: <ApartmentOutlined />,
    group: 'core',
  },
  {
    key: 'exploration',
    label: '模型先知',
    shortLabel: '先知',
    description: '追踪预发布模型与更新信号',
    icon: <RocketOutlined />,
    group: 'explore',
  },
  {
    key: 'social-media',
    label: '社交平台',
    shortLabel: '社媒',
    description: 'AI 热点小报与社媒趋势',
    icon: <ShareAltOutlined />,
    group: 'explore',
  },
  {
    key: 'statistics',
    label: '数据统计',
    shortLabel: '统计',
    description: '采集量与文章分布概览',
    icon: <BarChartOutlined />,
    group: 'explore',
  },
];

export const PAGE_MAP = Object.fromEntries(PAGES.map((p) => [p.key, p])) as Record<PageKey, PageDef>;

export function isPageKey(value: string | null | undefined): value is PageKey {
  return !!value && value in PAGE_MAP;
}
