---
name: model-discovery
description: 自动发现和监控新发布的AI模型。监控 GitHub、Hugging Face、ModelScope、arXiv 等平台，识别和提取预发布更新信号。使用场景：当需要自动发现新AI模型时，或需要监控特定厂商的模型发布前迹象时。
---

# Model Discovery Skill

自动发现和监控新发布的AI模型。

## 功能概述

本Skill提供自动化的AI模型发现能力，支持监控多个主流平台的新模型发布，提取关键信息并进行初步过滤。

## 使用场景

- 定时自动扫描各平台的新模型发布
- 手动触发特定平台的模型发现
- 搜索特定关键词相关的模型
- 补充已知模型的详细信息

## 输入参数

| 参数名 | 类型 | 必需 | 默认值 | 说明 |
|--------|------|------|--------|------|
| sources | list[str] | 否 | ["github", "huggingface", "modelscope", "arxiv"] | 要监控的数据源列表 |
| keywords | list[str] | 否 | ["LLM", "transformer", "diffusion", "AI model"] | 关键词过滤列表 |
| days_back | int | 否 | 7 | 回溯天数，查找最近N天的模型 |
| max_results | int | 否 | 50 | 每个源最多返回的结果数 |
| min_stars | int | 否 | 100 | GitHub最低Star数（仅GitHub源） |
| watch_organizations | list[str] | 否 | [] | 厂商/组织监控名单，命中后可放宽过滤并提高信号置信度 |

## 输出结果

返回发现的模型列表，每个模型包含：

```python
{
    "model_name": str,           # 模型名称
    "source_platform": str,      # 来源平台：github/huggingface/modelscope/arxiv
    "url": str,                  # 模型URL
    "organization": str,         # 发布组织/作者
    "release_date": str,         # 发布日期（ISO格式）
    "model_type": str,           # 模型类型：LLM/Vision/Audio/Multimodal等
    "description": str,          # 简短描述
    "github_stars": int,         # GitHub Stars（如适用）
    "github_forks": int,         # GitHub Forks（如适用）
    "paper_url": str,            # 论文链接（如适用）
    "license": str,              # 开源协议
    "discovered_at": str         # 发现时间（ISO格式）
}
```

## 使用示例

### 示例1：发现所有平台的新模型

```python
from skills.model_discovery import discover_models

  results = discover_models(
    sources=["github", "huggingface", "modelscope", "arxiv"],
    days_back=7,
    max_results=50
)

print(f"发现 {len(results)} 个新模型")
for model in results:
    print(f"- {model['model_name']} ({model['source_platform']})")
```

### 示例2：搜索特定关键词的模型

```python
results = discover_models(
    sources=["github"],
    keywords=["GPT", "LLM", "language model"],
    days_back=3,
    min_stars=500
)
```

### 示例3：只监控Hugging Face

```python
results = discover_models(
    sources=["huggingface"],
    days_back=1,
    max_results=20
)
```

## 执行步骤

### 1. 参数验证

验证输入参数的有效性：
- sources必须是支持的平台列表
- days_back必须是正整数
- max_results必须在合理范围内（1-500）

### 2. 并行监控各数据源

根据sources参数，并行执行各平台的监控脚本：

#### 2.1 GitHub监控

**使用脚本**: `scripts/discover_github.py`

**监控内容**:
- GitHub Trending（AI/ML相关仓库）
- 搜索关键词相关的新仓库
- 关注的组织的新发布

**提取信息**:
- 仓库名称、描述、URL
- Star数、Fork数
- 创建/更新时间
- 开源协议
- README中的模型信息

**过滤条件**:
- 必须是最近N天内创建或有重大更新
- Star数≥min_stars
- 匹配关键词或在AI/ML topic下
- 排除非模型相关的仓库

#### 2.2 Hugging Face监控

**使用脚本**: `scripts/discover_huggingface.py`

**监控内容**:
- 最新上传的模型
- 热门模型（按下载量/点赞数排序）
- 特定任务类型的新模型

**提取信息**:
- 模型名称、ID、URL
- 发布组织/作者
- 模型类型（text-generation, image-to-text等）
- 下载量、点赞数
- 模型卡片信息
- 相关论文链接

**过滤条件**:
- 最近N天内上传
- 匹配关键词
- 有完整的模型卡片

#### 2.3 arXiv监控

**使用脚本**: `scripts/discover_arxiv.py`

**监控内容**:
- cs.AI、cs.LG、cs.CL、cs.CV等类别的新论文
- 搜索关键词相关的论文

**提取信息**:
- 论文标题、摘要、URL
- 作者、发布日期
- 论文类别
- 从摘要中提取的模型名称
- GitHub链接（如果有）

**过滤条件**:
- 最近N天内发布
- 标题或摘要包含模型相关关键词
- 论文摘要提到代码开源

### 3. 结果合并与去重

