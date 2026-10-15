# AI News Tracker - 前端

React + TypeScript + Vite + Ant Design 构建的现代化前端界面。

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173

开发时可将 API 代理指向任意后端（默认 `http://localhost:8000`）：

```powershell
$env:VITE_PROXY_TARGET='https://your-backend.example.com'; npm run dev
```

### 构建生产版本

```bash
npm run build
```

构建产物在 `dist` 目录。

### 预览生产版本

```bash
npm run preview
```

## 技术栈

- **React 18** - UI框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Ant Design 5** - UI组件库
- **React Query** - 数据获取和状态管理
- **React Router** - 路由
- **Recharts** - 图表库
- **Axios** - HTTP客户端

## 项目结构

```
frontend/src/
├── theme/tokens.ts        # 设计令牌（颜色/字体/圆角）唯一来源
├── App.css                # 全局样式与样式原语
├── styles/                # 手机端样式、各页面样式（styles/pages/*.css）
├── components/
│   ├── layout/            # 桌面框架：侧栏、命令搜索、页面定义
│   ├── mobile/            # 手机框架：头部、底栏、更多面板
│   ├── article/           # 文章阅读器
│   ├── settings/          # 系统设置各分区
│   └── *.tsx              # 各业务页面
├── features/industryGraph # 行业趋势图谱
├── pages/                 # 路由页面：Dashboard / Login / Share*
├── services/              # API 与 WebSocket
├── hooks/  contexts/  utils/  types/
└── main.tsx
```

界面规范见 [`docs/前端设计系统.md`](../docs/前端设计系统.md)。

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```env
VITE_API_BASE_URL=/api/v1
VITE_WS_BASE_URL=/api/v1/ws
```

## 功能特性

- 🖥️ 桌面端侧栏 + 分栏阅读（列表 / 阅读器），快捷键 `1-6` 切页、`J/K` 切文章、`⌘/Ctrl+K` 搜索、`[` 折叠侧栏
- 📱 手机端悬浮底栏 + 全屏阅读页
- 🌗 深浅主题，基于设计令牌统一管理
- 📰 文章列表 - 支持筛选、分页、AI分析
- 🚀 采集历史 - 实时查看采集任务状态
- 📊 每日摘要 - 查看和生成AI摘要
- 📈 数据统计 - 可视化数据展示
- ⚙️ 订阅管理 - 管理RSS订阅源
- 🗑️ 数据清理 - 清理旧数据

## 开发说明

### API调用

使用 `apiService` 进行API调用：

```typescript
import { apiService } from '@/services/api';

// 获取文章列表
const articles = await apiService.getArticles({ page: 1, page_size: 20 });
```

### WebSocket连接

使用 `useWebSocket` Hook：

```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

const { connected, subscribe } = useWebSocket();

useEffect(() => {
  const unsubscribe = subscribe('collection_status', (data) => {
    console.log('采集状态更新:', data);
  });
  return unsubscribe;
}, [subscribe]);
```

## 注意事项

- 确保后端API服务已启动（开发模式默认端口8000）
- WebSocket连接需要后端支持
- 生产环境建议通过反向代理将同源 `/api` 路径转发到后端，减少对外暴露端口




