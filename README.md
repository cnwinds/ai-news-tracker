# 🤖 AI News Tracker

> 自动采集、AI智能分析、RAG检索增强生成、推送全球AI前沿资讯的智能系统

## ✨ 功能特性

### 📡 数据采集
- **多源采集**: 支持RSS订阅、API接口（arXiv、Hugging Face）、网页爬虫、Twitter采集
- **智能去重**: 基于URL和标题自动去重，避免重复采集
- **实时监控**: WebSocket实时推送采集进度和状态

### 🤖 AI智能分析
- **自动摘要**: 使用大语言模型自动生成文章摘要
- **关键点提取**: 智能提取文章关键信息点
- **智能标签**: 自动分类和打标签
- **重要性评分**: AI评估文章重要性（高/中/低）

### 🔍 RAG检索增强生成
- **语义搜索**: 基于向量相似度的语义搜索，快速找到相关文章
- **智能问答**: 基于检索到的文章内容进行智能问答
- **向量索引**: 自动将文章内容转换为向量并建立索引
- **批量索引**: 支持批量索引历史文章

### 🌐 Web Dashboard
- **现代化界面**: React + TypeScript + Ant Design 构建的可视化界面
- **实时更新**: WebSocket实时推送数据更新
- **数据统计**: 可视化展示采集统计、文章分布等
- **系统设置**: 可视化配置系统参数（采集频率、摘要时间等）

### 📱 通知推送
- **多平台支持**: 支持飞书和钉钉两种通知方式
- **自动推送**: 每日/每周自动推送摘要到配置的通知平台
- **即时提醒**: 高重要性文章采集后即时推送
- **推送历史**: 查看推送历史记录

### ⏰ 定时调度
- **自动采集**: 可配置的定时采集任务
- **自动摘要**: 定时生成每日/每周摘要
- **灵活配置**: 通过Web界面配置调度时间

### 🗑️ 数据管理
- **数据清理**: 自动清理过期数据
- **数据统计**: 详细的采集和文章统计
- **订阅管理**: 可视化管理RSS订阅源

## 📊 数据源

### 官方博客
- OpenAI Blog
- Google DeepMind
- Meta AI
- Google AI
- Microsoft Research
- Anthropic Research

### 论文平台
- arXiv (cs.AI, cs.LG, cs.CL, cs.CV)
- Hugging Face Papers
- Papers with Code

### 社交媒体（可选）
- Twitter/X
- Reddit r/MachineLearning
- Hacker News AI板块

## 🛠️ 技术栈

### 后端
- **FastAPI** - 现代化Python Web框架
- **SQLAlchemy** - ORM数据库操作
- **SQLite** - 轻量级数据库（支持向量存储）
- **APScheduler** - 定时任务调度
- **OpenAI API** - AI分析和向量嵌入
- **WebSocket** - 实时通信

### 前端
- **React 18** - UI框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Ant Design 5** - UI组件库
- **React Query** - 数据获取和状态管理
- **React Router** - 路由
- **Recharts** - 图表库

## 📁 项目结构

