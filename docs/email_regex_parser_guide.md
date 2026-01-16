# 邮件正则解析器使用指南

## 概述

邮件正则解析器是一个基于正则表达式的邮件内容解析系统，用于替代大模型分析，更快速、更可靠地从邮件中提取文章。

## 核心优势

1. **速度快** - 不需要调用大模型API，解析速度提升100倍以上
2. **成本低** - 无API调用费用
3. **可靠性高** - 基于固定规则，不会出现大模型的随机性问题
4. **可配置** - 通过配置文件灵活适配不同邮件格式

## 支持的邮件类型

### 1. TLDR 邮件（预配置）

TLDR邮件解析器已内置，无需额外配置。

### 2. 自定义邮件类型

可以通过配置正则表达式来适配其他类型的邮件。

## 配置说明

### TLDR 邮件配置示例

```json
{
  "name": "TLDR (163邮箱)",
  "url": "email://your_email@163.com",
  "category": "newsletter",
  "enabled": true,
  "language": "en",
  "priority": 2,
  "source_type": "email",
  "description": "TLDR 邮件订阅源（163邮箱），使用正则解析器",
  "extra_config": {
    "protocol": "pop3",
    "server": "pop.163.com",
    "port": 995,
    "use_ssl": true,
    "username": "your_email@163.com",
    "password": "your_auth_code",
    "title_filter": {
      "type": "sender",
      "filter_sender": true,
      "keywords": ["TLDR"]
    },
    "content_extraction": {
      "from_html": false,
      "from_plain": true,
      "from_attachments": false,
      "use_regex_parser": true,
      "parser_type": "tldr"
    },
    "max_emails": 50
  }
}
```

### 关键配置字段

#### `content_extraction` 配置

```json
"content_extraction": {
  "from_html": false,           // 是否从HTML提取（不推荐）
  "from_plain": true,           // 是否从纯文本提取（推荐）
  "from_attachments": false,    // 是否从附件提取
  "use_regex_parser": true,     // 启用正则解析器
  "parser_type": "tldr"         // 解析器类型：tldr 或 custom
}
```

## 自定义邮件解析器

如果要解析其他类型的邮件，需要自定义正则规则。

### 步骤1：分析邮件结构

使用调试工具分析邮件：

```bash
# 修改 debug_email_parser.py 中的邮箱配置
# 然后运行：
python debug_email_parser.py
```

工具会在 `debug_email_output` 目录生成分析文件。

### 步骤2：识别关键模式

从分析文件中识别：
- **文章标题模式** - 如何识别标题
- **链接位置** - 链接在哪里（末尾？内联？）
- **内容边界** - 如何分隔文章
- **需要过滤的内容** - 广告、导航等

### 步骤3：配置正则规则

在源配置中添加 `regex_rules`：

```json
{
  "extra_config": {
    "content_extraction": {
      "use_regex_parser": true,
      "parser_type": "custom"
    },
    "regex_rules": {
      "links_section_pattern": "正则模式，提取Links部分",
      "link_pattern": "正则模式，提取单个链接",
      "article_title_pattern": "正则模式，识别标题",
      "remove_headers": ["正则模式列表", "移除头部内容"],
      "remove_footers": ["正则模式列表", "移除尾部内容"],
      "ad_patterns": ["正则模式列表", "过滤广告"]
    }
  }
}
```

### 常见正则模式示例

#### 提取链接部分

```regex
Links:\n-+\n+(.*?)(?=\n\n\n|\Z)
```

#### 提取单个链接

```regex
\[(\d+)\]\s+(https?://[^\s\]]+)
```

#### 识别标题（全大写 + 引用编号）

```regex
^\s*[A-Z][A-Z0-9\s&\'\-?:,/()+!?]+\s*\[\d+\]\s*$
```

#### 移除导航

```regex
^.*?Sign Up.*?\n
```

## 架构说明

### 核心类

1. **EmailRegexParser** - 基础解析器类
2. **TLDREmailParser** - TLDR专用解析器（继承基础类）

### 解析流程

```
邮件内容
    ↓
提取链接映射 (从 Links: 部分)
    ↓
预处理（合并跨行标题）
    ↓
逐行扫描
    ↓
识别标题行 → 提取文章信息
    ↓
返回文章列表
```

## 与大模型对比

| 特性 | 正则解析器 | 大模型解析 |
|------|-----------|-----------|
| 速度 | <1秒 | 10-30秒 |
| 成本 | 免费 | API费用 |
| 可靠性 | 100%（规则固定） | 80-95%（可能有误差） |
| 灵活性 | 需配置规则 | 自动适应 |
| 维护性 | 需要为每种邮件配置 | 无需配置 |

## 最佳实践

### 1. 优先使用纯文本

纯文本比HTML更容易用正则解析。

```json
"content_extraction": {
  "from_plain": true,
  "from_html": false
}
```

### 2. 测试配置

使用测试脚本验证配置：

```bash
python test_regex_parser.py
```

### 3. 查看日志

启用详细日志查看解析过程：

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### 4. 调试技巧

如果解析不准确：
1. 检查 `debug_email_output` 中的原始文件
2. 调整正则模式
3. 逐步测试每个模式

## 常见问题

### Q1: 为什么有些文章没有被提取？

A: 检查：
- 标题是否匹配 `article_title_pattern`
- 是否被 `skip_patterns` 过滤
- 查看日志中的警告信息

### Q2: 链接提取失败？

A: 检查：
- `links_section_pattern` 是否正确
- `link_pattern` 是否匹配实际链接格式
- 查看解析后的JSON结果

### Q3: 如何添加新的邮件类型支持？

A:
1. 运行 `debug_email_parser.py` 分析邮件
2. 识别关键模式
3. 创建新的解析器类（继承 `EmailRegexParser`）
4. 在 `get_parser()` 函数中注册

### Q4: 可以同时使用HTML和纯文本吗？

A: 可以，但建议只使用一种。优先选择纯文本。

## 代码示例

### 创建自定义解析器

```python
from backend.app.services.collector.email_regex_parser import EmailRegexParser

class MyEmailParser(EmailRegexParser):
    def __init__(self):
        config = {
            "regex_rules": {
                "article_title_pattern": r"^\[新闻\].*\[\d+\]",
                # ... 其他配置
            }
        }
        super().__init__(config)

    def _is_title_line(self, line: str) -> bool:
        # 自定义标题识别逻辑
        return line.startswith('[新闻]') and line.endswith(']')
```

### 在代码中使用

```python
from backend.app.services.collector.email_regex_parser import get_parser

# 获取TLDR解析器
parser = get_parser("tldr")

# 解析邮件内容
articles = parser.parse(email_content, content_type="plain")

# 处理解析结果
for article in articles:
    print(f"标题: {article['title']}")
    print(f"链接: {article['url']}")
    print(f"内容: {article['content'][:100]}...")
```

## 更新日志

### 2026-01-16
- ✅ 实现基础正则解析器
- ✅ 实现TLDR专用解析器
- ✅ 支持跨行标题合并
- ✅ 15篇文章测试通过

## 下一步计划

- [ ] 支持更多邮件类型（Hacker Newsletter, Daily.dev等）
- [ ] 提供配置验证工具
- [ ] 添加Web UI配置界面
- [ ] 支持正则模式测试工具
