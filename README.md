# 🤖 AI News Tracker

> 自动采集、AI智能分析、推送全球AI前沿资讯的智能系统

## ✨ 功能特性

- 📡 **多源采集**: 支持RSS订阅、API接口（arXiv、Hugging Face）、网页爬虫
- 🤖 **AI智能分析**: 自动生成摘要、提取关键点、智能标签分类、重要性评分
- 🌐 **Web Dashboard**: Streamlit搭建的可视化界面，随时查看最新资讯
- 📱 **飞书推送**: 每日自动推送摘要到飞书，高重要文章即时提醒
- ⏰ **定时调度**: 自动定时采集，每日生成并发送摘要
- 🔍 **智能搜索**: 支持按来源、主题、重要性、时间筛选

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
- Reddit r/MachineLearning
- Hacker News AI板块

## 🚀 快速开始

### 1. 环境要求

- Python 3.9+
- pip

### 2. 安装依赖

```bash
# 克隆项目
cd ai-news-tracker

# 安装依赖
pip install -r requirements.txt
```

### 3. 配置环境变量

```bash
# 初始化项目（复制配置文件）
python main.py init

# 编辑 .env 文件，填写以下配置：
```

**必需配置**：

```env
# LLM API（OpenAI兼容接口）
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4-turbo-preview

# 飞书机器人（可选）
FEISHU_BOT_WEBHOOK=your-feishu-webhook-url
```

**可选配置**：

```env
# 数据库（默认SQLite）
DATABASE_URL=sqlite:///./data/ai_news.db

# 定时任务
COLLECTION_CRON=0 */1 * * *      # 每小时采集
DAILY_SUMMARY_CRON=0 9 * * *     # 每天9点推送
```

### 4. 使用命令

#### 📥 采集数据

```bash
# 基础采集（不含AI分析）
python main.py collect --no-ai

# 完整采集（含AI分析）
python main.py collect --enable-ai
```

#### 📝 查看文章

```bash
# 列出最近24小时的文章
python main.py list

# 列出最近3天的高重要性文章
python main.py list --hours 72 --importance high

# 显示最近50篇
python main.py list --limit 50
```

#### 📊 生成摘要

```bash
# 生成每日摘要（控制台显示）
python main.py summary

# 自定义时间范围和数量
python main.py summary --hours 48 --limit 20
```

#### 📤 推送到飞书

```bash
# 发送每日摘要到飞书
python main.py send
```

#### 🌐 启动Web界面

```bash
# 启动Streamlit Dashboard
python main.py web
```

访问 http://localhost:8501 查看Web界面

#### ⏰ 启动定时任务

```bash
# 启动调度器（后台运行）
python main.py schedule
```

## 📁 项目结构

```
ai-news-tracker/
├── collector/           # 数据采集模块
│   ├── rss_collector.py      # RSS采集器
│   ├── api_collector.py      # API采集器（arXiv、HF等）
│   └── service.py            # 采集服务
├── analyzer/            # AI分析模块
│   └── ai_analyzer.py        # AI内容分析器
├── database/            # 数据库模块
│   ├── models.py             # 数据模型
│   ├── repositories.py        # 数据访问层（新增）
│   └── __init__.py           # 数据库管理
├── notification/         # 推送模块
│   ├── feishu_notifier.py    # 飞书通知器
│   └── service.py            # 推送服务
├── web/                 # Web界面
│   └── app.py                # Streamlit应用
├── config/              # 配置文件
│   ├── settings.py           # 统一配置管理（新增）
│   └── sources.json          # 数据源配置
├── utils/               # 工具模块（新增）
│   ├── logger.py            # 日志管理
│   └── factories.py         # 工厂函数
├── main.py              # CLI入口
├── scheduler.py         # 定时任务调度器
├── requirements.txt     # 依赖包
├── .env.example         # 环境变量示例
├── README.md            # 项目文档
└── REFACTORING.md      # 重构文档（新增）
```

## 🎯 使用场景

### 场景1：每日自动推送

1. 配置 `.env` 文件（API密钥 + 飞书Webhook）
2. 启动定时任务：`python main.py schedule`
3. 系统将自动：
   - 每小时采集最新资讯
   - 每天早上9点生成摘要并推送飞书

### 场景2：手动监控

1. 启动Web界面：`python main.py web`
2. 在浏览器中访问 Dashboard
3. 点击"开始采集"按钮手动触发
4. 浏览、筛选、搜索文章

### 场景3：命令行查看

```bash
# 采集数据
python main.py collect

# 查看最新文章
python main.py list --hours 24 --importance high
```

## ⚙️ 配置说明

### 数据源配置

编辑 `config/sources.json` 可以：
- 启用/禁用数据源
- 调整采集优先级
- 修改每源最大文章数
- 添加自定义RSS源

### AI分析配置

支持的LLM API（通过 `OPENAI_API_BASE` 配置）：
- OpenAI官方
- Azure OpenAI
- 各种兼容OpenAI格式的第三方API（如DeepSeek）

### 飞书机器人配置

1. 创建飞书机器人
2. 获取Webhook URL
3. 填写 `FEISHU_BOT_WEBHOOK` 环境变量

## 🔧 高级功能

### 自定义数据源

编辑 `config/sources.json` 添加自己的RSS源：

```json
{
  "name": "My Custom Feed",
  "url": "https://example.com/rss",
  "category": "custom",
  "enabled": true,
  "priority": 2
}
```

### Docker部署（可选）

创建 `Dockerfile`：

```dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["python", "main.py", "schedule"]
```

构建运行：

```bash
docker build -t ai-news-tracker .
docker run -d --env-file .env ai-news-tracker
```

## 📈 数据库结构

### articles（文章表）
- 标题、URL、内容
- 来源、作者、发布时间
- AI总结、关键点、标签
- 重要性、目标受众

### collection_logs（采集日志）
- 记录每次采集的源、状态、文章数

### notification_logs（推送日志）
- 记录推送历史和状态

## 🐛 故障排查

### 问题1：RSS采集失败
- 检查网络连接
- 某些RSS源可能需要代理

### 问题2：AI分析报错
- 检查 `OPENAI_API_KEY` 是否正确
- 检查API额度是否充足
- 尝试更换API端点

### 问题3：飞书推送失败
- 确认Webhook URL正确
- 检查飞书机器人权限

## 🔧 最近更新

### v2.0 - 代码重构与优化

**新增功能**：
- ✨ 统一配置管理模块（`config/settings.py`）
- ✨ 统一日志管理模块（`utils/logger.py`）
- ✨ 数据访问层（`database/repositories.py`）
- ✨ 工厂函数模块（`utils/factories.py`）

**性能优化**：
- 🚀 添加数据库复合索引，优化查询性能
- 🚀 优化Web界面数据库查询，减少内存使用
- 🚀 使用聚合查询替代加载全部数据

**代码改进**：
- 📝 移除未使用的导入和代码
- 📝 统一AI分析器初始化逻辑
- 📝 改进类型提示和文档
- 📝 清理重复代码

**文档更新**：
- 📖 添加详细的重构文档（`REFACTORING.md`）
- 📖 更新项目结构说明

## 📝 开发计划

- [ ] 支持更多数据源（Twitter、YouTube等）
- [ ] 添加向量搜索（语义相似度）
- [ ] 支持多语言摘要
- [ ] 用户个性化推荐
- [ ] 数据导出功能（PDF、邮件）

## 📄 License

MIT License

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📮 联系方式

如有问题，请提交Issue。

---

⭐ 如果觉得有用，请给个Star！
