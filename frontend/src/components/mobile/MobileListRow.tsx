import type { ReactNode } from 'react';

interface MobileListRowProps {
  title: string;
  meta: string;
  expanded?: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export default function MobileListRow({
  title,
  meta,
  expanded = false,
  onToggle,
  children,
}: MobileListRowProps) {
  return (
    <article className={`mobile-list-row${expanded ? ' mobile-list-row--open' : ''}`}>
      <button
        type="button"
        className="mobile-list-row__preview"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="mobile-list-row__title">{title}</span>
        <span className="mobile-list-row__meta">{meta}</span>
      </button>
      {expanded && children != null && (
        <div className="mobile-list-row__detail">{children}</div>
      )}
    </article>
  );
}
