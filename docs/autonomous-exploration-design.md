# 模型先知功能设计文档（原自主探索）

> 说明：历史命名为“自主探索”，当前产品与界面统一命名为“模型先知”。
> API 路径保持不变：`/api/v1/exploration/*`。

## 当前实现快照（与代码同步）

- 前端页签：`模型先知`（位于“内容总结”和“社交平台”之间）。
- 数据源：`GitHub`、`Hugging Face`、`ModelScope`、`arXiv`。
- 执行模式：`auto` / `deterministic` / `agent`，支持 Agent 独立模型配置（含 Anthropic provider）。
- 启动与生成报告：均为异步后台任务，返回任务 ID；服务端包含并发保护（进行中任务返回 `409`）。
- 报告形态：统一 Markdown 全文预览，不再分多页签。
- 通知：报告生成成功后可触发飞书/钉钉通知。
- 统计口径：以“当前有效数据”为准（报告删除后指标实时回落）。

## 1. 系统概述

### 1.1 功能定位

"自主探索"是一个智能Agent系统，能够自主发现、评估和深度研究新发布的AI模型，生成高质量的模型"偷跑"详情报告。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 自主发现 | 监控GitHub、Hugging Face、arXiv等平台的新模型发布 |
| 智能评估 | 基于多维度指标评估模型质量和影响力 |
| 代码研究 | 自动分析模型代码、架构、训练方法 |
| 报告生成 | 生成结构化的模型详情报告 |
| 质量过滤 | 只关注高影响力和高质量的模型，防止信息过载 |

## 2. Agent工作框架

### 2.1 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                      自主探索Agent工作流                      │
└─────────────────────────────────────────────────────────────┘

1. 信息采集阶段
   ├── GitHub Trending监控
   ├── Hugging Face模型库监控
   ├── arXiv论文监控
   ├── 社交媒体热点监控
   └── 官方博客RSS监控
           ↓
2. 初步过滤阶段
   ├── 关键词过滤（模型相关）
   ├── 时间过滤（最近7天）
   ├── 语言过滤（支持的语言）
   └── 重复过滤（去重）
           ↓
3. 质量评估阶段
   ├── 影响力评分（Star、Fork、引用数）
   ├── 技术质量评分（代码质量、文档完整性）
   ├── 创新性评分（是否有新技术突破）
   ├── 实用性评分（应用场景、易用性）
   └── 综合评分计算
           ↓
4. 深度研究阶段（仅高分模型）
   ├── 代码结构分析
   ├── 模型架构研究
   ├── 训练方法分析
   ├── 性能基准测试结果提取
   ├── 与同类模型对比
   └── 应用场景分析
           ↓
5. 报告生成阶段
   ├── 结构化报告生成
   ├── 关键发现提取
   ├── 风险评估
   ├── 应用建议
   └── 保存到数据库
           ↓
6. 通知推送阶段
   └── 推送到配置的通知平台
```

### 2.2 评估指标体系

#### 影响力评分（权重：30%）

| 指标 | 权重 | 计算方式 |
|------|------|----------|
| GitHub Stars | 40% | log10(stars + 1) * 10 |
| GitHub Forks | 20% | log10(forks + 1) * 10 |
| 论文引用数 | 20% | log10(citations + 1) * 10 |
| 社交媒体讨论度 | 20% | 基于提及次数和互动量 |

#### 技术质量评分（权重：30%）

| 指标 | 权重 | 评估标准 |
|------|------|----------|
| 代码质量 | 40% | 代码结构、注释完整性、测试覆盖率 |
| 文档完整性 | 30% | README、API文档、示例代码 |
| 项目活跃度 | 20% | 最近提交频率、Issue响应速度 |
| 社区支持 | 10% | Contributor数量、Issue/PR数量 |

#### 创新性评分（权重：25%）

| 指标 | 权重 | 评估标准 |
|------|------|----------|
| 技术突破 | 50% | 是否有新架构、新训练方法 |
| 性能提升 | 30% | 相比基线的提升幅度 |
| 新颖性 | 20% | 解决的问题是否新颖 |

#### 实用性评分（权重：15%）

| 指标 | 权重 | 评估标准 |
|------|------|----------|
| 应用场景 | 40% | 应用场景的广泛性和实用性 |
| 易用性 | 30% | API设计、部署难度 |
| 资源需求 | 20% | 计算资源、内存需求 |
| 开源协议 | 10% | 是否商业友好 |

#### 综合评分计算

```
总分 = 影响力评分 * 0.30 
     + 技术质量评分 * 0.30 
     + 创新性评分 * 0.25 
     + 实用性评分 * 0.15
