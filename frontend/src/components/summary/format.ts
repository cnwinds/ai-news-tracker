/**
 * 内容总结：标题 / 日期格式化与分组
 */
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { DailySummaryListItem } from '@/types';

dayjs.extend(isoWeek);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export type SummaryTypeFilter = 'all' | 'daily' | 'weekly';

export const TYPE_LABEL: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
};

export function summaryHeading(summary: DailySummaryListItem): string {
  return summary.summary_type === 'daily' ? '每日摘要' : '每周摘要';
}

/** 列表行标题：日报显示日期 + 星期，周报显示起止日期 */
export function summaryRangeLabel(summary: DailySummaryListItem): string {
  if (summary.summary_type === 'daily') {
    const d = dayjs(summary.summary_date);
    return `${d.format('MM-DD')} ${WEEKDAYS[d.day()]}`;
  }
  return `${dayjs(summary.start_date).format('MM-DD')} ~ ${dayjs(summary.end_date).format('MM-DD')}`;
}

/** 阅读器中的完整日期 */
export function summaryFullRange(summary: DailySummaryListItem): string {
  if (summary.summary_type === 'daily') {
    const d = dayjs(summary.summary_date);
    return `${d.format('YYYY-MM-DD')} ${WEEKDAYS[d.day()]}`;
  }
  return `${dayjs(summary.start_date).format('YYYY-MM-DD')} ~ ${dayjs(summary.end_date).format('YYYY-MM-DD')}`;
}

export function summaryWeekTag(summary: DailySummaryListItem): string | null {
  if (summary.summary_type !== 'weekly') return null;
  return `W${String(dayjs(summary.summary_date).isoWeek()).padStart(2, '0')}`;
}

export function summaryLevel(summary: DailySummaryListItem): 'high' | 'medium' | 'low' {
  if (summary.high_importance_count > 0) return 'high';
  if (summary.medium_importance_count > 0) return 'medium';
  return 'low';
}

export function groupByMonth(
  items: DailySummaryListItem[]
): { key: string; label: string; items: DailySummaryListItem[] }[] {
  const groups: { key: string; label: string; items: DailySummaryListItem[] }[] = [];
  items.forEach((item) => {
    const d = dayjs(item.summary_type === 'weekly' ? item.end_date : item.summary_date);
    const key = d.isValid() ? d.format('YYYY-MM') : 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: d.isValid() ? d.format('YYYY.MM') : '未知日期', items: [item] });
    }
  });
  return groups;
}
