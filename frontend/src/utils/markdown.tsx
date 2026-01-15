/**
 * Markdown 组件配置
 * 统一的 ReactMarkdown 组件配置，支持主题切换
 */
import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { ThemeMode } from '@/contexts/ThemeContext';
import { getThemeColor } from './theme';

interface MarkdownComponentProps {
  children?: ReactNode;
  className?: string;
  href?: string;
}

/**
 * 创建 Markdown 组件配置
 */
export function createMarkdownComponents(theme: ThemeMode): Components {
  const textColor = getThemeColor(theme, 'text');
  const textSecondaryColor = getThemeColor(theme, 'textSecondary');
  const codeBg = getThemeColor(theme, 'codeBg');
  const codeText = getThemeColor(theme, 'codeText');
  const borderColor = getThemeColor(theme, 'border');
  const primaryColor = theme === 'dark' ? '#4096ff' : '#1890ff';

  return {
    p: ({ children }: MarkdownComponentProps) => (
      <p style={{ 
        marginBottom: '0.5em', 
        marginTop: 0,
        color: textColor,
      }}>
        {children}
      </p>
    ),
    strong: ({ children }: MarkdownComponentProps) => (
      <strong style={{ 
        fontWeight: 600,
        color: textColor,
      }}>
        {children}
      </strong>
    ),
    em: ({ children }: MarkdownComponentProps) => (
      <em style={{ 
        fontStyle: 'italic',
        color: textSecondaryColor,
      }}>
        {children}
      </em>
    ),
    ul: ({ children }: MarkdownComponentProps) => (
      <ul style={{ 
        marginBottom: '0.5em', 
        paddingLeft: '1.5em',
        color: textColor,
      }}>
        {children}
      </ul>
    ),
    ol: ({ children }: MarkdownComponentProps) => (
      <ol style={{ 
        marginBottom: '0.5em', 
        paddingLeft: '1.5em',
        color: textColor,
      }}>
        {children}
      </ol>
    ),
    li: ({ children }: MarkdownComponentProps) => (
      <li style={{ 
        marginBottom: '0.25em',
        color: textColor,
      }}>
        {children}
      </li>
    ),
    h1: ({ children }: MarkdownComponentProps) => (
      <h1 style={{ 
        fontSize: '1.5em', 
        fontWeight: 600, 
        marginBottom: '0.5em', 
        marginTop: 0,
        color: textColor,
      }}>
        {children}
      </h1>
    ),
    h2: ({ children }: MarkdownComponentProps) => (
      <h2 style={{ 
        fontSize: '1.3em', 
        fontWeight: 600, 
        marginBottom: '0.5em', 
        marginTop: 0,
        color: textColor,
      }}>
        {children}
      </h2>
    ),
    h3: ({ children }: MarkdownComponentProps) => (
      <h3 style={{ 
        fontSize: '1.1em', 
        fontWeight: 600, 
        marginBottom: '0.5em', 
        marginTop: 0,
        color: textColor,
      }}>
        {children}
      </h3>
    ),
    code: ({ children, className }: MarkdownComponentProps) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code style={{ 
            backgroundColor: codeBg,
            color: codeText,
            padding: '2px 4px', 
            borderRadius: '3px', 
            fontSize: '0.9em',
            fontFamily: 'monospace',
          }}>
            {children}
          </code>
        );
      }
      return (
        <code style={{ 
          display: 'block',
          backgroundColor: codeBg,
          color: codeText,
          padding: '12px', 
          borderRadius: '4px', 
          fontSize: '0.9em',
          fontFamily: 'monospace',
          overflow: 'auto',
          marginBottom: '12px',
        }}>
          {children}
        </code>
      );
    },
    blockquote: ({ children }: MarkdownComponentProps) => (
      <blockquote style={{ 
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: '1em', 
        margin: '0.5em 0', 
        color: textSecondaryColor,
        fontStyle: 'italic',
      }}>
        {children}
      </blockquote>
    ),
    a: ({ children, href }: MarkdownComponentProps) => (
      <a
        href={href}
        style={{ 
          color: primaryColor, 
          textDecoration: 'none' 
        }}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
  };
}