```

**质量阈值**：
- 优秀（≥80分）：立即深度研究并生成报告
- 良好（70-79分）：加入观察列表，持续跟踪
- 一般（60-69分）：简单记录，不深入研究
- 低于60分：直接过滤，不予关注

### 2.3 Skill工作模式

自主探索Agent使用Skill来完成各个阶段的工作：

```
Agent (自主探索主控)
  ├── Uses: model-discovery.skill    (模型发现)
  ├── Uses: model-evaluation.skill   (质量评估)
  ├── Uses: code-analysis.skill      (代码分析)
  ├── Uses: report-generation.skill  (报告生成)
  └── Uses: notification.skill       (通知推送)
```

每个Skill独立封装特定功能，Agent通过调用Skill完成整体工作流。

## 3. Skill规范设计

### 3.1 Skill目录结构

```
backend/app/skills/
├── model-discovery/
│   ├── SKILL.md                    # Skill描述和使用指南
│   ├── scripts/
│   │   ├── discover_github.py      # GitHub监控脚本
│   │   ├── discover_huggingface.py # Hugging Face监控脚本
│   │   └── discover_arxiv.py       # arXiv监控脚本
│   └── references/
│       └── data_sources.md         # 数据源配置参考
│
├── model-evaluation/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── calculate_impact.py     # 影响力评分计算
│   │   ├── evaluate_quality.py     # 质量评估
│   │   └── calculate_final_score.py # 综合评分
│   └── references/
│       └── scoring_criteria.md     # 评分标准详解
│
├── code-analysis/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── analyze_structure.py    # 代码结构分析
│   │   ├── analyze_model.py        # 模型架构分析
│   │   └── extract_benchmarks.py   # 基准测试提取
│   └── references/
│       └── analysis_patterns.md    # 分析模式参考
│
├── report-generation/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── generate_report.py      # 报告生成脚本
│   ├── references/
│   │   └── report_guidelines.md    # 报告编写指南
│   └── assets/
│       └── report_template.md      # 报告模板
│
└── notification/
    ├── SKILL.md
    └── scripts/
        └── send_notification.py    # 通知推送脚本
```

### 3.2 Skill标准格式

每个Skill的SKILL.md遵循Anthropic MCP规范：

```markdown
---
name: skill-name
description: 清晰描述Skill的功能和使用场景
version: 1.0.0
author: AI News Tracker Team
---

# Skill Name

## 功能概述
[简要描述Skill的功能]

## 使用场景
[说明何时应该使用此Skill]

## 输入参数
| 参数名 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|

## 输出结果
[描述Skill的输出格式]

## 使用示例
[提供具体的使用示例]

## 执行步骤
[详细说明Skill的执行流程]

## 依赖资源
[列出依赖的scripts、references、assets]

## 异常处理
[说明异常情况的处理方式]
```

## 4. 报告格式规范

### 4.1 报告结构

生成的模型"偷跑"报告包含以下部分：

```markdown
# [模型名称] 详细分析报告

## 📊 基本信息
- **模型名称**: 
- **发布时间**: 
- **发布组织**: 
- **模型类型**: 
- **开源协议**: 
- **综合评分**: XX/100

## 🔍 发现来源
- **来源平台**: 
- **发现时间**: 
- **热度指标**: 

## ⭐ 影响力评估
- **GitHub Stars**: 
- **Fork数量**: 
- **论文引用**: 
- **社交讨论度**: 
- **影响力评分**: XX/100

## 💡 核心亮点
1. [关键亮点1]
2. [关键亮点2]
3. [关键亮点3]

## 🏗️ 技术架构
### 模型架构
[模型架构描述]

### 关键技术
- [技术点1]
- [技术点2]

### 训练方法
[训练方法描述]

## 📈 性能表现
### 基准测试结果
| 任务 | 指标 | 本模型 | 基线 | 提升 |
|------|------|--------|------|------|

### 与同类模型对比
[对比分析]

## 💻 代码分析
### 代码结构
[代码结构概述]

### 核心实现
[关键代码片段和说明]

### 代码质量评估
- 代码风格: 
- 文档完整性: 
- 测试覆盖率: 

## 🎯 应用场景
1. [场景1]
2. [场景2]
3. [场景3]

## ⚠️ 风险评估
### 技术风险
- [风险点1]

### 使用限制
- [限制1]

## 📝 使用建议
1. [建议1]
2. [建议2]

## 🔗 参考链接
- GitHub仓库: 
- 论文地址: 
- 文档地址: 
- Demo地址: 

