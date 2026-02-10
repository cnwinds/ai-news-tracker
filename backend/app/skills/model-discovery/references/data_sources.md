# 数据源配置参考

本文档提供各数据源的API使用指南和配置建议。

## GitHub API

### API端点

```
基础URL: https://api.github.com
文档: https://docs.github.com/en/rest
```

### 认证

```python
import requests

headers = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}
```

### 常用API

#### 1. 搜索仓库

```python
# 搜索AI/ML相关的新仓库
url = "https://api.github.com/search/repositories"
params = {
    "q": "topic:machine-learning OR topic:deep-learning created:>2026-02-01 stars:>100",
    "sort": "stars",
    "order": "desc",
    "per_page": 50
}
response = requests.get(url, headers=headers, params=params)
```

#### 2. GitHub Trending

```python
# 非官方API，抓取trending页面
url = "https://github.com/trending/python?since=daily&spoken_language_code=en"
# 需要解析HTML
```

#### 3. 获取仓库详情

```python
url = "https://api.github.com/repos/{owner}/{repo}"
response = requests.get(url, headers=headers)
```

### 搜索查询语法

```
# 按topic搜索
topic:machine-learning topic:transformers

# 按创建时间过滤
created:>2026-02-01

# 按更新时间过滤
pushed:>2026-02-01

# 按Star数过滤
stars:>100

# 按语言过滤
language:python

# 组合查询
topic:llm stars:>500 created:>2026-02-01 language:python
```

### AI/ML相关Topic

```python
AI_ML_TOPICS = [
    "machine-learning",
    "deep-learning",
    "artificial-intelligence",
    "neural-network",
    "transformer",
    "llm",
    "large-language-model",
    "diffusion-models",
    "computer-vision",
    "natural-language-processing",
    "nlp",
    "speech-recognition",
    "reinforcement-learning",
    "pytorch",
    "tensorflow",
    "jax",
    "huggingface"
]
```

### 限流处理

```python
def check_rate_limit(response):
    remaining = int(response.headers.get('X-RateLimit-Remaining', 0))
    reset_time = int(response.headers.get('X-RateLimit-Reset', 0))
    
    if remaining < 10:
        wait_time = reset_time - time.time()
        if wait_time > 0:
            print(f"API限流，等待 {wait_time} 秒")
            time.sleep(wait_time)
```

## Hugging Face API

### API端点

```
基础URL: https://huggingface.co
API文档: https://huggingface.co/docs/hub/api
Python SDK: huggingface_hub
```

### 安装SDK

```bash
pip install huggingface_hub
```

### 使用示例

#### 1. 列出最新模型

```python
from huggingface_hub import HfApi

api = HfApi()

# 获取最新上传的模型
models = api.list_models(
    sort="lastModified",
    direction=-1,  # 降序
    limit=50
)

for model in models:
    print(f"{model.modelId}: {model.downloads} downloads")
```

#### 2. 搜索特定类型的模型

```python
# 搜索文本生成模型
models = api.list_models(
    filter="text-generation",
    sort="downloads",
    direction=-1,
    limit=50
)
```

#### 3. 获取模型详情

```python
model_info = api.model_info("gpt2")

print(f"模型ID: {model_info.modelId}")
print(f"作者: {model_info.author}")
print(f"下载量: {model_info.downloads}")
print(f"点赞数: {model_info.likes}")
print(f"标签: {model_info.tags}")
```

#### 4. 读取模型卡片

```python
# 获取README.md内容
card = api.model_info("gpt2", files_metadata=True)
readme_url = f"https://huggingface.co/{model_info.modelId}/raw/main/README.md"
```

### 模型任务类型

```python
TASK_TYPES = [
    "text-generation",           # 文本生成（LLM）
    "text-classification",       # 文本分类
    "token-classification",      # 命名实体识别
    "question-answering",        # 问答
    "translation",               # 翻译
    "summarization",            # 摘要
    "text-to-image",            # 文本生成图像
    "image-to-text",            # 图像描述
    "image-classification",     # 图像分类
    "object-detection",         # 目标检测
    "image-segmentation",       # 图像分割
    "text-to-speech",           # 文本转语音
    "automatic-speech-recognition",  # 语音识别
    "audio-classification",     # 音频分类
    "feature-extraction",       # 特征提取（embedding）
    "sentence-similarity",      # 句子相似度
]
```

### 过滤条件

```python
# 按上传时间过滤
from datetime import datetime, timedelta

cutoff_date = datetime.now() - timedelta(days=7)

models = [
    m for m in api.list_models(sort="lastModified", direction=-1, limit=200)
    if m.lastModified and m.lastModified > cutoff_date
]
```

## arXiv API

### API端点

```
基础URL: http://export.arxiv.org/api/query
文档: https://info.arxiv.org/help/api/index.html
```

### 安装Python库

```bash
pip install arxiv
```

### 使用示例

#### 1. 搜索论文

```python
import arxiv

# 搜索最近的AI论文
search = arxiv.Search(
    query="cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
    max_results=50,
    sort_by=arxiv.SortCriterion.SubmittedDate,
    sort_order=arxiv.SortOrder.Descending
)

for paper in search.results():
    print(f"标题: {paper.title}")
    print(f"作者: {', '.join(author.name for author in paper.authors)}")
    print(f"发布日期: {paper.published}")
    print(f"摘要: {paper.summary}")
    print(f"PDF链接: {paper.pdf_url}")
    print("---")
```

#### 2. 高级搜索

```python
# 搜索标题或摘要包含特定关键词的论文
query = '(ti:"large language model" OR abs:"LLM") AND (cat:cs.AI OR cat:cs.CL)'

search = arxiv.Search(
    query=query,
    max_results=20,
    sort_by=arxiv.SortCriterion.Relevance
)
```

