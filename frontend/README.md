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
frontend/
├── src/
│   ├── components/      # React组件
│   │   ├── ArticleList.tsx
│   │   ├── ArticleCard.tsx
│   │   ├── CollectionHistory.tsx
│   │   ├── DailySummary.tsx
│   │   ├── Statistics.tsx
│   │   ├── SourceManagement.tsx
│   │   └── DataCleanup.tsx
│   ├── pages/           # 页面组件
│   │   └── Dashboard.tsx
│   ├── services/        # API服务
│   │   ├── api.ts
│   │   └── websocket.ts
│   ├── hooks/           # 自定义Hooks
│   │   ├── useArticles.ts
│   │   └── useWebSocket.ts
│   ├── types/           # TypeScript类型
│   │   └── index.ts
│   ├── App.tsx          # 主应用组件
│   └── main.tsx         # 入口文件
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```env
VITE_API_BASE_URL=/api/v1
VITE_WS_BASE_URL=/api/v1/ws
```

## 功能特性

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