## 📅 报告信息
- 生成时间: 
- Agent版本: 
- 评估模型: 
```

### 4.2 报告质量要求

1. **准确性**：所有数据和分析必须基于实际代码和文档
2. **完整性**：覆盖评估指标体系的所有维度
3. **可读性**：使用清晰的结构和简洁的语言
4. **实用性**：提供可操作的建议和评估

## 5. 数据库设计

### 5.1 探索任务表

```sql
CREATE TABLE exploration_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id VARCHAR(64) UNIQUE NOT NULL,      -- 任务唯一标识
    status VARCHAR(20) NOT NULL,               -- pending/running/completed/failed
    source VARCHAR(50) NOT NULL,               -- 发现来源：github/huggingface/arxiv
    model_name VARCHAR(255) NOT NULL,          -- 模型名称
    model_url VARCHAR(512),                    -- 模型URL
    discovery_time TIMESTAMP NOT NULL,         -- 发现时间
    start_time TIMESTAMP,                      -- 开始研究时间
    end_time TIMESTAMP,                        -- 完成时间
    error_message TEXT,                        -- 错误信息（如果失败）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 模型信息表

```sql
CREATE TABLE discovered_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name VARCHAR(255) UNIQUE NOT NULL,   -- 模型名称
    model_type VARCHAR(50),                    -- 模型类型：LLM/Vision/Audio等
    organization VARCHAR(255),                 -- 发布组织
    release_date DATE,                         -- 发布日期
    source_platform VARCHAR(50),               -- 来源平台
    github_url VARCHAR(512),                   -- GitHub地址
    paper_url VARCHAR(512),                    -- 论文地址
    model_url VARCHAR(512),                    -- 模型地址（HF等）
    license VARCHAR(50),                       -- 开源协议
    
    -- 影响力指标
    github_stars INTEGER DEFAULT 0,
    github_forks INTEGER DEFAULT 0,
    paper_citations INTEGER DEFAULT 0,
    social_mentions INTEGER DEFAULT 0,
    
    -- 评分
    impact_score FLOAT,                        -- 影响力评分
    quality_score FLOAT,                       -- 质量评分
    innovation_score FLOAT,                    -- 创新性评分
    practicality_score FLOAT,                  -- 实用性评分
    final_score FLOAT,                         -- 综合评分
    
    -- 元数据
    status VARCHAR(20) DEFAULT 'discovered',   -- discovered/evaluated/analyzed/reported
    is_notable BOOLEAN DEFAULT FALSE,          -- 是否值得深度研究
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5.3 分析报告表

```sql
CREATE TABLE exploration_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id VARCHAR(64) UNIQUE NOT NULL,     -- 报告唯一标识
    task_id VARCHAR(64) NOT NULL,              -- 关联的任务ID
    model_id INTEGER NOT NULL,                 -- 关联的模型ID
    
    -- 报告内容
    title VARCHAR(255) NOT NULL,               -- 报告标题
    summary TEXT,                              -- 摘要
    highlights TEXT,                           -- 核心亮点（JSON数组）
    technical_analysis TEXT,                   -- 技术分析
    performance_analysis TEXT,                 -- 性能分析
    code_analysis TEXT,                        -- 代码分析
    use_cases TEXT,                            -- 应用场景（JSON数组）
    risks TEXT,                                -- 风险评估（JSON数组）
    recommendations TEXT,                      -- 使用建议（JSON数组）
    references TEXT,                           -- 参考链接（JSON对象）
    
    -- 报告元数据
    report_version VARCHAR(20) DEFAULT '1.0',
    agent_version VARCHAR(20),
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 外键
    FOREIGN KEY (model_id) REFERENCES discovered_models(id)
);
```

## 6. API接口设计

### 6.1 探索任务管理

```python
# 启动自主探索任务
POST /api/v1/exploration/start
Request: {
    "sources": ["github", "huggingface", "arxiv"],  # 可选，默认全部
    "min_score": 70  # 最低评分阈值，可选
}
Response: {
    "task_id": "explore-20260209-abc123",
    "status": "started",
    "message": "探索任务已启动"
}

# 获取任务状态
GET /api/v1/exploration/tasks/{task_id}
Response: {
    "task_id": "explore-20260209-abc123",
    "status": "running",
    "progress": {
        "current_stage": "code-analysis",
        "models_discovered": 15,
        "models_evaluated": 12,
        "models_analyzed": 3,
        "reports_generated": 2
    }
}

# 获取任务列表
GET /api/v1/exploration/tasks
Query: ?status=completed&limit=20
Response: {
    "tasks": [...],
    "total": 50,
    "page": 1
}
```

### 6.2 模型管理

```python
# 获取发现的模型列表
GET /api/v1/exploration/models
Query: ?sort_by=final_score&order=desc&min_score=80&limit=20
Response: {
    "models": [...],
    "total": 100,
    "page": 1
}

