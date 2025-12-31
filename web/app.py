"""
AI News Tracker - Streamlit Web Dashboard
"""
import streamlit as st
from datetime import datetime, timedelta
import pandas as pd
from pathlib import Path
import sys

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from database import get_db
from database.models import Article
from collector import CollectionService
from analyzer.ai_analyzer import AIAnalyzer

# 页面配置
st.set_page_config(
    page_title="AI News Tracker",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded",
)

# 自定义CSS
st.markdown(
    """
<style>
    .main-header {
        font-size: 3rem;
        font-weight: bold;
        text-align: center;
        color: #1f77b4;
        margin-bottom: 2rem;
    }
    .article-card {
        padding: 1.5rem;
        border-radius: 10px;
        background-color: #f8f9fa;
        margin-bottom: 1rem;
        border-left: 5px solid #1f77b4;
    }
    .importance-high {
        border-left-color: #dc3545;
    }
    .importance-medium {
        border-left-color: #ffc107;
    }
    .importance-low {
        border-left-color: #28a745;
    }
    .tag {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background-color: #e9ecef;
        border-radius: 4px;
        margin-right: 0.5rem;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
    }
</style>
""",
    unsafe_allow_html=True,
)


def init_session_state():
    """初始化session state"""
    if "db" not in st.session_state:
        st.session_state.db = get_db()

    if "collector" not in st.session_state:
        # 如果配置了AI，初始化采集服务
        if st.secrets.get("OPENAI_API_KEY"):
            ai_analyzer = AIAnalyzer(
                api_key=st.secrets["OPENAI_API_KEY"],
                base_url=st.secrets.get("OPENAI_API_BASE", "https://api.openai.com/v1"),
                model=st.secrets.get("OPENAI_MODEL", "gpt-4-turbo-preview"),
            )
            st.session_state.collector = CollectionService(ai_analyzer=ai_analyzer)
        else:
            st.session_state.collector = CollectionService()


def render_header():
    """渲染页面头部"""
    st.markdown('<h1 class="main-header">🤖 AI News Tracker</h1>', unsafe_allow_html=True)
    st.markdown("---")


def render_sidebar():
    """渲染侧边栏"""
    st.sidebar.title("⚙️ 控制面板")

    # 手动触发采集
    if st.sidebar.button("🚀 开始采集", type="primary", use_container_width=True):
        with st.sidebar:
            with st.spinner("正在采集数据..."):
                try:
                    stats = st.session_state.collector.collect_all(enable_ai_analysis=True)
                    st.success(f"✅ 采集完成！新增 {stats['new_articles']} 篇文章")
                    st.rerun()
                except Exception as e:
                    st.error(f"❌ 采集失败: {e}")

    st.sidebar.markdown("---")

    # 统计信息
    st.sidebar.subheader("📊 数据统计")

    with st.session_state.db.get_session() as session:
        total_articles = session.query(Article).count()
        today_articles = session.query(Article).filter(Article.created_at >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)).count()
        unanalyzed = session.query(Article).filter(Article.is_processed == False).count()

    st.sidebar.metric("总文章数", total_articles)
    st.sidebar.metric("今日新增", today_articles)
    st.sidebar.metric("待分析", unanalyzed)

    st.sidebar.markdown("---")

    # 筛选选项
    st.sidebar.subheader("🔍 筛选选项")

    # 时间范围
    time_range = st.sidebar.radio(
        "时间范围",
        ["今天", "最近3天", "最近7天", "最近30天", "全部"],
    )

    # 来源筛选
    with st.session_state.db.get_session() as session:
        sources = [s[0] for s in session.query(Article.source).distinct().all()]

    selected_sources = st.sidebar.multiselect("来源", sources, default=sources[:5])

    # 重要性筛选
    importance_filter = st.sidebar.multiselect("重要性", ["high", "medium", "low"], default=["high", "medium"])

    # 分类筛选
    category_filter = st.sidebar.multiselect("分类", ["rss", "paper", "official_blog", "social", "community"], default=["rss", "paper"])

    return {
        "time_range": time_range,
        "sources": selected_sources,
        "importance": importance_filter,
        "category": category_filter,
    }