```
ai-news-tracker/
├── backend/                    # 后端代码
│   └── app/
│       ├── main.py             # FastAPI应用入口
│       ├── api/                # API路由
│       │   └── v1/
│       │       ├── api.py      # 路由聚合
│       │       └── endpoints/  # API端点
│       │           ├── articles.py      # 文章管理
│       │           ├── collection.py   # 采集任务
│       │           ├── summary.py      # 摘要生成
│       │           ├── sources.py      # 订阅管理
│       │           ├── statistics.py   # 数据统计
│       │           ├── cleanup.py     # 数据清理
│       │           ├── settings.py    # 系统设置
│       │           ├── websocket.py   # WebSocket
│       │           └── rag.py         # RAG功能
│       ├── core/               # 核心配置
│       │   ├── config.py       # FastAPI配置
│       │   ├── settings.py     # 应用配置管理
│       │   ├── security.py    # 安全配置（CORS等）
│       │   └── dependencies.py # 依赖注入
│       ├── db/                 # 数据库模块
│       │   ├── models.py       # 数据模型
│       │   ├── repositories.py # 数据访问层
│       │   └── session.py      # 数据库会话管理
│       ├── services/           # 业务服务层
│       │   ├── analyzer/       # AI分析服务
│       │   │   └── ai_analyzer.py
│       │   ├── collector/      # 数据采集服务
│       │   │   ├── service.py
│       │   │   ├── rss_collector.py
│       │   │   ├── api_collector.py
│       │   │   ├── web_collector.py
│       │   │   ├── twitter_collector.py
│       │   │   └── summary_generator.py
│       │   ├── rag/            # RAG服务
│       │   │   ├── rag_service.py
│       │   │   └── README.md
│       │   └── scheduler/      # 定时任务调度
│       │       └── scheduler.py
│       ├── schemas/            # Pydantic模型
│       │   ├── article.py
│       │   ├── collection.py
│       │   ├── summary.py
│       │   ├── source.py
│       │   ├── statistics.py
│       │   ├── settings.py
│       │   └── rag.py
│       ├── utils/              # 工具模块
│       │   ├── logger.py       # 日志管理
│       │   └── factories.py    # 工厂函数
│       └── sources.json        # 数据源配置
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── components/         # React组件
│   │   │   ├── ArticleList.tsx
│   │   │   ├── ArticleCard.tsx
│   │   │   ├── CollectionHistory.tsx
│   │   │   ├── DailySummary.tsx
│   │   │   ├── Statistics.tsx
│   │   │   ├── SourceManagement.tsx
│   │   │   ├── DataCleanup.tsx
│   │   │   ├── SystemSettings.tsx
│   │   │   ├── RAG.tsx
│   │   │   ├── RAGChat.tsx
│   │   │   └── RAGSearch.tsx
│   │   ├── pages/              # 页面组件
│   │   │   └── Dashboard.tsx
│   │   ├── services/           # API服务
│   │   │   ├── api.ts
│   │   │   └── websocket.ts
│   │   ├── hooks/              # 自定义Hooks
│   │   │   ├── useArticles.ts
│   │   │   └── useWebSocket.ts
│   │   ├── types/              # TypeScript类型
│   │   │   └── index.ts
│   │   ├── App.tsx             # 主应用组件
│   │   └── main.tsx            # 入口文件
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/
│   └── app/
│       └── requirements.txt    # Python依赖
├── logs/                       # 日志目录
└── README.md                   # 项目文档
```

## 📚 文档索引

`docs/` 目录文档（与代码实现保持同步）：

- [模型先知设计文档（原自主探索）](docs/autonomous-exploration-design.md)
- [模型先知部署指南（原自主探索）](docs/autonomous-exploration-setup.md)
- [模型先知交付总结（原自主探索）](docs/autonomous-exploration-summary.md)
- [邮件正则解析器使用指南](docs/email_regex_parser_guide.md)
- [交互重构需求文档](docs/xq.md)
- [代码开发规范](docs/代码开发规范.md)
- [功能需求说明书](docs/功能需求说明书.md)

## 🚀 快速开始

### 1. 环境要求

- Python 3.9+
- Node.js 16+ (用于前端)
- pip
- npm 或 yarn

### 2. 安装依赖

#### 后端依赖

```bash
# 克隆项目
git clone <repository-url>
cd ai-news-tracker

# 安装Python依赖
pip install -r backend/app/requirements.txt
```

#### 前端依赖

```bash
cd frontend
npm install
```

### 3. 配置环境变量

创建 `.env` 文件（在项目根目录）：

```env
# 数据库（默认SQLite，可选）
DATABASE_URL=sqlite:///./backend/app/data/ai_news.db

# Web服务器配置（可选）
WEB_HOST=0.0.0.0
WEB_PORT=8000

# 日志配置（可选）
LOG_LEVEL=INFO
LOG_FILE=logs/app.log
```

**注意**：LLM API 配置（API地址、密钥、模型等）和通知配置（飞书/钉钉Webhook）现在通过 Web 界面的"系统设置"页面进行配置，存储在数据库中。启动服务后，访问系统设置页面进行配置。

**注意**：数据库会在首次启动时自动初始化，无需手动初始化。

### 4. 启动服务

#### 方式一：使用 Docker 部署（推荐）

项目提供了完整的 Docker 部署方案，最简单快捷：

```bash
# 进入 docker 目录
cd docker

# 启动所有服务
./start.sh

# 停止所有服务
./stop.sh
```

或者直接使用 Docker Compose：

```bash
# 在项目根目录下执行
docker compose -f docker/docker-compose.yml up -d --build

# 停止服务
docker compose -f docker/docker-compose.yml down
```

**详细说明请查看 [Docker 部署指南](./docker/README.md)**

#### 方式二：手动启动（开发模式）

**启动后端API服务：**