将各数据源的结果合并：
- 按模型名称去重（忽略大小写）
- 如果同一模型在多个平台都有，合并信息
- 优先保留信息最完整的记录

### 4. 信息补充

对于发现的模型，尝试补充缺失信息：
- 如果有GitHub链接，获取Star/Fork数
- 如果有论文链接，尝试获取引用数
- 识别模型类型（基于描述和标签）
- 标准化组织名称

### 5. 初步过滤

应用基本过滤条件：
- 必须是AI/ML相关的模型
- 必须有有效的URL
- 必须有基本的描述信息
- 排除明显的非模型项目（工具、教程等）

### 6. 返回结果

返回标准化的模型信息列表，按发现时间或热度排序。

## 依赖资源

### Scripts

- **discover_github.py**: GitHub平台监控脚本
  - 使用GitHub API v3
  - 需要环境变量: `GITHUB_TOKEN`（可选，提高API限额）
  
- **discover_huggingface.py**: Hugging Face平台监控脚本
  - 使用Hugging Face Hub API
  - 需要依赖: `huggingface_hub`
  
- **discover_arxiv.py**: arXiv平台监控脚本
  - 使用arXiv API
  - 需要依赖: `arxiv`

### References

- **data_sources.md**: 数据源配置和API使用说明
  - GitHub API使用指南
  - Hugging Face API使用指南
  - arXiv API使用指南
  - 关键词配置建议

## 异常处理

### API限流

- **GitHub**: 未认证限制60次/小时，认证后5000次/小时
  - 处理: 检测限流响应，等待重试或使用缓存
  
- **Hugging Face**: 通常无严格限流
  - 处理: 添加请求间隔，避免过于频繁

- **arXiv**: 建议每3秒1个请求
  - 处理: 使用requests的rate limiting

### 网络错误

- 重试机制：最多重试3次，指数退避
- 超时设置：单个请求最多30秒
- 部分失败处理：某个源失败不影响其他源

### 数据解析错误

- 容错处理：单个模型解析失败不影响其他模型
- 日志记录：记录所有解析错误以便后续改进
- 降级策略：缺少某些字段时使用默认值

## 性能优化

### 并行处理

使用asyncio或threading并行监控多个数据源：

```python
import asyncio

async def discover_all_sources(sources, **kwargs):
    tasks = []
    if "github" in sources:
        tasks.append(discover_github_async(**kwargs))
    if "huggingface" in sources:
        tasks.append(discover_huggingface_async(**kwargs))
    if "arxiv" in sources:
        tasks.append(discover_arxiv_async(**kwargs))
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return merge_results(results)
```

### 缓存策略

- 缓存GitHub API响应（TTL: 1小时）
- 缓存Hugging Face模型列表（TTL: 30分钟）
- 缓存已发现的模型，避免重复处理

### 增量更新

- 记录上次扫描时间
- 只获取新增的模型
- 使用平台提供的时间过滤参数

## 数据质量保证

### 必需字段验证

确保每个模型至少包含：
- model_name
- source_platform
- url
- release_date

### 数据标准化

- 日期格式统一为ISO 8601
- URL规范化（去除query参数、统一协议）
- 模型类型标准化（使用预定义类别）
- 组织名称规范化（统一大小写、去除空格）

### 重复检测

基于以下字段检测重复：
- 模型名称（归一化后）
- URL（规范化后）
- 组织+项目名组合

## 扩展指南

### 添加新数据源

1. 创建新的监控脚本：`scripts/discover_<source>.py`
2. 实现标准接口：
   ```python
   def discover_<source>(keywords, days_back, max_results, **kwargs):
       # 实现监控逻辑
       return [model_dict, ...]
   ```
3. 更新SKILL.md，添加新数据源说明
4. 更新`data_sources.md`参考文档

### 自定义关键词

编辑配置文件或参数，支持：
- 正则表达式匹配
- 多语言关键词
- 排除关键词（negative keywords）

### 自定义过滤器

添加自定义过滤逻辑：
```python
def custom_filter(model):
    # 自定义过滤条件
    return True  # 保留
```

## 日志和监控

### 日志级别

- DEBUG: 详细的API请求和响应
- INFO: 发现的模型数量和基本信息
- WARNING: API限流、部分失败
- ERROR: 严重错误、无法继续

### 监控指标

- 每次扫描发现的模型数量
- 各数据源的响应时间
- API错误率
- 重复模型数量

## 最佳实践

1. **定时执行**: 建议每日执行一次，避免遗漏新模型
2. **合理设置参数**: days_back不宜过大，避免重复处理
3. **使用认证**: 配置GitHub Token提高API限额
4. **监控日志**: 定期检查日志，及时发现问题
5. **缓存利用**: 启用缓存减少API调用
6. **增量处理**: 记录已处理的模型，避免重复

---

**维护信息**:
- 创建日期: 2026-02-09
- 最后更新: 2026-02-09
- 维护者: AI News Tracker Team
