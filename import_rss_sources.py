"""
导入RSS订阅源到数据库
"""
import json
from database import get_db
from database.models import RSSSource
from sqlalchemy import or_

# 用户提供的RSS源列表
RSS_SOURCES = [
    # 第一梯队：全球顶尖AI实验室
    {
        "name": "OpenAI",
        "url": "https://openai.com/news/rss.xml",
        "description": "ChatGPT 缔造者",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Google DeepMind",
        "url": "https://deepmind.google/blog/rss.xml",
        "description": "Gemini/AlphaGo 团队",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Google Research",
        "url": "https://blog.google/technology/ai/rss/",
        "description": "Google 核心 AI 博客",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Microsoft Research",
        "url": "https://www.microsoft.com/en-us/research/feed/",
        "description": "微软研究院",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Meta AI (Engineering)",
        "url": "https://engineering.fb.com/category/artificial-intelligence/feed/",
        "description": "Llama 系列 (最接近官方的源)",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "NVIDIA Blog",
        "url": "https://blogs.nvidia.com/blog/category/deep-learning/feed/",
        "description": "硬件与 AI 落地",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Apple Machine Learning",
        "url": "https://machinelearning.apple.com/rss.xml",
        "description": "苹果极其低调的 AI 博客",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "AWS Machine Learning",
        "url": "https://aws.amazon.com/blogs/machine-learning/feed/",
        "description": "亚马逊 AI 博客",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Hugging Face",
        "url": "https://huggingface.co/blog/feed.xml",
        "description": "AI 界的 Github，开源社区核心",
        "category": "corporate_lab",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    
    # 学术殿堂：顶尖高校AI博客
    {
        "name": "BAIR (Berkeley)",
        "url": "https://bair.berkeley.edu/blog/feed.xml",
        "description": "伯克利人工智能研究",
        "category": "academic",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Stanford HAI",
        "url": "https://hai.stanford.edu/news/rss",
        "description": "斯坦福以人为本 AI 研究院",
        "category": "academic",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "MIT News (AI)",
        "url": "https://news.mit.edu/rss/topic/artificial-intelligence2",
        "description": "麻省理工 AI 板块",
        "category": "academic",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "CMU ML Blog",
        "url": "https://blog.ml.cmu.edu/feed/",
        "description": "卡内基梅隆大学机器学习",
        "category": "academic",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    
    # 大神级人物 & 深度技术博客
    {
        "name": "Andrej Karpathy",
        "url": "https://karpathy.github.io/feed.xml",
        "description": "前 Tesla AI 总监/OpenAI 创始成员",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Lilian Weng",
        "url": "https://lilianweng.github.io/index.xml",
        "description": "OpenAI 安全系统负责人 (文章极深)",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Sebastian Ruder",
        "url": "https://ruder.io/rss.xml",
        "description": "NLP 领域大牛 (Cohere/DeepMind)",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Chip Huyen",
        "url": "https://huyenchip.com/feed.xml",
        "description": "AI 工程化专家 (畅销书作者)",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Jay Alammar",
        "url": "https://jalammar.github.io/feed.xml",
        "description": "最强 Transformer 可视化解读",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Simon Willison",
        "url": "https://simonwillison.net/atom/",
        "description": "LLM 应用与 Prompt 专家",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    {
        "name": "Paul Graham",
        "url": "http://www.aaronsw.com/2002/feeds/pgessays.rss",
        "description": "YC 创始人 (虽非纯 AI，但对创投风向极重要)",
        "category": "individual",
        "tier": "tier2",
        "language": "en",
        "priority": 3,
        "enabled": True
    },
    {
        "name": "Stephen Wolfram",
        "url": "https://writings.stephenwolfram.com/feed/",
        "description": "WolframAlpha 创始人 (符号主义大佬)",
        "category": "individual",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
    
    # 必读的AI通讯与聚合
    {
        "name": "Import AI (Jack Clark)",
        "url": "https://importai.substack.com/feed",
        "description": "政策与技术最老牌周刊",
        "category": "newsletter",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "The Sequence",
        "url": "https://thesequence.substack.com/feed",
        "description": "深度技术解读与新闻",
        "category": "newsletter",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "Last Week in AI",
        "url": "https://lastweekin.ai/feed",
        "description": "每周新闻汇总",
        "category": "newsletter",
        "tier": "tier1",
        "language": "en",
        "priority": 1,
        "enabled": True
    },
    {
        "name": "AI Snake Oil",
        "url": "https://www.aisnakeoil.com/feed",
        "description": "普林斯顿教授打假 AI 炒作",
        "category": "newsletter",
        "tier": "tier1",
        "language": "en",
        "priority": 2,
        "enabled": True
    },
]


def import_sources():
    """导入RSS源到数据库"""
    db = get_db()
    added_count = 0
    skipped_count = 0
    error_count = 0
    
    with db.get_session() as session:
        for source_data in RSS_SOURCES:
            try:
                # 检查是否已存在
                existing = session.query(RSSSource).filter(
                    or_(RSSSource.name == source_data["name"], 
                        RSSSource.url == source_data["url"])
                ).first()
                
                if existing:
                    print(f"跳过（已存在）：{source_data['name']}")
                    skipped_count += 1
                else:
                    new_source = RSSSource(**source_data)
                    session.add(new_source)
                    print(f"添加：{source_data['name']}")
                    added_count += 1
            except Exception as e:
                print(f"错误：{source_data.get('name', 'Unknown')} - {e}")
                error_count += 1
        
        session.commit()
    
    print(f"\n导入完成：")
    print(f"  新增：{added_count}")
    print(f"  跳过：{skipped_count}")
    print(f"  错误：{error_count}")


if __name__ == "__main__":
    import sys
    import io
    # 修复Windows控制台编码问题
    if sys.platform == "win32":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    print("开始导入RSS订阅源...")
    import_sources()

