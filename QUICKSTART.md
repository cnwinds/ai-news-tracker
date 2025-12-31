# 🚀 快速使用指南

## 第一步：环境准备

### 1. 安装Python依赖

```bash
cd ai-news-tracker
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
# Windows
copy .env.example .env
notepad .env

# Linux/Mac
cp .env.example .env
nano .env
```

### 3. 编辑 .env 文件

**最小配置（必需）**：

```env
# OpenAI兼容API
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4-turbo-preview

# 飞书Webhook（可选，用于推送）
FEISHU_BOT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/...
```

**API获取指南**：
- **OpenAI**: https://platform.openai.com/api-keys
- **DeepSeek**（更便宜）: https://platform.deepseek.com/
- **飞书机器人**: 在飞书群聊中添加自定义机器人，获取Webhook URL

## 第二步：初始化项目

```bash
python main.py init
```

这将创建：
- `data/` 目录（存放数据库）
- `logs/` 目录（存放日志）
- `.env` 配置文件

## 第三步：开始使用

### 方式1：命令行模式

#### 📥 采集数据

```bash
# 采集数据（含AI分析）
python main.py collect --enable-ai
```

#### 📋 查看文章

```bash
# 查看最近24小时的文章
python main.py list

# 查看高重要性文章
python main.py list --importance high --limit 20
```

#### 📊 生成摘要

```bash
# 生成每日摘要
python main.py summary

# 自定义时间范围
python main.py summary --hours 48 --limit 15
```

#### 📤 推送到飞书

```bash
# 发送每日摘要到飞书
python main.py send
```

### 方式2：Web界面模式

```bash
# 启动Web Dashboard
python main.py web
```

浏览器会自动打开 http://localhost:8501

**Web界面功能**：
- 🎛️ 控制面板：手动触发采集
- 📰 文章列表：浏览最新资讯
- 🔍 智能筛选：按来源、时间、重要性筛选
- 📊 数据统计：查看采集统计

### 方式3：定时任务模式

```bash
# 启动定时调度器（后台运行）
python main.py schedule
```

**默认调度**：
- 每小时自动采集最新资讯
- 每天早上9点生成摘要并推送飞书

**修改调度时间**：编辑 `.env` 文件中的 `COLLECTION_CRON` 和 `DAILY_SUMMARY_CRON`

### 方式4：Windows快捷菜单

直接双击 `start.bat` 文件，选择操作：

```
1. 采集数据 (含AI分析)
2. 查看文章列表
3. 生成每日摘要
4. 启动Web界面
5. 启动定时任务
6. 发送摘要到飞书
```

## 常见使用场景

### 场景1：每天早上查看AI资讯

1. 配置飞书Webhook
2. 运行 `python main.py schedule`
3. 每天早上9点自动收到飞书推送

### 场景2：实时追踪重要资讯

1. 启动Web界面：`python main.py web`
2. 浏览器打开 Dashboard
3. 点击"开始采集"按钮
4. 筛选"重要性=高"的文章

### 场景3：手动生成报告

```bash
# 采集最新数据
python main.py collect --enable-ai

# 生成摘要
python main.py summary --hours 24 --limit 20

# 发送到飞书
python main.py send
```

## 数据源配置

编辑 `config/sources.json` 可以：

### 启用/禁用数据源

```json
{
  "name": "OpenAI Blog",
  "enabled": true,  // 改为false禁用
  ...
}
```

### 添加自定义RSS源

```json
{
  "name": "我的自定义RSS",
  "url": "https://example.com/rss.xml",
  "category": "custom",
  "enabled": true,
  "language": "zh",
  "priority": 2
}
```

## 故障排查

### 问题1：API调用失败

**错误**：`❌ 未配置OPENAI_API_KEY`

**解决**：
1. 检查 `.env` 文件是否存在
2. 确认 `OPENAI_API_KEY` 已填写
3. 确认API密钥有效且有额度

### 问题2：采集失败

**错误**：`❌ 请求失败`

**解决**：
1. 检查网络连接
2. 某些RSS源可能需要代理
3. 查看日志 `logs/scheduler.log`

### 问题3：飞书推送失败

**错误**：`❌ 飞书消息发送失败`

**解决**：
1. 确认 `FEISHU_BOT_WEBHOOK` URL正确
2. 检查飞书机器人是否有效
3. 查看日志获取详细错误信息

### 问题4：数据库错误

**错误**：数据库锁定或损坏

**解决**：
```bash
# 重置数据库（会清空所有数据）
python main.py reset --force
```

## 性能优化建议

### 1. 减少AI分析成本

使用更便宜的模型（如DeepSeek）：

```env
OPENAI_API_BASE=https://api.deepseek.com/v1
OPENAI_API_KEY=your-deepseek-key
OPENAI_MODEL=deepseek-chat
```

### 2. 控制采集频率

```env
# 每2小时采集一次（默认1小时）
COLLECTION_CRON=0 */2 * * *

# 每3小时采集一次
COLLECTION_CRON=0 */3 * * *
```

### 3. 限制文章数量

编辑 `config/sources.json`：

```json
{
  "max_articles": 10,  // 改为10（默认20）
  ...
}
```

## 下一步

- 📖 阅读完整文档：[README.md](README.md)
- 🔧 自定义数据源：编辑 `config/sources.json`
- 🎨 修改AI提示词：编辑 `analyzer/ai_analyzer.py`
- 📊 查看数据库：使用SQLite工具打开 `data/ai_news.db`

## 获取帮助

```bash
# 查看所有命令
python main.py --help

# 查看特定命令帮助
python main.py collect --help
python main.py list --help
```

---

💡 **提示**：第一次运行建议先用 `python main.py web` 启动Web界面，熟悉操作后再配置定时任务。