#### 3. 按日期过滤

```python
from datetime import datetime, timedelta

# 最近7天的论文
cutoff_date = datetime.now() - timedelta(days=7)

search = arxiv.Search(
    query="cat:cs.AI",
    max_results=100
)

recent_papers = [
    paper for paper in search.results()
    if paper.published.replace(tzinfo=None) > cutoff_date
]
```

### 类别代码

```python
ARXIV_CATEGORIES = {
    "cs.AI": "Artificial Intelligence",
    "cs.LG": "Machine Learning",
    "cs.CL": "Computation and Language (NLP)",
    "cs.CV": "Computer Vision and Pattern Recognition",
    "cs.NE": "Neural and Evolutionary Computing",
    "cs.SD": "Sound",
    "cs.IR": "Information Retrieval",
    "stat.ML": "Machine Learning (Statistics)"
}
```

### 关键词建议

```python
MODEL_KEYWORDS = [
    # LLM相关
    "large language model", "LLM", "GPT", "transformer",
    "BERT", "attention mechanism", "pre-trained model",
    
    # 视觉模型
    "vision transformer", "ViT", "diffusion model",
    "stable diffusion", "DALL-E", "image generation",
    "object detection", "semantic segmentation",
    
    # 音频模型
    "speech recognition", "text-to-speech", "TTS",
    "audio generation", "voice synthesis",
    
    # 多模态
    "multimodal", "vision-language", "CLIP",
    
    # 训练方法
    "fine-tuning", "RLHF", "instruction tuning",
    "few-shot learning", "zero-shot learning",
    
    # 架构
    "encoder-decoder", "decoder-only", "mixture of experts"
]
```

### 从摘要提取GitHub链接

```python
import re

def extract_github_url(text):
    """从论文摘要或全文中提取GitHub链接"""
    pattern = r'https?://github\.com/[\w-]+/[\w.-]+'
    matches = re.findall(pattern, text)
    return matches[0] if matches else None

# 使用
for paper in search.results():
    github_url = extract_github_url(paper.summary)
    if github_url:
        print(f"找到代码: {github_url}")
```

### API限流

```python
import time

def rate_limited_search(queries, delay=3):
    """
    限速搜索，arXiv建议每3秒1个请求
    """
    results = []
    for query in queries:
        search = arxiv.Search(query=query, max_results=50)
        results.extend(list(search.results()))
        time.sleep(delay)  # 等待3秒
    return results
```

## 其他数据源（未来扩展）

### Papers with Code

```python
# API: https://paperswithcode.com/api/v1/
# 可以获取论文、代码、数据集、排行榜等
```

### Reddit r/MachineLearning

```python
# 使用PRAW (Python Reddit API Wrapper)
import praw

reddit = praw.Reddit(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",
    user_agent="model-discovery-bot"
)

subreddit = reddit.subreddit("MachineLearning")
for post in subreddit.new(limit=50):
    if post.link_flair_text == "Research":
        print(f"标题: {post.title}")
        print(f"URL: {post.url}")
```

### Twitter/X

```python
# 使用Twitter API v2
# 监控特定账号和话题标签
ACCOUNTS_TO_MONITOR = [
    "@OpenAI", "@AnthropicAI", "@GoogleAI",
    "@MetaAI", "@HuggingFace", "@StabilityAI"
]

HASHTAGS = ["#LLM", "#AI", "#MachineLearning"]
```

## 配置建议

### 环境变量

```bash
# GitHub
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxx"

# Hugging Face（可选，用于私有模型）
export HUGGINGFACE_TOKEN="hf_xxxxxxxxxxxxx"

# Twitter（如果使用）
export TWITTER_BEARER_TOKEN="xxxxxxxxxxxxx"
```

### 关键词配置

```yaml
# config/keywords.yaml
include:
  - LLM
  - large language model
  - transformer
  - diffusion
  - stable diffusion
  - vision transformer
  - GPT
  - BERT
  - multimodal

exclude:
  - tutorial
  - course
  - learning resource
  - awesome list
```

### 数据源优先级

```python
SOURCE_PRIORITY = {
    "github": 1.0,       # 最高优先级，代码可用
    "huggingface": 0.9,  # 次优先级，模型可直接使用
    "arxiv": 0.7         # 较低优先级，可能只是论文
}
```

## 最佳实践

### 1. 组合使用多个数据源

```python
# 先从arXiv找论文
papers = discover_arxiv(keywords=["LLM"], days_back=7)

# 对于有GitHub链接的论文，获取详细信息
for paper in papers:
    if paper.get("github_url"):
        github_info = get_github_info(paper["github_url"])
        paper.update(github_info)
```

### 2. 定期更新已发现的模型

```python
# 对于已知模型，定期更新Star数、下载量等指标
def update_model_metrics(model_id):
    if model.source == "github":
        repo_info = github_api.get_repo(model.url)
        model.stars = repo_info.stargazers_count
        model.forks = repo_info.forks_count
    elif model.source == "huggingface":
        model_info = hf_api.model_info(model.model_id)
        model.downloads = model_info.downloads
```

### 3. 使用缓存减少API调用

```python
from functools import lru_cache
from datetime import datetime, timedelta

@lru_cache(maxsize=1000)
def get_github_repo_cached(owner, repo, cache_time):
    """缓存GitHub仓库信息1小时"""
    return github_api.get_repo(f"{owner}/{repo}")

# 使用
cache_key = datetime.now().replace(minute=0, second=0, microsecond=0)
repo_info = get_github_repo_cached("openai", "gpt-3", cache_key)
```

---

**维护说明**：
- 定期检查API文档更新
- 及时更新关键词列表
- 根据发现效果调整搜索策略
