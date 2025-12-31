# 安装依赖指南

如果按照 requirements.txt 安装失败，请尝试以下方法：

## 方法1：使用最小依赖（推荐）

```bash
pip install -r requirements-minimal.txt
```

这只会安装核心功能所需的包，适合快速启动。

## 方法2：逐个安装核心包

```bash
# Web界面
pip install streamlit

# 数据库
pip install sqlalchemy

# 数据采集
pip install feedparser requests beautifulsoup4

# AI分析
pip install openai

# 定时任务
pip install apscheduler

# 配置管理
pip install python-dotenv click
```

## 方法3：放宽版本限制

使用更新后的 requirements.txt（已使用 >= 而不是 ==）：

```bash
pip install -r requirements.txt
```

## 常见问题解决

### 问题1：Microsoft Visual C++ 14.0 is required

这是因为某些包需要编译。解决方法：

**方案A**：使用预编译的wheel包
```bash
pip install --upgrade pip wheel
pip install -r requirements-minimal.txt
```

**方案B**：安装Visual Studio Build Tools
1. 下载 Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
2. 安装 "Desktop development with C++" 组件

### 问题2：lark-oapi 安装失败

飞书SDK不是必需的，可以跳过：

```bash
# 安装除了 lark-oapi 以外的包
pip install streamlit sqlalchemy feedparser requests beautifulsoup4 openai apscheduler python-dotenv click
```

### 问题3：aiohttp 安装失败

这个包也不是核心必需的，可以跳过或使用简化版本：

```bash
pip install aiohttp --no-deps
```

### 问题4：网络问题（国内用户）

如果下载速度慢或失败，使用国内镜像：

```bash
# 清华源
pip install -r requirements-minimal.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 阿里源
pip install -r requirements-minimal.txt -i https://mirrors.aliyun.com/pypi/simple/

# 豆瓣源
pip install -r requirements-minimal.txt -i https://pypi.douban.com/simple
```

## 验证安装

安装完成后，运行以下命令验证：

```bash
python -c "import streamlit; print('streamlit OK')"
python -c "import sqlalchemy; print('sqlalchemy OK')"
python -c "import feedparser; print('feedparser OK')"
python -c "import openai; print('openai OK')"
python -c "import apscheduler; print('apscheduler OK')"
```

如果没有报错，说明安装成功！

## 最小化安装方案

如果以上方法都不行，只安装最核心的包：

```bash
pip install streamlit sqlalchemy feedparser requests openai apscheduler python-dotenv
```

这样可以：
- ✅ 运行Web界面
- ✅ 采集数据
- ✅ AI分析
- ✅ 定时任务

但不能使用：
- ❌ 飞书推送（不影响核心功能）
- ❌ Web爬虫（RSS和API采集仍可用）

## 完整功能 vs 最小功能

| 功能 | 最小安装 | 完整安装 |
|------|---------|---------|
| RSS采集 | ✅ | ✅ |
| API采集 | ✅ | ✅ |
| AI分析 | ✅ | ✅ |
| Web界面 | ✅ | ✅ |
| 定时任务 | ✅ | ✅ |
| 飞书推送 | ❌ | ✅ |
| 网页爬虫 | ❌ | ✅ |

**建议**：先用最小安装测试，确认系统能运行后，再根据需要添加其他包。

## 仍然有问题？

如果按照以上步骤仍然无法安装，请提供：
1. Python版本：`python --version`
2. pip版本：`pip --version`
3. 完整的错误信息

这样我可以给出更具体的解决方案。