```bash
# 启动FastAPI服务器
python -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 http://localhost:8000/docs 查看API文档

**启动前端开发服务器：**

```bash
cd frontend
npm run dev
```

访问 http://localhost:5173 查看Web界面

#### 配置系统设置

启动服务后，首次使用需要配置系统设置：

1. 访问 Web 界面：http://localhost:5173
2. 进入"系统设置"页面
3. 配置以下内容：
   - **LLM设置**：填写 OpenAI API 地址、密钥、模型名称等（必需，用于AI分析和RAG功能）
   - **通知设置**：选择通知平台（飞书/钉钉），填写Webhook URL（可选，用于推送通知）
   - **采集设置**：配置自动采集频率等
   - **摘要设置**：配置每日/每周摘要时间等

**注意**：定时任务调度器会在后端服务启动时自动启动（如果系统设置中启用了自动采集）。无需单独启动。

## 📖 使用指南

### Web界面使用

1. **文章管理**: 在Dashboard中浏览、筛选、搜索文章
2. **采集任务**: 手动触发采集任务，查看采集历史
3. **每日摘要**: 查看和生成AI摘要
4. **数据统计**: 查看采集统计、文章分布等可视化数据
5. **订阅管理**: 管理RSS订阅源，启用/禁用数据源
6. **系统设置**: 配置采集频率、摘要时间、AI模型等
7. **RAG功能**: 使用语义搜索和智能问答
8. **数据清理**: 清理过期数据，释放存储空间

### RAG功能使用

#### 1. 索引文章

首次使用需要索引现有文章：

```bash
# 通过API索引所有文章
curl -X POST http://localhost:8000/api/v1/rag/index/all?batch_size=10
```

或在Web界面的RAG页面中点击"索引所有文章"按钮。

#### 2. 语义搜索

在Web界面的RAG页面中：
- 输入搜索关键词
- 选择筛选条件（来源、重要性等）
- 查看搜索结果

#### 3. 智能问答

在Web界面的RAG Chat中：
- 输入问题
- 系统会自动检索相关文章并生成答案
- 查看答案来源文章

详细API文档请参考 [RAG服务README](backend/app/services/rag/README.md)

## ⚙️ 配置说明

### 数据源配置

编辑 `backend/app/sources.json` 可以：
- 启用/禁用数据源
- 调整采集优先级
- 修改每源最大文章数
- 添加自定义RSS源

### 系统设置（Web界面）

**重要**：以下配置均通过 Web 界面的"系统设置"页面进行配置，存储在数据库中，无需在 `.env` 文件中配置。

通过Web界面的"系统设置"页面可以配置：

- **采集设置**: 自动采集开关、采集频率、最大文章数等
- **摘要设置**: 每日/每周摘要开关、摘要时间、摘要数量等
- **LLM设置**: 
  - API地址（如 `https://api.openai.com/v1`）
  - API密钥
  - 模型名称（如 `gpt-4-turbo-preview`）
  - 嵌入模型（如 `text-embedding-3-small`）
  - 温度等参数
- **通知设置**: 
  - 通知平台选择（飞书/钉钉）
  - Webhook URL（飞书或钉钉的Webhook地址）
  - 加签密钥（钉钉可选，如果使用了加签安全设置）
  - 推送开关（每日摘要、每周摘要、高重要性文章即时推送）

**配置步骤**：
1. 启动后端和前端服务
2. 访问 Web 界面（http://localhost:5173）
3. 进入"系统设置"页面
4. 在相应的配置项中填写信息并保存

### AI分析配置

支持的LLM API（在系统设置的"LLM设置"中配置）：
- OpenAI官方
- Azure OpenAI
- 各种兼容OpenAI格式的第三方API（如DeepSeek、Claude等）

### 通知配置（飞书/钉钉）

系统支持飞书和钉钉两种通知方式，可以在系统设置中配置：

#### 飞书机器人配置

1. 在飞书群组中创建自定义机器人
2. 获取Webhook URL
3. 在Web界面的"系统设置" → "通知设置"中：
   - 选择通知平台为"飞书"
   - 填写飞书Webhook URL
   - 保存配置

#### 钉钉机器人配置

1. 在钉钉群组中添加自定义机器人
2. 获取Webhook URL（安全设置建议选择"加签"）
3. 在Web界面的"系统设置" → "通知设置"中：
   - 选择通知平台为"钉钉"
   - 填写钉钉Webhook URL
   - 如果使用了加签，填写加签密钥
   - 保存配置

#### 通知触发时机

配置了通知地址后，系统会在以下情况自动发送通知：
- **每日摘要推送**: 每日摘要生成完成后自动推送
- **每周摘要推送**: 每周摘要生成完成后自动推送
- **高重要性文章**: 采集到高重要性文章时即时推送（如果启用了即时通知）

## 🔧 高级功能

### 自定义数据源

编辑 `backend/app/sources.json` 添加自己的RSS源：

```json
{
  "name": "My Custom Feed",
  "url": "https://example.com/rss",
  "category": "custom",
  "enabled": true,
  "priority": 2,
  "max_articles": 50
}
```

### Docker部署（可选）

创建 `Dockerfile`：