# 获取模型详情
GET /api/v1/exploration/models/{model_id}
Response: {
    "id": 1,
    "model_name": "GPT-5",
    "final_score": 95.5,
    ...
}

# 手动标记模型
POST /api/v1/exploration/models/{model_id}/mark
Request: {
    "is_notable": true,
    "notes": "非常值得关注"
}
```

### 6.3 报告管理

```python
# 获取报告列表
GET /api/v1/exploration/reports
Query: ?model_id=1&sort_by=generated_at&order=desc
Response: {
    "reports": [...],
    "total": 50
}

# 获取报告详情
GET /api/v1/exploration/reports/{report_id}
Response: {
    "report_id": "report-20260209-xyz",
    "title": "GPT-5 详细分析报告",
    "content": {...}
}

# 导出报告（Markdown格式）
GET /api/v1/exploration/reports/{report_id}/export
Response: Markdown文件下载
```

### 6.4 统计信息

```python
# 获取探索统计
GET /api/v1/exploration/statistics
Response: {
    "total_models_discovered": 500,
    "notable_models": 50,
    "reports_generated": 50,
    "avg_final_score": 65.5,
    "by_source": {
        "github": 300,
        "huggingface": 150,
        "arxiv": 50
    },
    "by_model_type": {
        "LLM": 200,
        "Vision": 150,
        "Audio": 100,
        "Multimodal": 50
    }
}
```

## 7. 前端组件设计

### 7.1 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  自主探索                                  [启动新任务]  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ 模型总数     │  │ 优质模型     │  │ 生成报告     │    │
│  │    500      │  │     50      │  │     50      │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  模型列表  │  探索任务  │  统计数据               │  │
│  ├──────────────────────────────────────────────────┤  │
│  │                                                   │  │
│  │  [筛选] 评分: ≥80  类型: 全部  来源: 全部        │  │
│  │  [排序] 按评分 ↓                                 │  │
│  │                                                   │  │
│  │  ┌────────────────────────────────────────────┐ │  │
│  │  │ GPT-5                       评分: 95.5/100 │ │  │
│  │  │ OpenAI · 2026-02-01 · LLM                  │ │  │
│  │  │ ★ 50k  ⑂ 5k  📄 500                       │ │  │
│  │  │ [查看报告] [详情]                           │ │  │
│  │  └────────────────────────────────────────────┘ │  │
│  │                                                   │  │
│  │  [更多模型...]                                   │  │
│  │                                                   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 7.2 核心组件

```typescript
// ModelExplorer.tsx - 主组件
// ModelCard.tsx - 模型卡片
// ModelDetail.tsx - 模型详情
// ReportViewer.tsx - 报告查看器
// ExplorationTask.tsx - 任务管理
// ExplorationStatistics.tsx - 统计图表
```

## 8. 调度策略

### 8.1 自动探索

```python
# 定时任务配置
EXPLORATION_SCHEDULE = {
    "frequency": "daily",        # 每日自动探索
    "time": "03:00",            # 凌晨3点执行
    "min_score": 75,            # 最低评分阈值
    "max_models_per_run": 50    # 单次最多处理模型数
}
```

### 8.2 优先级策略

1. **紧急优先**：社交媒体热度突增的模型
2. **高质量优先**：GitHub Star增长快的项目
3. **新发布优先**：24小时内的新模型
4. **补充探索**：定期重新评估观察列表中的模型

## 9. 实施计划

### Phase 1: 基础框架（1-2天）
- [ ] 创建数据库表结构
- [ ] 实现基础API接口
- [ ] 创建前端页面和组件

### Phase 2: Skill开发（2-3天）
- [ ] model-discovery skill
- [ ] model-evaluation skill
- [ ] code-analysis skill
- [ ] report-generation skill

### Phase 3: Agent集成（1-2天）
- [ ] 实现Agent主控逻辑
- [ ] 集成各个Skill
- [ ] 实现任务调度

### Phase 4: 测试和优化（1-2天）
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化
- [ ] 文档完善

## 10. 扩展性考虑

### 10.1 未来扩展方向

1. **更多数据源**：添加Papers with Code、Reddit、YouTube等
2. **多语言支持**：支持分析非英语的模型和文档
3. **协同过滤**：基于用户反馈优化评分算法
4. **对比分析**：自动生成多模型对比报告
5. **趋势分析**：分析AI领域的技术趋势

### 10.2 性能优化

1. **并行处理**：使用多线程/异步处理提升效率
2. **缓存机制**：缓存GitHub API、HF API的响应
3. **增量更新**：只分析新增或更新的模型
4. **分布式任务**：支持分布式部署，提高吞吐量

---

**版本**: 1.0  
**创建日期**: 2026-02-09  
**作者**: AI News Tracker Team
