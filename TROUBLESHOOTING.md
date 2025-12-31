# 常见问题排查指南

## 快速诊断

运行测试脚本检查环境：

```bash
python test_install.py
```

## 问题1：pip install 失败

### 症状
```
ERROR: Could not find a version that satisfies the requirement...
```

### 解决方案

#### 方案A：使用最小依赖
```bash
pip install -r requirements-minimal.txt
```

#### 方案B：使用国内镜像
```bash
pip install streamlit sqlalchemy feedparser requests openai apscheduler -i https://pypi.tuna.tsinghua.edu.cn/simple
```

#### 方案C：升级pip
```bash
python -m pip install --upgrade pip
```

#### 方案D：逐个安装
```bash
pip install streamlit
pip install sqlalchemy
pip install feedparser
pip install requests
pip install openai
pip install apscheduler
pip install python-dotenv
pip install click
```

## 问题2：Microsoft Visual C++ 14.0 is required

### 症状
```
error: Microsoft Visual C++ 14.0 or greater is required.
```

### 解决方案

#### 方案A：使用预编译包
```bash
pip install --upgrade pip wheel
pip install -r requirements-minimal.txt --only-binary :all:
```

#### 方案B：安装Build Tools（推荐）
1. 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. 安装时选择 "Desktop development with C++"
3. 重启后重新安装依赖

#### 方案C：使用Anaconda（最简单）
```bash
# 下载安装Anaconda
# 然后运行
conda install -c conda-forge streamlit sqlalchemy feedparser requests openai apscheduler
```

## 问题3：ImportError: No module named 'xxx'

### 症状
```
ImportError: No module named 'streamlit'
```

### 解决方案

1. 确认是否在正确的Python环境：
```bash
python --version
which python  # Linux/Mac
where python  # Windows
```

2. 重新安装缺失的包：
```bash
pip install streamlit
# 或
python -m pip install streamlit
```

3. 如果使用虚拟环境，确保已激活：
```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

## 问题4：OPENAI_API_KEY 未配置

### 症状
```
❌ 未配置OPENAI_API_KEY
```

### 解决方案

1. 创建 .env 文件：
```bash
# Windows
copy .env.example .env

# Linux/Mac
cp .env.example .env
```

2. 编辑 .env 文件：
```bash
notepad .env  # Windows
nano .env     # Linux/Mac
```

3. 填写API密钥：
```env
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4-turbo-preview
```

### 获取API密钥
- **OpenAI**: https://platform.openai.com/api-keys
- **DeepSeek** (便宜): https://platform.deepseek.com/
- **其他兼容API**: 查看对应平台文档

## 问题5：数据库初始化失败

### 症状
```
sqlite3.OperationalError: unable to open database file
```

### 解决方案

1. 确保data目录存在：
```bash
mkdir data
```

2. 检查文件权限（Linux/Mac）：
```bash
chmod 755 data
```

3. 重新初始化：
```bash
python main.py init
```

## 问题6：采集失败

### 症状
```
❌ 请求失败 https://xxx
```

### 解决方案

1. 检查网络连接：
```bash
ping openai.com
```

2. 某些RSS源可能需要代理，编辑 `config/sources.json` 禁用有问题的源：
```json
{
  "enabled": false  // 改为false
}
```

3. 使用代理（如果有）：
在代码中添加代理设置（需要修改代码）

## 问题7：AI分析失败

### 症状
```
❌ AI分析失败: Incorrect API key provided
```

### 解决方案

1. 检查API密钥是否正确：
```bash
# 查看.env
type .env  # Windows
cat .env   # Linux/Mac
```

2. 确认API余额充足：
登录API提供商网站查看余额

3. 尝试简单的API测试：
```bash
python -c "from openai import OpenAI; client = OpenAI(); print(client.models.list())"
```

4. 如果使用DeepSeek等其他API，确认配置正确：
```env
OPENAI_API_BASE=https://api.deepseek.com/v1
OPENAI_API_KEY=your-deepseek-key
OPENAI_MODEL=deepseek-chat
```

## 问题8：飞书推送失败

### 症状
```
❌ 飞书消息发送失败
```

### 解决方案

1. 确认Webhook URL正确：
- 飞书群聊 → 群设置 → 机器人 → 添加自定义机器人
- 复制Webhook URL到 .env

2. 测试Webhook：
```bash
curl -X POST "你的webhook_url" -H "Content-Type: application/json" -d '{"msg_type":"text","content":{"text":"测试消息"}}'
```

3. 如果不需要飞书推送，可以忽略此功能，不影响核心使用

## 问题9：Web界面无法访问

### 症状
```
浏览器无法打开 http://localhost:8501
```

### 解决方案

1. 确认Web服务已启动：
```bash
python main.py web
```

应该看到：
```
You can now view your Streamlit app in your browser.
Local URL: http://localhost:8501
```

2. 检查防火墙设置
3. 尝试其他端口：
```bash
streamlit run web/app.py --server.port 8502
```

## 问题10：定时任务不运行

### 症状
```
定时任务没有执行
```

### 解决方案

1. 检查系统时间：
```bash
# Windows
date /t && time /t

# Linux/Mac
date
```

2. 查看 .env 中的cron配置：
```env
COLLECTION_CRON=0 */1 * * *      # 每小时
DAILY_SUMMARY_CRON=0 9 * * *     # 每天9点
```

3. 查看日志文件：
```bash
type logs\scheduler.log  # Windows
cat logs/scheduler.log   # Linux/Mac
```

4. 手动触发测试：
```bash
python main.py collect
```

## 完全重装

如果以上方法都不行，执行完全重装：

```bash
# 1. 删除虚拟环境（如果有）
rm -rf venv

# 2. 创建新的虚拟环境
python -m venv venv

# 3. 激活虚拟环境
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 4. 升级pip
python -m pip install --upgrade pip wheel

# 5. 安装最小依赖
pip install -r requirements-minimal.txt

# 6. 测试
python test_install.py

# 7. 初始化
python main.py init
```

## 仍然无法解决？

请提供以下信息：
1. Python版本：`python --version`
2. 操作系统：Windows/Linux/Mac + 版本
3. 完整错误信息
4. 已尝试的解决方法

这样我可以提供更具体的帮助。

## 有用的命令

```bash
# 查看Python版本和位置
python --version
where python

# 查看已安装的包
pip list

# 检查特定包
pip show streamlit

# 升级pip
python -m pip install --upgrade pip

# 清理pip缓存
pip cache purge

# 测试环境
python test_install.py

# 查看帮助
python main.py --help
```
