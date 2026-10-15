# 主题与样式

主题、颜色令牌、全局样式原语与页面布局规范已统一整理到 [`docs/前端设计系统.md`](../docs/前端设计系统.md)。

要点：

- 颜色唯一来源：`src/theme/tokens.ts`，运行时写入 `--c-*` CSS 变量并生成 antd 主题。
- 组件中用 `token('textSecondary')` / `getThemeColor(theme, 'text')`（均返回 `var(--c-*)`），不要写死颜色。
- 长文 Markdown 使用 `<Markdown>`（`src/utils/markdown.tsx`），排版由 `.prose` 提供。
