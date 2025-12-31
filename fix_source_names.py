"""
修复数据库中文章的source字段，使其与RSS订阅源名称匹配
"""
import sys
import os
from pathlib import Path

# 设置控制台编码为UTF-8（Windows）
if sys.platform == 'win32':
    os.system('chcp 65001 >nul 2>&1')
    sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

# 添加项目根目录到Python路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from database import get_db
from database.models import Article, RSSSource
from sqlalchemy import func

def fix_source_names():
    """修复文章的source字段，使其与订阅源名称匹配"""
    print("=" * 60)
    print("🔧 开始修复文章source字段...")
    print("=" * 60)
    
    db = get_db()
    
    with db.get_session() as session:
        # 获取所有订阅源
        sources = session.query(RSSSource).all()
        source_url_map = {source.url: source.name for source in sources}
        
        print(f"\n📋 找到 {len(sources)} 个订阅源")
        
        # 获取所有文章
        articles = session.query(Article).all()
        print(f"📰 找到 {len(articles)} 篇文章")
        
        # 统计需要修复的文章
        fixed_count = 0
        not_found_count = 0
        
        # 构建URL到source名称的映射（更精确的匹配）
        url_to_source = {}
        for source in sources:
            if source.url:
                try:
                    from urllib.parse import urlparse
                    domain = urlparse(source.url).netloc
                    # 移除www前缀
                    if domain.startswith('www.'):
                        domain = domain[4:]
                    url_to_source[domain] = source.name
                    # 也保存完整URL
                    url_to_source[source.url] = source.name
                except:
                    pass
        
        for article in articles:
            matched_source = None
            
            # 方法1: 通过文章URL的域名匹配订阅源
            if article.url:
                try:
                    from urllib.parse import urlparse
                    article_domain = urlparse(article.url).netloc
                    # 移除www前缀
                    if article_domain.startswith('www.'):
                        article_domain = article_domain[4:]
                    
                    # 精确匹配域名
                    if article_domain in url_to_source:
                        matched_source = url_to_source[article_domain]
                    else:
                        # 尝试部分匹配（例如 aws.amazon.com 匹配 amazon.com）
                        for domain, source_name in url_to_source.items():
                            if '.' in domain and (domain in article_domain or article_domain in domain):
                                matched_source = source_name
                                break
                except Exception as e:
                    pass
            
            # 方法2: 通过source字段匹配（处理已知的不匹配情况）
            if not matched_source and article.source:
                article_source_lower = article.source.lower().strip()
                
                # 已知的映射关系（RSS feed title -> 订阅源名称）
                known_mappings = {
                    'artificial intelligence': 'AWS Machine Learning',
                    'aws machine learning blog': 'AWS Machine Learning',
                    'aws machine learning': 'AWS Machine Learning',
                    'openai news': 'OpenAI',
                    'openai blog': 'OpenAI',
                }
                
                if article_source_lower in known_mappings:
                    matched_source = known_mappings[article_source_lower]
                else:
                    # 尝试模糊匹配
                    for source in sources:
                        source_name_lower = source.name.lower().strip()
                        # 完全匹配
                        if article_source_lower == source_name_lower:
                            matched_source = source.name
                            break
                        # 部分匹配（如果source名称包含在文章source中，或相反）
                        elif (source_name_lower in article_source_lower or 
                              article_source_lower in source_name_lower):
                            # 检查是否是合理的匹配（避免误匹配）
                            if len(source_name_lower) > 3 and len(article_source_lower) > 3:
                                matched_source = source.name
                                break
            
            # 如果找到匹配的订阅源，更新source字段
            if matched_source and article.source != matched_source:
                old_source = article.source
                article.source = matched_source
                fixed_count += 1
                if fixed_count <= 10:  # 只显示前10个
                    print(f"  ✅ 修复: {article.title[:50]}...")
                    print(f"     旧source: {old_source}")
                    print(f"     新source: {matched_source}")
            elif not matched_source:
                not_found_count += 1
                if not_found_count <= 5:  # 只显示前5个
                    print(f"  ⚠️  未找到匹配: {article.title[:50]}... (source: {article.source}, url: {article.url[:50] if article.url else 'N/A'})")
        
        # 提交更改
        session.commit()
        
        print("\n" + "=" * 60)
        print(f"✅ 修复完成！")
        print(f"   修复文章数: {fixed_count}")
        print(f"   未找到匹配: {not_found_count}")
        print("=" * 60)

if __name__ == "__main__":
    try:
        fix_source_names()
    except Exception as e:
        print(f"\n❌ 修复失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
