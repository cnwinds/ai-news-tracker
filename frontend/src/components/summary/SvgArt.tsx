/**
 * 报告配图：渲染 LLM 生成的 SVG（前端二次白名单清洗），颜色由 .svg-art 下的 f-* / s-* class 跟随主题
 */
import { useMemo } from 'react';

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask',
  'marker', 'pattern', 'symbol', 'use',
]);
const UNSAFE_VALUE = /javascript:|expression|@import|url\(\s*['"]?(?!#)/i;

export function sanitizeSvg(raw: string | null | undefined): string | null {
  if (!raw || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;

  const walk = (el: Element) => {
    Array.from(el.children).forEach((child) => {
      if (!ALLOWED_TAGS.has(child.nodeName.toLowerCase())) child.remove();
      else walk(child);
    });
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const isHref = name === 'href' || name === 'xlink:href';
      if (name.startsWith('on') || UNSAFE_VALUE.test(attr.value) || (isHref && !attr.value.startsWith('#'))) {
        el.removeAttribute(attr.name);
      }
    });
  };
  walk(root);
  root.removeAttribute('width');
  root.removeAttribute('height');
  return new XMLSerializer().serializeToString(root);
}

interface SvgArtProps {
  svg: string | null | undefined;
  label: string;
  className?: string;
}

export default function SvgArt({ svg, label, className }: SvgArtProps) {
  const html = useMemo(() => sanitizeSvg(svg), [svg]);
  if (!html) return null;
  return (
    <div
      className={`svg-art${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 无配图时的确定性抽象图形（同一标题总是同一张） */
export function PatternArt({ seed, variant = 'trend' }: { seed: string; variant?: 'cover' | 'trend' }) {
  const h = hash(seed);
  const w = variant === 'cover' ? 1200 : 640;
  const ht = variant === 'cover' ? 420 : 360;
  const cols = variant === 'cover' ? 24 : 16;
  const rows = variant === 'cover' ? 10 : 9;
  const gap = w / cols;
  const tones = ['f-accent', 'f-cool', 'f-violet', 'f-warn'];
  const tone = tones[h % tones.length];
  const cx = (0.55 + ((h >> 3) % 30) / 100) * w;
  const cy = (0.35 + ((h >> 7) % 30) / 100) * ht;

  const dots = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * gap + gap / 2;
      const y = r * (ht / rows) + ht / rows / 2;
      const d = Math.hypot(x - cx, y - cy) / w;
      const lit = ((h >> ((r * cols + c) % 24)) & 3) === 0 && d < 0.32;
      dots.push(<circle key={`${r}-${c}`} cx={x} cy={y} r={lit ? 3.2 : 1.6} className={lit ? tone : 'f-muted'} opacity={lit ? 0.9 : 0.35} />);
    }
  }

  return (
    <div className="svg-art svg-art--pattern" aria-hidden>
      <svg viewBox={`0 0 ${w} ${ht}`} xmlns="http://www.w3.org/2000/svg">
        {dots}
        {[0.12, 0.2, 0.3].map((k, i) => (
          <circle key={k} cx={cx} cy={cy} r={k * w} className={`f-none ${i === 0 ? tone.replace('f-', 's-') : 's-line'}`} strokeWidth={i === 0 ? 2 : 1} />
        ))}
      </svg>
    </div>
  );
}