def get_articles_by_filters(filters: dict):
    """根据筛选条件获取文章"""
    with st.session_state.db.get_session() as session:
        query = session.query(Article)

        # 时间范围
        time_ranges = {
            "今天": timedelta(hours=24),
            "最近3天": timedelta(days=3),
            "最近7天": timedelta(days=7),
            "最近30天": timedelta(days=30),
        }

        if filters["time_range"] in time_ranges:
            time_threshold = datetime.now() - time_ranges[filters["time_range"]]
            query = query.filter(Article.published_at >= time_threshold)

        # 来源
        if filters["sources"]:
            query = query.filter(Article.source.in_(filters["sources"]))

        # 重要性
        if filters["importance"]:
            query = query.filter(Article.importance.in_(filters["importance"]))

        # 分类
        if filters["category"]:
            query = query.filter(Article.category.in_(filters["category"]))

        # 排序和限制
        articles = query.order_by(Article.published_at.desc()).limit(200).all()

        return articles


def render_article_card(article: Article):
    """渲染文章卡片"""
    importance_class = f"importance-{article.importance}" if article.importance else ""

    st.markdown(
        f"""
    <div class="article-card {importance_class}">
        <h3>{article.title}</h3>
        <p style="color: #666; font-size: 0.9rem;">
            📰 {article.source} | 📅 {article.published_at.strftime('%Y-%m-%d %H:%M') if article.published_at else 'Unknown'}
        </p>
    """,
        unsafe_allow_html=True,
    )

    # AI总结
    if article.summary:
        st.markdown(f"**📝 AI总结:** {article.summary}")

    # 关键点
    if article.key_points:
        st.markdown("**🔑 关键点:**")
        for point in article.key_points:
            st.markdown(f"  - {point}")

    # 标签
    if article.tags:
        tags_html = " ".join([f'<span class="tag">{tag}</span>' for tag in article.tags[:10]])
        st.markdown(f"**🏷️ 标签:** {tags_html}", unsafe_allow_html=True)

    # 展开完整内容
    with st.expander("查看完整内容"):
        st.markdown(f"**作者:** {article.author if article.author else 'Unknown'}")
        st.markdown(f"**链接:** [{article.url}]({article.url})")
        st.markdown("---")
        st.markdown(article.content[:2000] + "..." if len(article.content) > 2000 else article.content)

    st.markdown("</div>", unsafe_allow_html=True)


def render_statistics_tab(articles):
    """渲染统计标签页"""
    st.subheader("📈 数据统计")

    col1, col2, col3, col4 = st.columns(4)

    with st.session_state.db.get_session() as session:
        total = session.query(Article).count()
        high_importance = session.query(Article).filter(Article.importance == "high").count()
        today_count = session.query(Article).filter(Article.created_at >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)).count()

    col1.metric("总文章数", total)
    col2.metric("高重要性", high_importance)
    col3.metric("今日新增", today_count)
    col4.metric("当前显示", len(articles))

    st.markdown("---")

    # 按来源统计
    st.subheader("📊 来源分布")
    source_counts = {}
    for article in articles:
        source_counts[article.source] = source_counts.get(article.source, 0) + 1

    if source_counts:
        df_sources = pd.DataFrame(list(source_counts.items()), columns=["来源", "数量"]).sort_values("数量", ascending=False)
        st.bar_chart(df_sources.set_index("来源"))


def main():
    """主函数"""
    # 初始化
    init_session_state()
    render_header()

    # 侧边栏
    filters = render_sidebar()

    # 标签页
    tab1, tab2 = st.tabs(["📰 文章列表", "📈 数据统计"])

    with tab1:
        st.subheader(f"📰 最新AI资讯 ({filters['time_range']})")

        # 获取文章
        articles = get_articles_by_filters(filters)

        if not articles:
            st.info("🤷 暂无文章，请点击左侧「开始采集」按钮")
        else:
            # 显示文章数量
            st.info(f"📊 找到 {len(articles)} 篇文章")

            # 渲染文章
            for article in articles:
                render_article_card(article)

    with tab2:
        render_statistics_tab(articles)


if __name__ == "__main__":
    main()