```dockerfile
FROM python:3.9-slim

WORKDIR /app

# 安装依赖
COPY backend/app/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# 复制代码
COPY . .

# 启动命令
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

构建运行：

```bash
docker build -t ai-news-tracker .
docker run -d --env-file .env -p 8000:8000 ai-news-tracker
```

### 数据库迁移

项目使用SQLAlchemy ORM，数据库结构变更会自动处理。首次运行时会自动创建数据库表。

## 📈 数据库结构

### articles（文章表）
- 标题、URL、内容
- 来源、作者、发布时间
- AI总结、关键点、标签
- 重要性、目标受众
- 向量嵌入（用于RAG）

### collection_logs（采集日志）
- 记录每次采集的源、状态、文章数
- 采集时间、耗时

### notification_logs（推送日志）
- 记录推送历史和状态
- 推送时间、内容摘要

### settings（系统设置表）
- 采集配置
- 摘要配置
- LLM配置
- 通知配置

## 🐛 故障排查

### 问题1：RSS采集失败
- 检查网络连接
- 某些RSS源可能需要代理
- 查看日志文件 `logs/app.log`

### 问题2：AI分析报错
- 检查系统设置中的"LLM设置"是否已正确配置
- 检查API密钥是否正确（在系统设置中查看）
- 检查API额度是否充足
- 尝试更换API端点（在系统设置中修改）
- 检查模型名称是否正确（在系统设置中查看）

### 问题3：通知推送失败
- 确认系统设置中的"通知设置"已选择通知平台并填写Webhook URL
- 检查Webhook URL是否正确
- **飞书**: 检查飞书机器人权限，确认机器人未被移除
- **钉钉**: 如果使用了加签，检查加签密钥是否正确
- 查看推送日志了解详细错误信息

### 问题4：RAG功能异常
- 确保系统设置中的"LLM设置"已正确配置（包括API密钥和嵌入模型）
- 检查向量索引是否已创建
- 查看RAG服务日志

### 问题5：前端无法连接后端
- 确认后端服务已启动（默认端口8000）
- 检查前端环境变量 `VITE_API_BASE_URL`
- 检查CORS配置

### 问题6：SQLite版本过低警告

如果看到警告信息：`⚠️ SQLite版本 X.X.X 过低，sqlite-vec需要3.41+，将使用Python向量计算`

**这是正常的，可以忽略**：
- ✅ 系统会自动回退到 Python 向量计算，功能完全正常
- ✅ RAG 功能（语义搜索、智能问答）可以正常使用
- ⚠️ 性能可能稍慢，但对于中小规模数据影响不大

**如果想升级 SQLite 以获得更好性能**（可选）：

**Windows**:
- 下载最新版 SQLite：https://www.sqlite.org/download.html
- 替换系统 SQLite DLL 或使用 Python 的 `pysqlite3-binary` 包

**Linux/macOS**:
- 使用包管理器升级 SQLite：`apt-get install sqlite3` 或 `brew install sqlite3`
- 或使用 `pysqlite3-binary` 包

**使用 pysqlite3-binary（推荐）**：
```bash
pip install pysqlite3-binary
# 然后在代码中优先使用 pysqlite3 而不是 sqlite3
```

## 📝 开发计划

- [x] 基础数据采集功能
- [x] AI智能分析
- [x] Web Dashboard
- [x] RAG检索增强生成
- [x] WebSocket实时通信
- [x] 系统设置管理
- [ ] 支持更多数据源（YouTube、Podcast等）
- [ ] 用户个性化推荐
- [ ] 数据导出功能（PDF、邮件）
- [ ] 多语言支持
- [ ] 移动端适配

## 🔄 版本历史

### v2.0.0 - 架构重构

**新增功能**：
- ✨ RAG检索增强生成功能
- ✨ WebSocket实时通信
- ✨ 系统设置管理（Web界面）
- ✨ 数据清理功能
- ✨ 向量搜索和智能问答

**架构改进**：
- 🏗️ 模块化项目结构
- 🏗️ 统一配置管理模块
- 🏗️ 统一日志管理模块
- 🏗️ 数据访问层（Repository模式）
- 🏗️ 工厂函数模块

**性能优化**：
- 🚀 添加数据库复合索引，优化查询性能
- 🚀 优化Web界面数据库查询，减少内存使用
- 🚀 使用聚合查询替代加载全部数据

**代码改进**：
- 📝 移除未使用的导入和代码
- 📝 统一AI分析器初始化逻辑
- 📝 改进类型提示和文档
- 📝 清理重复代码

## 📄 License

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📮 联系方式

如有问题，请提交Issue。

---

⭐ 如果觉得有用，请给个Star！
