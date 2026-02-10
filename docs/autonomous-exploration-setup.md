# 模型先知功能 - 部署指南（原自主探索）

本指南帮助你快速部署和使用模型先知功能。

## 概述

模型先知功能是一个智能Agent系统，能够：
- 自动监控GitHub、Hugging Face、arXiv等平台的新AI模型
- 智能评估模型质量和影响力
- 深度分析模型代码和架构
- 生成详细的模型"偷跑"报告
- 只关注高质量和高影响力的模型

## 当前实现说明（与代码同步）

- 前端名称为`模型先知`，后端 API 前缀仍为`/api/v1/exploration`。
- 默认监控源：`github`、`huggingface`、`modelscope`、`arxiv`。
- 启动任务和手动生成报告需要登录；服务端并发保护开启（重复启动会返回 `409`）。
- 自动监控支持配置间隔：`1~168` 小时（`auto_monitor_interval_hours`）。
- 报告生成为后台异步任务；生成成功后可触发飞书/钉钉通知。
- 前端以 Markdown 全文展示报告。

## 部署步骤

### 1. 安装依赖

```bash
# 进入项目目录
cd ai-news-tracker

# 安装后端依赖
cd backend/app
pip install huggingface_hub arxiv

# 安装前端依赖（如果还没安装）
cd ../../frontend
npm install react-markdown
```

### 2. 数据库迁移

运行迁移脚本创建新表：

```bash
# 从项目根目录执行
python -m backend.app.db.migrations.add_exploration_tables
```

这将创建三张新表：
- `exploration_tasks` - 探索任务
- `discovered_models` - 发现的模型
- `exploration_reports` - 分析报告

### 3. 配置环境变量（可选）

为了提高API调用限额，建议配置以下环境变量：

```bash
# .env文件中添加

# GitHub Token（可选，提高API限额）
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx

# Hugging Face Token（可选，访问私有模型）
HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxx
```

获取Token方式：
- **GitHub Token**: https://github.com/settings/tokens
  - 选择 "Generate new token (classic)"
  - 只需 "public_repo" 权限
  
- **Hugging Face Token**: https://huggingface.co/settings/tokens
  - 创建 "Read" 权限的token

### 4. 启动服务

```bash
# 启动后端（如果还没启动）
python -m uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000

# 启动前端（如果还没启动）
cd frontend
npm run dev
```

### 5. 访问功能

打开浏览器访问：http://localhost:5173

在 Dashboard 中可以看到新增的“模型先知”页签（在“内容总结”和“社交平台”之间）。

## 使用指南

### 启动探索任务

1. 点击“模型先知”页签
2. 点击"启动新探索"按钮
3. 系统将自动监控各平台，发现新模型

### 查看发现的模型

- 在模型列表中查看所有发现的模型
- 支持按评分、类型、来源平台过滤
- 可以看到每个模型的：
  - 模型名称和组织
  - 模型类型（LLM、Vision等）
  - GitHub Stars
  - 综合评分（0-100分）
  - 发布日期

### 查看模型报告

1. 点击模型列表中的"查看报告"按钮
2. 在弹窗中查看详细的分析报告
3. 支持导出报告为Markdown文件

报告包含：
- 核心亮点
- 技术架构分析
- 性能基准测试
- 代码质量评估
- 应用场景建议
- 风险评估

## Skill使用

### Skill目录结构

```
backend/app/skills/
└── model-discovery/
    ├── SKILL.md              # Skill描述和使用指南
    ├── scripts/
    │   ├── discover_github.py      # GitHub监控
    │   ├── discover_huggingface.py # HF监控
    │   └── discover_arxiv.py       # arXiv监控
    └── references/
        └── data_sources.md   # 数据源配置参考
```

### 手动运行Skill脚本

可以单独测试各个数据源的监控脚本：

```bash
# 测试GitHub监控
cd backend/app/skills/model-discovery/scripts
python discover_github.py

# 测试Hugging Face监控
python discover_huggingface.py

# 测试arXiv监控
python discover_arxiv.py
```

### 在代码中使用Skill

```python
from backend.app.services.exploration import get_exploration_service

service = get_exploration_service()
service.run_task(
    task_id="explore-manual-001",
    sources=["github", "huggingface", "modelscope", "arxiv"],
    min_score=70.0,
    days_back=2,
    max_results_per_source=30,
    keywords=["LLM", "transformer", "multimodal"],
    watch_organizations=["openai", "anthropic", "deepseek-ai"],
    run_mode="auto",  # auto / deterministic / agent
)
```

