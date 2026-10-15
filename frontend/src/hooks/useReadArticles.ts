import { useCallback, useState } from 'react';

const STORAGE_KEY = 'ai-news-read-articles';
const MAX_ENTRIES = 3000;

function load(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

/** 本地记录已读文章（仅存于浏览器） */
export function useReadArticles() {
  const [readIds, setReadIds] = useState<Set<number>>(() => new Set(load()));

  const markRead = useCallback((id: number) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      const list = Array.from(next).slice(-MAX_ENTRIES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // 存储已满时忽略
      }
      return next;
    });
  }, []);

  return { readIds, markRead };
}