## API接口

### 探索任务管理

```bash
# 获取/更新模型先知配置
GET /api/v1/exploration/config
PUT /api/v1/exploration/config

# 启动探索任务
POST /api/v1/exploration/start
{
  "sources": ["github", "huggingface", "modelscope", "arxiv"],
  "min_score": 70,
  "run_mode": "auto"
}

# 获取任务状态
GET /api/v1/exploration/tasks/{task_id}

# 获取任务列表
GET /api/v1/exploration/tasks?status=completed&limit=20
```

### 模型管理

```bash
# 获取模型列表
GET /api/v1/exploration/models?sort_by=final_score&order=desc&min_score=80

# 获取模型详情
GET /api/v1/exploration/models/{model_id}

# 标记模型
POST /api/v1/exploration/models/{model_id}/mark
{
  "is_notable": true,
  "notes": "非常值得关注"
}
```

### 报告管理

```bash
# 手动触发模型报告生成（异步任务）
POST /api/v1/exploration/models/{model_id}/generate-report?run_mode=auto

# 获取报告列表
GET /api/v1/exploration/reports?model_id=1

# 获取报告详情
GET /api/v1/exploration/reports/{report_id}

# 导出报告
GET /api/v1/exploration/reports/{report_id}/export

# 删除报告
DELETE /api/v1/exploration/reports/{report_id}
```

### 统计信息

```bash
# 获取探索统计
GET /api/v1/exploration/statistics
```

## 评分标准

模型综合评分由四个维度组成：

### 影响力评分（30%）
- GitHub Stars（40%）
- GitHub Forks（20%）
- 论文引用数（20%）
- 社交媒体讨论度（20%）

### 技术质量评分（30%）
- 代码质量（40%）
- 文档完整性（30%）
- 项目活跃度（20%）
- 社区支持（10%）

### 创新性评分（25%）
- 技术突破（50%）
- 性能提升（30%）
- 新颖性（20%）

### 实用性评分（15%）
- 应用场景（40%）
- 易用性（30%）
- 资源需求（20%）
- 开源协议（10%）

**综合评分 = 影响力×0.30 + 质量×0.30 + 创新性×0.25 + 实用性×0.15**

**质量阈值**：
- ≥80分：优秀，立即深度研究
- 70-79分：良好，加入观察列表
- 60-69分：一般，简单记录
- <60分：过滤，不予关注

## 定时任务配置

可以配置定时自动探索：

```python
# backend/app/services/scheduler/scheduler.py

def schedule_exploration():
    """配置自动探索任务"""
    scheduler.add_job(
        run_exploration,
        trigger='cron',
        hour=3,  # 每天凌晨3点
        id='auto_exploration',
        name='自动模型探索',
        replace_existing=True
    )
```

## 故障排查

### API限流问题

**问题**: GitHub API返回403错误

**解决**:
1. 配置`GITHUB_TOKEN`环境变量
2. 检查Token权限和有效期
3. 等待限流重置（通常1小时）

### 依赖安装问题

**问题**: 导入huggingface_hub或arxiv失败

**解决**:
```bash
pip install huggingface_hub arxiv
```

### 数据库问题

**问题**: 表不存在

**解决**:
```bash
# 重新运行迁移脚本
python -m backend.app.db.migrations.add_exploration_tables
```

## 扩展开发

### 添加新的数据源

1. 创建新的监控脚本：`scripts/discover_<source>.py`
2. 实现标准接口：
```python
def discover_<source>(keywords, days_back, max_results, **kwargs):
    # 实现监控逻辑
    return [model_dict, ...]
```
3. 在API中添加新数据源支持

### 自定义评分算法

修改评分权重和计算逻辑：

```python
# 在model-evaluation skill中
def calculate_final_score(model):
    final_score = (
        model.impact_score * 0.30 +
        model.quality_score * 0.30 +
        model.innovation_score * 0.25 +
        model.practicality_score * 0.15
    )
    return final_score
```

### 添加新的Skill

参考`model-discovery` skill的结构创建新Skill：

```
new-skill/
├── SKILL.md
├── scripts/
│   └── main_script.py
├── references/
│   └── documentation.md
└── assets/
    └── template.md
```

## 更多信息

- 设计文档：`docs/autonomous-exploration-design.md`
- Skill规范：`backend/app/skills/model-discovery/SKILL.md`
- API文档：http://localhost:8000/docs

## 支持

如有问题，请提交Issue或查看项目文档。

---

**版本**: 1.0  
**更新日期**: 2026-02-09
