"""
AI News Tracker - Streamlit Web Dashboard
"""
import warnings
# 必须在最开始就抑制警告，在任何import之前
warnings.filterwarnings("ignore", message=".*ScriptRunContext.*")

import streamlit as st
from datetime import datetime, timedelta
import pandas as pd
from pathlib import Path
import sys
import os
import threading
import time
import logging
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from database import get_db
from database.models import Article, RSSSource, CollectionTask, CollectionLog
from database.repositories import ArticleRepository, RSSSourceRepository, CollectionTaskRepository, CollectionLogRepository
from collector import CollectionService
from sqlalchemy import or_
from config import import_rss_sources
from utils import create_ai_analyzer, setup_logger

# 配置日志
logger = setup_logger(__name__)

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
        font-size: 2.5rem;
        font-weight: bold;
        text-align: center;
        color: #1f77b4;
        margin-bottom: 1.5rem;
    }
    .source-badge {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        background-color: #e3f2fd;
        color: #1565c0;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
        margin-left: 0.5rem;
        border: 1px solid #90caf9;
    }
</style>
""",
    unsafe_allow_html=True,
)


def init_session_state():
    """初始化session state"""
    if "db" not in st.session_state:
        st.session_state.db = get_db()
        
        # 检查并修复中断的采集任务（只在首次初始化时执行一次）
        _check_and_fix_interrupted_tasks(st.session_state.db)

    if "collector" not in st.session_state:
        ai_analyzer = create_ai_analyzer()
        st.session_state.collector = CollectionService(ai_analyzer=ai_analyzer)
    
    # 采集状态
    if "collection_status" not in st.session_state:
        st.session_state.collection_status = "idle"  # idle, running, completed, error
    if "collection_message" not in st.session_state:
        st.session_state.collection_message = ""
    if "collection_stats" not in st.session_state:
        st.session_state.collection_stats = None
    if "collection_thread" not in st.session_state:
        st.session_state.collection_thread = None


def _check_and_fix_interrupted_tasks(db):
    """
    检查并修复中断的采集任务

    只有当任务运行超过一定时间（30分钟）且没有活动时，才认为是中断
    这样可以避免误判正在正常运行的短时间任务
    """
    try:
        with db.get_session() as session:
            # 查找所有状态为"running"的任务
            running_tasks = session.query(CollectionTask).filter(
                CollectionTask.status == "running"
            ).all()

            if running_tasks:
                logger.info(f"🔍 发现 {len(running_tasks)} 个running状态的任务，正在检查...")

                fixed_count = 0
                for task in running_tasks:
                    # 计算任务运行时长
                    if task.started_at:
                        elapsed = (datetime.now() - task.started_at).total_seconds()
                        elapsed_minutes = elapsed / 60

                        # 只有当任务运行超过30分钟，才认为是中断
                        # 正常的采集任务通常在30分钟内完成
                        TIMEOUT_MINUTES = 30

                        if elapsed_minutes > TIMEOUT_MINUTES:
                            # 将状态改为error，并记录中断信息
                            task.status = "error"
                            task.error_message = f"程序启动时发现任务中断（已运行 {elapsed_minutes:.1f} 分钟）"
                            task.completed_at = datetime.now()
                            if not task.duration:
                                task.duration = elapsed

                            fixed_count += 1
                            logger.info(f"  ✅ 已修复中断任务 ID={task.id}，运行时长: {elapsed_minutes:.1f} 分钟")
                        else:
                            logger.info(f"  ⏸️  任务 ID={task.id} 仍在运行中（运行 {elapsed_minutes:.1f} 分钟）")

                if fixed_count > 0:
                    session.commit()
                    logger.info(f"✅ 已修复 {fixed_count} 个中断的采集任务")
                else:
                    logger.info("✅ 所有running任务都在正常运行")
    except Exception as e:
        logger.error(f"❌ 检查中断任务失败: {e}")
        # 不抛出异常，避免影响应用启动


def render_header():
    """渲染页面头部"""
    st.markdown('<h1 class="main-header">🤖 AI News Tracker</h1>', unsafe_allow_html=True)
    st.markdown("---")


def run_collection_background(enable_ai_analysis=True):
    """在后台运行采集任务 - 不访问st.session_state"""
    from datetime import datetime
    import logging
    import os

    # 在后台线程中创建独立的数据库连接和服务实例
    # 不能使用st.session_state，因为Streamlit session state不是线程安全的
    from database import get_db
    from database.models import CollectionTask
    from collector import CollectionService
    from analyzer.ai_analyzer import AIAnalyzer

    # 配置日志
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("=" * 50)
    logger.info("采集线程已启动！")
    logger.info("=" * 50)

    # 创建新的数据库连接（线程安全）
    db = get_db()

    # 创建AI分析器（如果需要）
    ai_analyzer = create_ai_analyzer() if enable_ai_analysis else None

    # 创建采集服务实例
    collector = CollectionService(ai_analyzer=ai_analyzer)

    # 创建任务记录
    task_id = None
    try:
        logger.info("步骤1: 创建数据库任务记录")
        with db.get_session() as session:
            task = CollectionTask(
                status="running",
                ai_enabled=enable_ai_analysis,
                started_at=datetime.now()
            )
            session.add(task)
            session.commit()
            task_id = task.id
            logger.info(f"✅ 任务已创建，ID={task_id}")

        # 注意：不能在后台线程中更新st.session_state
        # 主线程会通过轮询数据库来获取最新状态
        logger.info("步骤2: 开始采集数据（不更新UI状态）")

        # 执行采集
        stats = collector.collect_all(enable_ai_analysis=enable_ai_analysis, task_id=task_id)
        logger.info(f"✅ 采集完成，stats={stats}")

        # 更新任务记录为完成状态
        logger.info("步骤3: 更新任务记录为完成状态")
        with db.get_session() as session:
            task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
            if task:
                task.status = "completed"
                task.new_articles_count = stats.get('new_articles', 0)
                task.total_sources = stats.get('sources_success', 0) + stats.get('sources_error', 0)
                task.success_sources = stats.get('sources_success', 0)
                task.failed_sources = stats.get('sources_error', 0)
                task.duration = stats.get('duration', 0)
                task.completed_at = datetime.now()
                task.ai_analyzed_count = stats.get('analyzed_count', 0)
                session.commit()
                logger.info("✅ 任务记录已更新为完成状态")
        logger.info("🎉 采集流程全部完成")

    except Exception as e:
        logger.error(f"❌ 采集过程出错: {e}", exc_info=True)
        # 更新任务状态为错误
        if task_id:
            try:
                with db.get_session() as session:
                    task = session.query(CollectionTask).filter(CollectionTask.id == task_id).first()
                    if task:
                        task.status = "error"
                        task.error_message = str(e)
                        task.completed_at = datetime.now()
                        session.commit()
                        logger.info("✅ 错误状态已保存到数据库")
            except Exception as db_error:
                logger.error(f"❌ 保存错误状态失败: {db_error}")
        logger.error("❌ 采集任务失败")


def check_collection_status():
    """检查采集状态 - 通过查询数据库判断是否有正在运行的任务"""
    # 首先检查线程是否还在运行
    is_running = (st.session_state.collection_status == "running" and
                  st.session_state.collection_thread and
                  st.session_state.collection_thread.is_alive())

    # 如果线程已结束，检查数据库中的任务状态
    if not is_running and st.session_state.collection_status == "running":
        # 查询最近的任务状态
        with st.session_state.db.get_session() as session:
            latest_task = session.query(CollectionTask).order_by(
                CollectionTask.started_at.desc()
            ).first()

            if latest_task:
                if latest_task.status == "completed":
                    st.session_state.collection_status = "completed"
                    st.session_state.collection_message = (
                        f"✅ 采集完成！新增 {latest_task.new_articles_count} 篇文章，"
                        f"耗时 {latest_task.duration or 0:.1f}秒"
                    )
                elif latest_task.status == "error":
                    st.session_state.collection_status = "error"
                    st.session_state.collection_message = f"❌ 采集失败: {latest_task.error_message}"
                elif latest_task.status == "running":
                    # 任务还在运行中
                    is_running = True

    return is_running


def render_sidebar():
    """渲染侧边栏"""
    st.sidebar.title("⚙️ 控制面板")

    st.sidebar.markdown("---")

    # 统计信息
    st.sidebar.subheader("📊 数据统计")

    with st.session_state.db.get_session() as session:
        stats = ArticleRepository.get_stats(session)

    st.sidebar.metric("总文章数", stats["total"])
    st.sidebar.metric("今日新增", stats["today"])
    st.sidebar.metric("待分析", stats["unanalyzed"])

    st.sidebar.markdown("---")

    # 筛选选项
    st.sidebar.subheader("🔍 筛选选项")

    # 时间范围
    time_range = st.sidebar.radio(
        "时间范围",
        ["今天", "最近3天", "最近7天", "最近30天", "全部"],
        index=4,  # 默认选择"全部"
    )

    # 来源筛选
    with st.session_state.db.get_session() as session:
        sources = [s[0] for s in session.query(Article.source).distinct().all() if s[0]]

    # 默认选择所有来源
    selected_sources = st.sidebar.multiselect("来源", sources, default=sources)

    # 重要性筛选
    importance_filter = st.sidebar.multiselect("重要性", ["high", "medium", "low", "未分析"], default=["high", "medium", "low", "未分析"])

    # 分类筛选
    with st.session_state.db.get_session() as session:
        categories = [c[0] for c in session.query(Article.category).distinct().all() if c[0]]

    # 默认选择所有分类
    category_filter = st.sidebar.multiselect("分类", categories if categories else ["rss", "paper", "official_blog", "social", "community"], default=categories if categories else ["rss", "paper", "official_blog", "social", "community"])

    return {
        "time_range": time_range,
        "sources": selected_sources,
        "importance": importance_filter,
        "category": category_filter,
    }


def get_articles_by_filters(filters: dict) -> list[Article]:
    """根据筛选条件获取文章"""
    time_ranges = {
        "今天": timedelta(hours=24),
        "最近3天": timedelta(days=3),
        "最近7天": timedelta(days=7),
        "最近30天": timedelta(days=30),
    }

    time_threshold = None
    if filters["time_range"] in time_ranges:
        time_threshold = datetime.now() - time_ranges[filters["time_range"]]

    include_unimportance = "未分析" in filters.get("importance", [])

    return ArticleRepository.get_articles_by_filters(
        session=st.session_state.db.get_session().__enter__(),
        time_threshold=time_threshold,
        sources=filters.get("sources"),
        importance_values=filters.get("importance"),
        include_unimportance=include_unimportance,
        categories=filters.get("category"),
        limit=200,
    )


def render_article_card(article: Article):
    """渲染文章卡片"""
    # 格式化发布时间 - 优先使用 published_at，如果没有则使用 collected_at
    published_time = ""
    time_label = ""
    if article.published_at:
        published_time = article.published_at.strftime('%Y-%m-%d %H:%M')
        time_label = ""
    elif article.collected_at:
        published_time = article.collected_at.strftime('%Y-%m-%d %H:%M')
        time_label = " (采集时间)"
    else:
        published_time = "Unknown"
        time_label = ""

    # 准备详情内容
    author_text = article.author if article.author else 'Unknown'
    url_display = article.url[:60] + "..." if len(article.url) > 60 else article.url

    # 优先显示中文标题
    display_title = article.title_zh if article.title_zh else article.title

    # 构建重要性标识
    importance_badge = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
    }.get(article.importance, '⚪')

    # 使用st.expander，标题行包含所有信息
    with st.expander(
        f"{importance_badge} **{display_title}** · `{article.source}` · *{published_time}{time_label}*",
        expanded=False
    ):
        # 作者和链接放在一行
        st.markdown(f"**作者:** {author_text}  ·  **链接:** [{url_display}]({article.url})")

        # AI总结
        if article.summary:
            st.markdown("#### 📝 AI总结")
            st.info(article.summary)

        # 关键点
        if article.key_points and isinstance(article.key_points, list) and len(article.key_points) > 0:
            st.markdown("#### 🔑 关键点")
            for point in article.key_points:
                st.markdown(f"• {point}")

        # 标签
        if article.tags and isinstance(article.tags, list) and len(article.tags) > 0:
            st.markdown("#### 🏷️ 标签")
            tags_text = " ".join([f"`{tag}`" for tag in article.tags[:10]])
            st.markdown(tags_text)


def render_collection_history():
    """渲染采集历史页面"""
    st.subheader("🚀 采集历史记录")

    # 检查采集状态
    is_running = check_collection_status()
    
    # 采集配置区域
    with st.expander("⚙️ 采集配置", expanded=False):
        from config.settings import settings
        
        col1, col2 = st.columns(2)
        
        with col1:
            max_article_age = st.number_input(
                "超过多少天之前的文章不采集",
                min_value=0,
                max_value=365,
                value=settings.MAX_ARTICLE_AGE_DAYS,
                help="设置为0表示不限制，采集所有文章",
                key="max_article_age_input"
            )
        
        with col2:
            max_analysis_age = st.number_input(
                "超过多少天之前的内容不总结",
                min_value=0,
                max_value=365,
                value=settings.MAX_ANALYSIS_AGE_DAYS,
                help="设置为0表示不限制，分析所有文章",
                key="max_analysis_age_input"
            )
        
        if st.button("💾 保存配置", type="primary", use_container_width=True):
            if settings.save_collection_settings(max_article_age, max_analysis_age):
                st.success(f"✅ 配置已保存！文章采集限制: {max_article_age}天，AI分析限制: {max_analysis_age}天")
                st.rerun()
            else:
                st.error("❌ 保存配置失败，请检查日志")
        
        st.caption(f"💡 当前配置：文章采集限制 {settings.MAX_ARTICLE_AGE_DAYS} 天，AI分析限制 {settings.MAX_ANALYSIS_AGE_DAYS} 天")
    
    st.markdown("---")

    # 控制按钮
    col1, col2 = st.columns([1, 1])

    with col1:
        # 开始采集按钮
        if st.button(
            "🚀 开始采集" if not is_running else "⏸️ 采集中...",
            type="primary" if not is_running else "secondary",
            use_container_width=True,
            disabled=is_running,
            key="start_collection_main"
        ):
            if not is_running:
                # 启动后台采集线程
                thread = threading.Thread(
                    target=run_collection_background,
                    args=(True,),
                    daemon=True
                )
                thread.start()

                # 更新session state
                st.session_state.collection_thread = thread
                st.session_state.collection_status = "running"
                st.session_state.collection_message = "🔄 正在启动采集任务..."
                st.session_state.last_thread_start = time.time()

                # 短暂等待后刷新页面，显示任务已启动
                time.sleep(0.5)
                st.rerun()

    with col2:
        # 手动刷新按钮
        if st.button("🔄 刷新", use_container_width=True, key="refresh_history"):
            st.rerun()

    st.markdown("---")

    # 获取采集历史
    with st.session_state.db.get_session() as session:
        tasks = CollectionTaskRepository.get_recent_tasks(session, limit=50)

        for task in tasks:
            _ = task.id
            _ = task.status
            _ = task.new_articles_count
            _ = task.total_sources
            _ = task.success_sources
            _ = task.failed_sources
            _ = task.duration
            _ = task.started_at
            _ = task.completed_at
            _ = task.ai_enabled
            _ = task.ai_analyzed_count
            _ = task.error_message
        session.expunge_all()

    if not tasks:
        st.info("🤷 暂无采集记录")
        return

    # 统计信息
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        total_tasks = len(tasks)
        st.metric("总采集次数", total_tasks)
    with col2:
        completed = len([t for t in tasks if t.status == "completed"])
        st.metric("成功次数", completed)
    with col3:
        total_articles = sum([t.new_articles_count for t in tasks if t.new_articles_count])
        st.metric("总新增文章", total_articles)
    with col4:
        # 计算平均耗时，避免除零错误
        tasks_with_duration = [t for t in tasks if t.duration]
        avg_duration = sum([t.duration for t in tasks_with_duration]) / len(tasks_with_duration) if tasks_with_duration else 0
        st.metric("平均耗时", f"{avg_duration:.1f}秒")

    st.markdown("---")

    # 筛选选项
    status_filter = st.selectbox("状态筛选", ["全部", "completed", "running", "error"], index=0)

    # 显示采集历史列表
    for task in tasks:
        if status_filter != "全部" and task.status != status_filter:
            continue

        # 状态标识
        status_emoji = {
            'completed': '✅',
            'running': '🔄',
            'error': '❌'
        }.get(task.status, '⚪')

        # 开始时间
        start_time = task.started_at.strftime('%Y-%m-%d %H:%M:%S') if task.started_at else 'N/A'
        # 结束时间
        end_time = task.completed_at.strftime('%H:%M:%S') if task.completed_at else '进行中...'

        # 计算已运行时间（如果正在运行）
        if task.status == "running":
            elapsed = (datetime.now() - task.started_at).total_seconds()
            duration_text = f"{elapsed:.1f}秒 (进行中...)"
        else:
            duration_text = f"{task.duration:.1f}秒" if task.duration else "N/A"
        
        # 正在运行的任务默认展开
        is_expanded = (task.status == "running")
        
        with st.expander(
            f"{status_emoji} {start_time} - {end_time} | 新增: {task.new_articles_count}篇 | 耗时: {duration_text}",
            expanded=is_expanded
        ):
            col1, col2, col3 = st.columns(3)

            with col1:
                st.markdown(f"**状态:** {task.status}")
                st.markdown(f"**AI分析:** {'✅ 已启用' if task.ai_enabled else '❌ 未启用'}")

            with col2:
                st.markdown(f"**总源数:** {task.total_sources}")
                st.markdown(f"**成功:** {task.success_sources} | **失败:** {task.failed_sources}")

            with col3:
                st.markdown(f"**新增文章:** {task.new_articles_count}")
                if task.ai_enabled:
                    st.markdown(f"**AI分析:** {task.ai_analyzed_count}篇")

            # 显示详细的采集进度（特别是正在运行的任务）
            if task.status == "running" or task.status == "completed":
                st.markdown("---")
                st.markdown("#### 📋 采集详情")
                
                # 查询该任务相关的采集日志
                with st.session_state.db.get_session() as session:
                    # 查询任务开始时间之后的日志
                    logs = session.query(CollectionLog).filter(
                        CollectionLog.started_at >= task.started_at
                    ).order_by(CollectionLog.started_at.desc()).all()
                    
                    # 如果任务已完成，只显示任务结束时间之前的日志
                    if task.completed_at:
                        logs = [log for log in logs if log.started_at <= task.completed_at]
                    
                    # 预先加载属性
                    for log in logs:
                        _ = log.id
                        _ = log.source_name
                        _ = log.source_type
                        _ = log.status
                        _ = log.articles_count
                        _ = log.error_message
                        _ = log.started_at
                        _ = log.completed_at
                    session.expunge_all()
                
                if logs:
                    # 按状态分组显示
                    success_logs = [log for log in logs if log.status == "success"]
                    error_logs = [log for log in logs if log.status == "error"]
                    
                    if success_logs:
                        st.markdown(f"**✅ 成功采集 ({len(success_logs)} 个源):**")
                        for log in success_logs[:20]:  # 最多显示20个
                            log_time = log.started_at.strftime('%H:%M:%S') if log.started_at else ''
                            st.markdown(f"  • {log.source_name} ({log.source_type}): {log.articles_count} 篇文章 {log_time}")
                        if len(success_logs) > 20:
                            st.caption(f"... 还有 {len(success_logs) - 20} 个源")
                    
                    if error_logs:
                        st.markdown(f"**❌ 采集失败 ({len(error_logs)} 个源):**")
                        for log in error_logs[:10]:  # 最多显示10个错误
                            log_time = log.started_at.strftime('%H:%M:%S') if log.started_at else ''
                            error_msg = log.error_message[:100] + "..." if log.error_message and len(log.error_message) > 100 else (log.error_message or "未知错误")
                            st.markdown(f"  • {log.source_name} ({log.source_type}): {error_msg} {log_time}")
                        if len(error_logs) > 10:
                            st.caption(f"... 还有 {len(error_logs) - 10} 个失败源")
                    
                    if not success_logs and not error_logs:
                        st.info("⏳ 等待采集开始...")
                else:
                    st.info("⏳ 暂无采集日志，等待采集开始...")

            # 错误信息
            if task.error_message:
                st.error(f"**错误信息:** {task.error_message}")

            # 时间详情
            st.caption(f"开始时间: {start_time}")
            if task.completed_at:
                st.caption(f"结束时间: {task.completed_at.strftime('%Y-%m-%d %H:%M:%S')}")


def get_source_health_info(latest_date: datetime = None) -> tuple[str, str, str, str]:
    """
    获取源的健康状态信息

    Args:
        latest_date: 最新文章日期

    Returns:
        (date_display, date_status, health_status, date_str)
    """
    if latest_date:
        if hasattr(latest_date, 'tzinfo') and latest_date.tzinfo:
            latest_date_local = latest_date.replace(tzinfo=None)
        else:
            latest_date_local = latest_date

        now_date = datetime.now().date()
        if isinstance(latest_date_local, datetime):
            latest_date_only = latest_date_local.date()
        else:
            latest_date_only = latest_date_local

        days_ago = (now_date - latest_date_only).days
        if days_ago < 0:
            days_ago = 0

        if days_ago == 0:
            date_display = "今天"
            date_status = "🟢"
            health_status = "活跃"
        elif days_ago < 7:
            date_display = f"{days_ago}天前"
            date_status = "🟢"
            health_status = "正常"
        elif days_ago < 14:
            date_display = f"{days_ago}天前"
            date_status = "🟡"
            health_status = "正常"
        elif days_ago < 30:
            date_display = f"{days_ago}天前"
            date_status = "🟠"
            health_status = "较慢"
        else:
            date_display = f"{days_ago}天前"
            date_status = "🔴"
            health_status = "停滞"

        if isinstance(latest_date_local, datetime):
            date_str = latest_date_local.strftime('%Y-%m-%d')
        else:
            date_str = str(latest_date_only)

        date_display = f"{date_status} {date_str} ({date_display})"
    else:
        date_display = "⚠️ 暂无文章"
        date_status = "⚪"
        health_status = "无数据"
        date_str = ""

    return date_display, date_status, health_status, date_str


def render_add_source_form():
    """渲染添加新源的表单"""
    with st.expander("➕ 添加新订阅源", expanded=True):
        with st.form("add_source_form"):
            col1, col2 = st.columns(2)

            with col1:
                name = st.text_input("源名称 *", placeholder="例如：OpenAI Blog")
                url = st.text_input("RSS URL *", placeholder="https://example.com/rss.xml")
                description = st.text_area("简介/说明", placeholder="简要描述这个源的特点")
                category = st.selectbox("分类", ["corporate_lab", "academic", "individual", "newsletter", "other"])

            with col2:
                tier = st.selectbox("梯队/级别", ["tier1", "tier2", "tier3", "other"], index=0)
                language = st.selectbox("语言", ["en", "zh", "ja", "other"], index=0)
                priority = st.slider("优先级", 1, 5, 1, help="数字越小优先级越高")
                enabled = st.checkbox("启用", value=True)
                note = st.text_area("备注", placeholder="可选备注信息")

            col_submit, col_cancel = st.columns(2)
            with col_submit:
                submitted = st.form_submit_button("✅ 保存", use_container_width=True)
            with col_cancel:
                if st.form_submit_button("❌ 取消", use_container_width=True):
                    st.session_state.show_add_source = False
                    st.rerun()

            if submitted:
                if name and url:
                    try:
                        with st.session_state.db.get_session() as session:
                            existing = session.query(RSSSource).filter(
                                or_(RSSSource.name == name, RSSSource.url == url)
                            ).first()

                            if existing:
                                st.error(f"❌ 源已存在：{existing.name}")
                            else:
                                new_source = RSSSource(
                                    name=name,
                                    url=url,
                                    description=description if description else None,
                                    category=category,
                                    tier=tier,
                                    language=language,
                                    priority=priority,
                                    enabled=enabled,
                                    note=note if note else None
                                )
                                session.add(new_source)
                                session.commit()
                                st.success(f"✅ 成功添加订阅源：{name}")
                                st.session_state.show_add_source = False
                                st.rerun()
                    except Exception as e:
                        st.error(f"❌ 添加失败：{e}")
                else:
                    st.error("❌ 请填写必填项（名称和URL）")


def render_import_default_sources() -> int:
    """
    渲染导入系统默认源的界面

    Returns:
        导入的数量
    """
    default_sources = import_rss_sources.RSS_SOURCES

    st.info(f"📋 系统默认包含 {len(default_sources)} 个精选 RSS 订阅源")

    categories = list({s.get('category', 'other') for s in default_sources})
    selected_categories = st.multiselect(
        "选择要导入的分类",
        categories,
        default=categories
    )

    sources_to_import = [s for s in default_sources if s.get('category', 'other') in selected_categories]

    if st.button("🚀 开始导入", use_container_width=True):
        added_count = 0
        updated_count = 0
        skipped_count = 0
        error_count = 0

        progress_bar = st.progress(0)
        status_text = st.empty()

        with st.session_state.db.get_session() as session:
            for idx, source_data in enumerate(sources_to_import):
                status_text.text(f"正在导入: {source_data.get('name', 'Unknown')} ({idx + 1}/{len(sources_to_import)})")

                try:
                    existing = session.query(RSSSource).filter(
                        or_(RSSSource.name == source_data.get('name'), RSSSource.url == source_data.get('url'))
                    ).first()

                    if existing:
                        updated_count += 1
                        skipped_count += 1
                    else:
                        new_source = RSSSource(
                            name=source_data.get('name', ''),
                            url=source_data.get('url', ''),
                            description=source_data.get('description'),
                            category=source_data.get('category', 'other'),
                            tier=source_data.get('tier', 'tier3'),
                            language=source_data.get('language', 'en'),
                            priority=source_data.get('priority', 3),
                            enabled=source_data.get('enabled', True),
                            note=source_data.get('note')
                        )
                        session.add(new_source)
                        added_count += 1

                except Exception as e:
                    error_count += 1
                    st.warning(f"导入失败：{source_data.get('name', 'Unknown')} - {e}")

                progress_bar.progress((idx + 1) / len(sources_to_import))

                if (idx + 1) % 10 == 0:
                    session.commit()

            session.commit()
            progress_bar.empty()
            status_text.empty()

            st.success(f"✅ 导入完成！")
            st.markdown(f"**导入结果：**")
            st.markdown(f"- ✅ 新增: {added_count} 个")
            if updated_count > 0:
                st.markdown(f"- 🔄 更新: {updated_count} 个")
            if skipped_count > 0:
                st.markdown(f"- ⏭️ 跳过: {skipped_count} 个")
            if error_count > 0:
                st.warning(f"⚠️ 错误: {error_count} 个")

            st.session_state.show_batch_import = False
            time.sleep(1)
            st.rerun()

    return len(sources_to_import)


def render_import_json_manual():
    """渲染手动输入JSON格式的导入界面"""
    st.info("💡 提示：可以粘贴JSON格式的源列表，或使用预设模板")

    import_json = st.text_area(
        "JSON格式数据",
        height=200,
        placeholder='[{"name": "OpenAI Blog", "url": "https://openai.com/news/rss.xml", "description": "...", "category": "corporate_lab", "tier": "tier1"}]'
    )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("📋 使用预设模板", use_container_width=True):
            st.session_state.show_preset_template = True

    with col2:
        if st.button("✅ 导入", use_container_width=True) and import_json:
            try:
                import json
                sources_data = json.loads(import_json)
                added_count = 0
                error_count = 0

                with st.session_state.db.get_session() as session:
                    for source_data in sources_data:
                        try:
                            existing = session.query(RSSSource).filter(
                                or_(RSSSource.name == source_data.get("name"),
                                    RSSSource.url == source_data.get("url"))
                            ).first()

                            if not existing:
                                new_source = RSSSource(
                                    name=source_data.get("name", ""),
                                    url=source_data.get("url", ""),
                                    description=source_data.get("description"),
                                    category=source_data.get("category", "other"),
                                    tier=source_data.get("tier", "tier3"),
                                    language=source_data.get("language", "en"),
                                    priority=source_data.get("priority", 3),
                                    enabled=source_data.get("enabled", True),
                                    note=source_data.get("note")
                                )
                                session.add(new_source)
                                added_count += 1
                        except Exception as e:
                            error_count += 1
                            st.warning(f"导入失败：{source_data.get('name', 'Unknown')} - {e}")

                    session.commit()
                    st.success(f"✅ 成功导入 {added_count} 个订阅源")
                    if error_count > 0:
                        st.warning(f"⚠️ {error_count} 个源导入失败")
                    st.session_state.show_batch_import = False
                    st.rerun()
            except json.JSONDecodeError:
                st.error("❌ JSON格式错误，请检查输入")
            except Exception as e:
                st.error(f"❌ 导入失败：{e}")

    if st.session_state.get("show_preset_template", False):
        st.code("""[
  {
    "name": "OpenAI Blog",
    "url": "https://openai.com/news/rss.xml",
    "description": "ChatGPT 缔造者",
    "category": "corporate_lab",
    "tier": "tier1",
    "language": "en",
    "priority": 1,
    "enabled": true
  }
]""", language="json")


def render_batch_import():
    """渲染批量导入界面"""
    with st.expander("📥 批量导入订阅源", expanded=True):
        import_method = st.radio(
            "选择导入方式",
            ["导入系统默认RSS源", "手动输入JSON格式"],
            index=0,
            horizontal=True
        )

        st.markdown("---")

        if import_method == "导入系统默认RSS源":
            render_import_default_sources()
        else:
            render_import_json_manual()


def render_source_filters() -> tuple[str, str, str]:
    """
    渲染源筛选器

    Returns:
        (filter_category, filter_tier, filter_enabled)
    """
    col1, col2, col3 = st.columns(3)
    with col1:
        filter_category = st.selectbox("筛选分类", ["全部"] + ["corporate_lab", "academic", "individual", "newsletter", "other"], index=0)
    with col2:
        filter_tier = st.selectbox("筛选梯队", ["全部"] + ["tier1", "tier2", "tier3", "other"], index=0)
    with col3:
        filter_enabled = st.selectbox("状态", ["全部", "启用", "禁用"], index=0)

    return filter_category, filter_tier, filter_enabled


def render_source_item(source: RSSSource, source_latest_articles: dict[int, datetime]):
    """
    渲染单个订阅源的显示

    Args:
        source: RSS源对象
        source_latest_articles: 源ID到最新文章日期的映射
    """
    latest_date = source_latest_articles.get(source.id)

    if source.latest_article_published_at:
        latest_date = source.latest_article_published_at

    date_display, date_status, health_status, _ = get_source_health_info(latest_date)

    title = f"{'✅' if source.enabled else '❌'} {source.name} ({source.category} - {source.tier}) | 最新: {date_display} | 状态: {health_status}"

    with st.expander(title, expanded=False):
        col1, col2 = st.columns([3, 1])

        with col1:
            st.markdown(f"**URL:** [{source.url}]({source.url})")
            if source.description:
                st.markdown(f"**简介:** {source.description}")
            st.markdown(f"**分类:** {source.category} | **梯队:** {source.tier} | **优先级:** {source.priority} | **语言:** {source.language}")
            if source.note:
                st.markdown(f"**备注:** {source.note}")

            if source.last_collected_at:
                st.markdown(f"**最后采集:** {source.last_collected_at.strftime('%Y-%m-%d %H:%M')} | **文章数:** {source.articles_count}")
                if source.latest_article_published_at:
                    st.markdown(f"**最新文章发布:** {source.latest_article_published_at.strftime('%Y-%m-%d %H:%M')}")
            elif source.latest_article_published_at:
                st.markdown(f"**文章数:** {source.articles_count} | **最新文章发布:** {source.latest_article_published_at.strftime('%Y-%m-%d %H:%M')}")

        with col2:
            if st.button("✏️ 编辑", key=f"edit_{source.id}", use_container_width=True):
                st.session_state[f"edit_source_{source.id}"] = True

            if st.button("🗑️ 删除", key=f"delete_{source.id}", use_container_width=True):
                st.session_state[f"delete_source_{source.id}"] = True

            if st.button("🔄 切换状态", key=f"toggle_{source.id}", use_container_width=True):
                try:
                    with st.session_state.db.get_session() as session:
                        source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                        if source_obj:
                            source_obj.enabled = not source_obj.enabled
                            session.commit()
                            st.success(f"✅ 已{'启用' if source_obj.enabled else '禁用'}：{source.name}")
                            st.rerun()
                except Exception as e:
                    st.error(f"❌ 操作失败：{e}")

        render_source_edit_form(source)

        if st.session_state.get(f"delete_source_{source.id}", False):
            st.warning(f"⚠️ 确定要删除订阅源「{source.name}」吗？此操作不可恢复！")
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ 确认删除", key=f"confirm_delete_{source.id}", use_container_width=True):
                    try:
                        with st.session_state.db.get_session() as session:
                            source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                            if source_obj:
                                session.delete(source_obj)
                                session.commit()
                                st.success("✅ 删除成功")
                                st.session_state[f"delete_source_{source.id}"] = False
                                st.rerun()
                    except Exception as e:
                        st.error(f"❌ 删除失败：{e}")

            with col2:
                if st.button("❌ 取消", key=f"cancel_delete_{source.id}", use_container_width=True):
                    st.session_state[f"delete_source_{source.id}"] = False
                    st.rerun()


def render_source_edit_form(source: RSSSource):
    """
    渲染编辑源的表单

    Args:
        source: RSS源对象
    """
    if not st.session_state.get(f"edit_source_{source.id}", False):
        return

    st.markdown("---")
    with st.form(f"edit_form_{source.id}"):
        col1, col2 = st.columns(2)

        with col1:
            edit_name = st.text_input("源名称", value=source.name, key=f"name_{source.id}")
            edit_url = st.text_input("RSS URL", value=source.url, key=f"url_{source.id}")
            edit_description = st.text_area("简介", value=source.description or "", key=f"desc_{source.id}")
            edit_category = st.selectbox("分类", ["corporate_lab", "academic", "individual", "newsletter", "other"],
                                         index=["corporate_lab", "academic", "individual", "newsletter", "other"].index(source.category) if source.category in ["corporate_lab", "academic", "individual", "newsletter", "other"] else 0,
                                         key=f"cat_{source.id}")

        with col2:
            edit_tier = st.selectbox("梯队/级别", ["tier1", "tier2", "tier3", "other"],
                                    index=["tier1", "tier2", "tier3", "other"].index(source.tier) if source.tier in ["tier1", "tier2", "tier3", "other"] else 0,
                                    key=f"tier_{source.id}")
            edit_language = st.selectbox("语言", ["en", "zh", "ja", "other"],
                                       index=["en", "zh", "ja", "other"].index(source.language) if source.language in ["en", "zh", "ja", "other"] else 0,
                                       key=f"lang_{source.id}")
            edit_priority = st.slider("优先级", 1, 5, value=source.priority, key=f"prio_{source.id}")
            edit_enabled = st.checkbox("启用", value=source.enabled, key=f"enabled_{source.id}")
            edit_note = st.text_area("备注", value=source.note or "", key=f"note_{source.id}")

        col1, col2 = st.columns(2)
        with col1:
            if st.form_submit_button("✅ 保存", use_container_width=True):
                try:
                    with st.session_state.db.get_session() as session:
                        source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                        if source_obj:
                            source_obj.name = edit_name
                            source_obj.url = edit_url
                            source_obj.description = edit_description if edit_description else None
                            source_obj.category = edit_category
                            source_obj.tier = edit_tier
                            source_obj.language = edit_language
                            source_obj.priority = edit_priority
                            source_obj.enabled = edit_enabled
                            source_obj.note = edit_note if edit_note else None
                            session.commit()
                            st.success("✅ 更新成功")
                            st.session_state[f"edit_source_{source.id}"] = False
                            st.rerun()
                except Exception as e:
                    st.error(f"❌ 更新失败：{e}")

        with col2:
            if st.form_submit_button("❌ 取消", use_container_width=True):
                st.session_state[f"edit_source_{source.id}"] = False
                st.rerun()


def get_source_health_info(latest_date: datetime = None) -> tuple[str, str, str, str]:
    """
    获取源的健康状态信息

    Args:
        latest_date: 最新文章日期

    Returns:
        (date_display, date_status, health_status, date_str)
    """
    if latest_date:
        if hasattr(latest_date, 'tzinfo') and latest_date.tzinfo:
            latest_date_local = latest_date.replace(tzinfo=None)
        else:
            latest_date_local = latest_date

        now_date = datetime.now().date()
        if isinstance(latest_date_local, datetime):
            latest_date_only = latest_date_local.date()
        else:
            latest_date_only = latest_date_local

        days_ago = (now_date - latest_date_only).days
        if days_ago < 0:
            days_ago = 0

        if days_ago == 0:
            date_display = "今天"
            date_status = "🟢"
            health_status = "活跃"
        elif days_ago == 1:
            date_display = "昨天"
            date_status = "🟢"
            health_status = "活跃"
        elif days_ago < 7:
            date_display = f"{days_ago}天前"
            date_status = "🟡"
            health_status = "正常"
        elif days_ago < 30:
            date_display = f"{days_ago}天前"
            date_status = "🟠"
            health_status = "较慢"
        else:
            date_display = f"{days_ago}天前"
            date_status = "🔴"
            health_status = "停滞"

        if isinstance(latest_date_local, datetime):
            date_str = latest_date_local.strftime('%Y-%m-%d')
        else:
            date_str = str(latest_date_only)

        date_display = f"{date_status} {date_str} ({date_display})"
    else:
        date_display = "⚠️ 暂无文章"
        date_status = "⚪"
        health_status = "无数据"
        date_str = ""

    return date_display, date_status, health_status, date_str


def render_source_item(source: RSSSource, source_latest_articles: dict[int, datetime]):
    """
    渲染单个订阅源的显示

    Args:
        source: RSS源对象
        source_latest_articles: 源ID到最新文章日期的映射
    """
    latest_date = source_latest_articles.get(source.id)

    if source.latest_article_published_at:
        latest_date = source.latest_article_published_at

    date_display, date_status, health_status, _ = get_source_health_info(latest_date)

    title = f"{'✅' if source.enabled else '❌'} {source.name} ({source.category} - {source.tier}) | 最新: {date_display} | 状态: {health_status}"

    with st.expander(title, expanded=False):
        col1, col2 = st.columns([3, 1])

        with col1:
            st.markdown(f"**URL:** [{source.url}]({source.url})")
            if source.description:
                st.markdown(f"**简介:** {source.description}")
            st.markdown(f"**分类:** {source.category} | **梯队:** {source.tier} | **优先级:** {source.priority} | **语言:** {source.language}")
            if source.note:
                st.markdown(f"**备注:** {source.note}")

            if source.last_collected_at:
                st.markdown(f"**最后采集:** {source.last_collected_at.strftime('%Y-%m-%d %H:%M')} | **文章数:** {source.articles_count}")
                if source.latest_article_published_at:
                    st.markdown(f"**最新文章发布:** {source.latest_article_published_at.strftime('%Y-%m-%d %H:%M')}")
            elif source.latest_article_published_at:
                st.markdown(f"**文章数:** {source.articles_count} | **最新文章发布:** {source.latest_article_published_at.strftime('%Y-%m-%d %H:%M')}")

        with col2:
            if st.button("✏️ 编辑", key=f"edit_{source.id}", use_container_width=True):
                st.session_state[f"edit_source_{source.id}"] = True

            if st.button("🗑️ 删除", key=f"delete_{source.id}", use_container_width=True):
                st.session_state[f"delete_source_{source.id}"] = True

            if st.button("🔄 切换状态", key=f"toggle_{source.id}", use_container_width=True):
                try:
                    with st.session_state.db.get_session() as session:
                        source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                        if source_obj:
                            source_obj.enabled = not source_obj.enabled
                            session.commit()
                            st.success(f"✅ 已{'启用' if source_obj.enabled else '禁用'}：{source.name}")
                            st.rerun()
                except Exception as e:
                    st.error(f"❌ 操作失败：{e}")

        render_source_edit_form(source)

        if st.session_state.get(f"delete_source_{source.id}", False):
            st.warning(f"⚠️ 确定要删除订阅源「{source.name}」吗？此操作不可恢复！")
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ 确认删除", key=f"confirm_delete_{source.id}", use_container_width=True):
                    try:
                        with st.session_state.db.get_session() as session:
                            source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                            if source_obj:
                                session.delete(source_obj)
                                session.commit()
                                st.success("✅ 删除成功")
                                st.session_state[f"delete_source_{source.id}"] = False
                                st.rerun()
                    except Exception as e:
                        st.error(f"❌ 删除失败：{e}")

            with col2:
                if st.button("❌ 取消", key=f"cancel_delete_{source.id}", use_container_width=True):
                    st.session_state[f"delete_source_{source.id}"] = False
                    st.rerun()


def render_source_edit_form(source: RSSSource):
    """
    渲染编辑源的表单

    Args:
        source: RSS源对象
    """
    if not st.session_state.get(f"edit_source_{source.id}", False):
        return

    st.markdown("---")
    with st.form(f"edit_form_{source.id}"):
        col1, col2 = st.columns(2)

        with col1:
            edit_name = st.text_input("源名称", value=source.name, key=f"name_{source.id}")
            edit_url = st.text_input("RSS URL", value=source.url, key=f"url_{source.id}")
            edit_description = st.text_area("简介", value=source.description or "", key=f"desc_{source.id}")
            edit_category = st.selectbox("分类", ["corporate_lab", "academic", "individual", "newsletter", "other"],
                                         index=["corporate_lab", "academic", "individual", "newsletter", "other"].index(source.category) if source.category in ["corporate_lab", "academic", "individual", "newsletter", "other"] else 0,
                                         key=f"cat_{source.id}")

        with col2:
            edit_tier = st.selectbox("梯队", ["tier1", "tier2", "tier3", "other"],
                                    index=["tier1", "tier2", "tier3", "other"].index(source.tier) if source.tier in ["tier1", "tier2", "tier3", "other"] else 0,
                                    key=f"tier_{source.id}")
            edit_language = st.selectbox("语言", ["en", "zh", "ja", "other"],
                                       index=["en", "zh", "ja", "other"].index(source.language) if source.language in ["en", "zh", "ja", "other"] else 0,
                                       key=f"lang_{source.id}")
            edit_priority = st.slider("优先级", 1, 5, source.priority, key=f"pri_{source.id}")
            edit_enabled = st.checkbox("启用", value=source.enabled, key=f"enabled_{source.id}")
            edit_note = st.text_area("备注", value=source.note or "", key=f"note_{source.id}")

        col1, col2 = st.columns(2)
        with col1:
            if st.form_submit_button("✅ 保存", use_container_width=True):
                try:
                    with st.session_state.db.get_session() as session:
                        source_obj = session.query(RSSSource).filter(RSSSource.id == source.id).first()
                        if source_obj:
                            source_obj.name = edit_name
                            source_obj.url = edit_url
                            source_obj.description = edit_description if edit_description else None
                            source_obj.category = edit_category
                            source_obj.tier = edit_tier
                            source_obj.language = edit_language
                            source_obj.priority = edit_priority
                            source_obj.enabled = edit_enabled
                            source_obj.note = edit_note if edit_note else None
                            session.commit()
                            st.success("✅ 更新成功")
                            st.session_state[f"edit_source_{source.id}"] = False
                            st.rerun()
                except Exception as e:
                    st.error(f"❌ 更新失败：{e}")

        with col2:
            if st.form_submit_button("❌ 取消", use_container_width=True):
                st.session_state[f"edit_source_{source.id}"] = False
                st.rerun()


def render_source_management():
    """渲染订阅源管理页面"""
    st.subheader("⚙️ RSS订阅源管理")
    
    # 操作选项
    col1, col2, col3 = st.columns(3)
    
    with col1:
        if st.button("➕ 添加新源", use_container_width=True):
            st.session_state.show_add_source = True
    
    with col2:
        if st.button("📥 批量导入", use_container_width=True):
            st.session_state.show_batch_import = True
    
    with col3:
        if st.button("🔄 刷新列表", use_container_width=True):
            st.rerun()
    
    st.markdown("---")
    
    # 添加新源表单
    if st.session_state.get("show_add_source", False):
        with st.expander("➕ 添加新订阅源", expanded=True):
            with st.form("add_source_form"):
                col1, col2 = st.columns(2)
                
                with col1:
                    name = st.text_input("源名称 *", placeholder="例如：OpenAI Blog")
                    url = st.text_input("RSS URL *", placeholder="https://example.com/rss.xml")
                    description = st.text_area("简介/说明", placeholder="简要描述这个源的特点")
                    category = st.selectbox("分类", ["corporate_lab", "academic", "individual", "newsletter", "other"])
                
                with col2:
                    tier = st.selectbox("梯队/级别", ["tier1", "tier2", "tier3", "other"], index=0)
                    language = st.selectbox("语言", ["en", "zh", "ja", "other"], index=0)
                    priority = st.slider("优先级", 1, 5, 1, help="数字越小优先级越高")
                    enabled = st.checkbox("启用", value=True)
                    note = st.text_area("备注", placeholder="可选备注信息")
                
                col_submit, col_cancel = st.columns(2)
                with col_submit:
                    submitted = st.form_submit_button("✅ 保存", use_container_width=True)
                with col_cancel:
                    if st.form_submit_button("❌ 取消", use_container_width=True):
                        st.session_state.show_add_source = False
                        st.rerun()
                
                if submitted:
                    if name and url:
                        try:
                            with st.session_state.db.get_session() as session:
                                # 检查是否已存在
                                existing = session.query(RSSSource).filter(
                                    or_(RSSSource.name == name, RSSSource.url == url)
                                ).first()
                                
                                if existing:
                                    st.error(f"❌ 源已存在：{existing.name}")
                                else:
                                    new_source = RSSSource(
                                        name=name,
                                        url=url,
                                        description=description if description else None,
                                        category=category,
                                        tier=tier,
                                        language=language,
                                        priority=priority,
                                        enabled=enabled,
                                        note=note if note else None
                                    )
                                    session.add(new_source)
                                    session.commit()
                                    st.success(f"✅ 成功添加订阅源：{name}")
                                    st.session_state.show_add_source = False
                                    st.rerun()
                        except Exception as e:
                            st.error(f"❌ 添加失败：{e}")
                    else:
                        st.error("❌ 请填写必填项（名称和URL）")
    
    # 批量导入
    if st.session_state.get("show_batch_import", False):
        with st.expander("📥 批量导入订阅源", expanded=True):
            # 导入方式选择
            import_method = st.radio(
                "选择导入方式",
                ["导入系统默认RSS源", "手动输入JSON格式"],
                index=0,
                horizontal=True
            )
            
            st.markdown("---")
            
            if import_method == "导入系统默认RSS源":
                # 显示系统默认源信息
                default_sources = import_rss_sources.RSS_SOURCES
                
                # 按分类分组显示
                st.info(f"📋 系统默认包含 {len(default_sources)} 个精选 RSS 订阅源")
                
                # 按分类统计
                category_stats = {}
                for source in default_sources:
                    cat = source.get("category", "other")
                    category_stats[cat] = category_stats.get(cat, 0) + 1
                
                st.markdown("**分类统计：**")
                stats_text = " | ".join([f"{cat}: {count}个" for cat, count in category_stats.items()])
                st.markdown(stats_text)
                
                # 预览前几个源
                with st.expander("👀 预览源列表（前10个）", expanded=False):
                    preview_sources = default_sources[:10]
                    for idx, source in enumerate(preview_sources, 1):
                        st.markdown(f"{idx}. **{source.get('name')}** - {source.get('description', '')}")
                    if len(default_sources) > 10:
                        st.caption(f"... 还有 {len(default_sources) - 10} 个源")
                
                # 导入选项
                col1, col2 = st.columns(2)
                with col1:
                    skip_existing = st.checkbox("跳过已存在的源", value=True, help="如果源已存在（名称或URL相同），则跳过不导入")
                
                with col2:
                    import_enabled_only = st.checkbox("仅导入启用的源", value=True, help="只导入 enabled=true 的源")
                
                # 导入按钮
                if st.button("🚀 导入系统默认RSS源", type="primary", use_container_width=True):
                    try:
                        with st.session_state.db.get_session() as session:
                            added_count = 0
                            skipped_count = 0
                            error_count = 0
                            
                            # 显示进度
                            progress_bar = st.progress(0)
                            status_text = st.empty()
                            
                            total_sources = len(default_sources)
                            
                            for idx, source_data in enumerate(default_sources):
                                # 更新进度
                                progress = (idx + 1) / total_sources
                                progress_bar.progress(progress)
                                status_text.text(f"正在导入: {source_data.get('name', 'Unknown')} ({idx + 1}/{total_sources})")
                                
                                # 如果只导入启用的源，跳过未启用的
                                if import_enabled_only and not source_data.get("enabled", True):
                                    skipped_count += 1
                                    continue
                                
                                try:
                                    # 检查是否已存在
                                    existing = session.query(RSSSource).filter(
                                        or_(RSSSource.name == source_data.get("name"), 
                                            RSSSource.url == source_data.get("url"))
                                    ).first()
                                    
                                    if existing:
                                        if skip_existing:
                                            skipped_count += 1
                                            continue
                                        else:
                                            # 更新现有源
                                            existing.name = source_data.get("name", existing.name)
                                            existing.url = source_data.get("url", existing.url)
                                            existing.description = source_data.get("description", existing.description)
                                            existing.category = source_data.get("category", existing.category)
                                            existing.tier = source_data.get("tier", existing.tier)
                                            existing.language = source_data.get("language", existing.language)
                                            existing.priority = source_data.get("priority", existing.priority)
                                            existing.enabled = source_data.get("enabled", existing.enabled)
                                            added_count += 1
                                    else:
                                        # 添加新源
                                        new_source = RSSSource(
                                            name=source_data.get("name", ""),
                                            url=source_data.get("url", ""),
                                            description=source_data.get("description"),
                                            category=source_data.get("category", "other"),
                                            tier=source_data.get("tier", "tier3"),
                                            language=source_data.get("language", "en"),
                                            priority=source_data.get("priority", 3),
                                            enabled=source_data.get("enabled", True),
                                            note=source_data.get("note")
                                        )
                                        session.add(new_source)
                                        added_count += 1
                                except Exception as e:
                                    error_count += 1
                                    logger.error(f"导入失败：{source_data.get('name', 'Unknown')} - {e}")
                            
                            session.commit()
                            
                            # 清除进度条
                            progress_bar.empty()
                            status_text.empty()
                            
                            # 显示结果
                            st.success(f"✅ 导入完成！")
                            st.markdown(f"**导入结果：**")
                            st.markdown(f"- ✅ 新增/更新: {added_count} 个")
                            if skipped_count > 0:
                                st.markdown(f"- ⏭️ 跳过: {skipped_count} 个")
                            if error_count > 0:
                                st.warning(f"⚠️ 错误: {error_count} 个")
                            
                            st.session_state.show_batch_import = False
                            time.sleep(1)
                            st.rerun()
                    except Exception as e:
                        st.error(f"❌ 导入失败：{e}")
                        import traceback
                        st.code(traceback.format_exc())
            
            else:
                # 手动输入JSON格式
                st.info("💡 提示：可以粘贴JSON格式的源列表，或使用预设模板")
                
                import_json = st.text_area(
                    "JSON格式数据",
                    height=200,
                    placeholder='[{"name": "OpenAI Blog", "url": "https://openai.com/news/rss.xml", "description": "...", "category": "corporate_lab", "tier": "tier1"}]'
                )
                
                col1, col2 = st.columns(2)
                with col1:
                    if st.button("📋 使用预设模板", use_container_width=True):
                        st.session_state.show_preset_template = True
                
                with col2:
                    if st.button("✅ 导入", use_container_width=True) and import_json:
                        try:
                            import json
                            sources_data = json.loads(import_json)
                            added_count = 0
                            error_count = 0
                            
                            with st.session_state.db.get_session() as session:
                                for source_data in sources_data:
                                    try:
                                        # 检查是否已存在
                                        existing = session.query(RSSSource).filter(
                                            or_(RSSSource.name == source_data.get("name"), 
                                                RSSSource.url == source_data.get("url"))
                                        ).first()
                                        
                                        if not existing:
                                            new_source = RSSSource(
                                                name=source_data.get("name", ""),
                                                url=source_data.get("url", ""),
                                                description=source_data.get("description"),
                                                category=source_data.get("category", "other"),
                                                tier=source_data.get("tier", "tier3"),
                                                language=source_data.get("language", "en"),
                                                priority=source_data.get("priority", 3),
                                                enabled=source_data.get("enabled", True),
                                                note=source_data.get("note")
                                            )
                                            session.add(new_source)
                                            added_count += 1
                                    except Exception as e:
                                        error_count += 1
                                        st.warning(f"导入失败：{source_data.get('name', 'Unknown')} - {e}")
                                
                                session.commit()
                                st.success(f"✅ 成功导入 {added_count} 个订阅源")
                                if error_count > 0:
                                    st.warning(f"⚠️ {error_count} 个源导入失败")
                                st.session_state.show_batch_import = False
                                st.rerun()
                        except json.JSONDecodeError:
                            st.error("❌ JSON格式错误，请检查输入")
                        except Exception as e:
                            st.error(f"❌ 导入失败：{e}")
                
                if st.session_state.get("show_preset_template", False):
                    st.code("""[
  {
    "name": "OpenAI Blog",
    "url": "https://openai.com/news/rss.xml",
    "description": "ChatGPT 缔造者",
    "category": "corporate_lab",
    "tier": "tier1",
    "language": "en",
    "priority": 1,
    "enabled": true
  }
]""", language="json")
    
    # 显示订阅源列表
    st.subheader("📋 订阅源列表")

    # 筛选选项
    col1, col2, col3 = st.columns(3)
    with col1:
        filter_category = st.selectbox("筛选分类", ["全部"] + ["corporate_lab", "academic", "individual", "newsletter", "other"], index=0)
    with col2:
        filter_tier = st.selectbox("筛选梯队", ["全部"] + ["tier1", "tier2", "tier3", "other"], index=0)
    with col3:
        filter_enabled = st.selectbox("状态", ["全部", "启用", "禁用"], index=0)

    # 获取订阅源列表
    with st.session_state.db.get_session() as session:
        sources = RSSSourceRepository.get_filtered_sources(
            session=session,
            category=filter_category,
            tier=filter_tier,
            enabled_only=True if filter_enabled == "启用" else False if filter_enabled == "禁用" else None
        )

        source_latest_articles = RSSSourceRepository.get_sources_with_latest_articles(session)

        for source in sources:
            _ = source.id
            _ = source.name
            _ = source.url
            _ = source.description
            _ = source.category
            _ = source.tier
            _ = source.enabled
            _ = source.priority
            _ = source.last_collected_at
            _ = source.articles_count
            _ = source.latest_article_published_at

        session.expunge_all()

    st.info(f"📊 共找到 {len(sources)} 个订阅源")

    for source in sources:
        render_source_item(source, source_latest_articles)


def render_data_cleanup():
    """渲染数据清理页面"""
    st.subheader("🗑️ 数据清理")
    st.warning("⚠️ 警告：删除操作不可恢复，请谨慎操作！")
    
    st.markdown("---")
    
    # 当前数据统计
    st.markdown("### 📊 当前数据统计")
    with st.session_state.db.get_session() as session:
        total_articles = session.query(Article).count()
        total_sources = session.query(RSSSource).count()
        total_tasks = session.query(CollectionTask).count()
        total_logs = session.query(CollectionLog).count()
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("文章总数", total_articles)
    col2.metric("订阅源数", total_sources)
    col3.metric("采集任务", total_tasks)
    col4.metric("采集日志", total_logs)
    
    st.markdown("---")
    
    # 清理方式选择
    cleanup_method = st.radio(
        "选择清理方式",
        ["按时间范围清理文章", "按条件清理文章"],
        index=0,
        horizontal=True
    )
    
    st.markdown("---")
    
    if cleanup_method == "按时间范围清理文章":
        st.markdown("### ⏰ 按时间范围清理")
        st.info("💡 将删除指定时间之前的所有文章")
        
        # 时间范围选择
        time_option = st.selectbox(
            "选择时间范围",
            [
                "删除7天前的文章",
                "删除30天前的文章",
                "删除60天前的文章",
                "删除90天前的文章",
                "删除180天前的文章",
                "删除1年前的文章",
                "自定义时间范围"
            ],
            index=1
        )
        
        custom_date = None
        if time_option == "自定义时间范围":
            custom_date = st.date_input(
                "选择截止日期",
                value=datetime.now().date() - timedelta(days=30),
                help="将删除此日期之前的所有文章"
            )
        
        # 计算截止时间
        if time_option == "自定义时间范围" and custom_date:
            cutoff_date = datetime.combine(custom_date, datetime.min.time())
            time_desc = f"截止到 {custom_date.strftime('%Y-%m-%d')}"
        else:
            days_map = {
                "删除7天前的文章": 7,
                "删除30天前的文章": 30,
                "删除60天前的文章": 60,
                "删除90天前的文章": 90,
                "删除180天前的文章": 180,
                "删除1年前的文章": 365
            }
            days = days_map.get(time_option, 30)
            cutoff_date = datetime.now() - timedelta(days=days)
            time_desc = f"{days}天前"
        
        # 预览将要删除的数据
        if st.button("🔍 预览将要删除的数据", use_container_width=True):
            with st.session_state.db.get_session() as session:
                # 按发布时间筛选
                query_by_published = session.query(Article).filter(
                    Article.published_at < cutoff_date
                )
                count_by_published = query_by_published.count()
                
                # 按采集时间筛选（如果没有发布时间）
                query_by_collected = session.query(Article).filter(
                    (Article.published_at.is_(None)) & (Article.collected_at < cutoff_date)
                )
                count_by_collected = query_by_collected.count()
                
                total_to_delete = count_by_published + count_by_collected
                
                if total_to_delete > 0:
                    st.warning(f"⚠️ 将删除约 {total_to_delete} 篇文章")
                    
                    # 按来源统计
                    articles_to_delete = query_by_published.all()
                    if articles_to_delete:
                        source_stats = {}
                        for article in articles_to_delete:
                            source_stats[article.source] = source_stats.get(article.source, 0) + 1
                        
                        st.markdown("**按来源分布：**")
                        for source, count in sorted(source_stats.items(), key=lambda x: x[1], reverse=True)[:10]:
                            st.markdown(f"- {source}: {count} 篇")
                        if len(source_stats) > 10:
                            st.caption(f"... 还有 {len(source_stats) - 10} 个来源")
                    
                    # 保存预览结果到session state
                    st.session_state.cleanup_preview = {
                        "cutoff_date": cutoff_date,
                        "count": total_to_delete,
                        "time_desc": time_desc
                    }
                else:
                    st.info("✅ 没有符合条件的数据需要删除")
                    st.session_state.cleanup_preview = None
        
        # 执行删除
        if st.session_state.get("cleanup_preview"):
            preview = st.session_state.cleanup_preview
            st.markdown("---")
            st.markdown("### ⚠️ 确认删除")
            st.error(f"将删除 {preview['time_desc']} 之前的约 {preview['count']} 篇文章")
            
            confirm_text = st.text_input(
                "请输入 'DELETE' 确认删除操作",
                key="confirm_delete_time",
                help="输入 DELETE 以确认删除"
            )
            
            col1, col2 = st.columns(2)
            with col1:
                if st.button("🗑️ 确认删除", type="primary", use_container_width=True, disabled=(confirm_text != "DELETE")):
                    try:
                        with st.session_state.db.get_session() as session:
                            # 删除按发布时间筛选的文章
                            deleted_published = session.query(Article).filter(
                                Article.published_at < preview['cutoff_date']
                            ).delete(synchronize_session=False)
                            
                            # 删除按采集时间筛选的文章（没有发布时间）
                            deleted_collected = session.query(Article).filter(
                                (Article.published_at.is_(None)) & (Article.collected_at < preview['cutoff_date'])
                            ).delete(synchronize_session=False)
                            
                            session.commit()
                            
                            total_deleted = deleted_published + deleted_collected
                            st.success(f"✅ 成功删除 {total_deleted} 篇文章")
                            st.session_state.cleanup_preview = None
                            time.sleep(1)
                            st.rerun()
                    except Exception as e:
                        st.error(f"❌ 删除失败：{e}")
                        import traceback
                        st.code(traceback.format_exc())
            
            with col2:
                if st.button("❌ 取消", use_container_width=True):
                    st.session_state.cleanup_preview = None
                    st.rerun()
    
    else:
        # 按条件清理
        st.markdown("### 🔍 按条件清理文章")
        st.info("💡 根据指定条件筛选并删除文章")
        
        with st.form("cleanup_by_conditions"):
            col1, col2 = st.columns(2)
            
            with col1:
                # 来源筛选
                with st.session_state.db.get_session() as session:
                    all_sources = [s[0] for s in session.query(Article.source).distinct().all() if s[0]]
                
                selected_sources = st.multiselect(
                    "选择来源（留空表示全部）",
                    all_sources,
                    help="选择要删除的文章来源，留空表示不限制"
                )
                
                # 重要性筛选
                importance_options = ["high", "medium", "low", "未分析"]
                selected_importance = st.multiselect(
                    "选择重要性（留空表示全部）",
                    importance_options,
                    help="选择要删除的文章重要性，留空表示不限制"
                )
                
                # 分类筛选
                with st.session_state.db.get_session() as session:
                    all_categories = [c[0] for c in session.query(Article.category).distinct().all() if c[0]]
                
                selected_categories = st.multiselect(
                    "选择分类（留空表示全部）",
                    all_categories if all_categories else [],
                    help="选择要删除的文章分类，留空表示不限制"
                )
            
            with col2:
                # 时间范围（可选）
                use_time_filter = st.checkbox("启用时间筛选", value=False)
                if use_time_filter:
                    time_range_days = st.number_input(
                        "删除多少天前的文章",
                        min_value=1,
                        max_value=3650,
                        value=30,
                        help="删除此天数之前发布的文章"
                    )
                    cutoff_date = datetime.now() - timedelta(days=int(time_range_days))
                else:
                    cutoff_date = None
                
                # 是否已分析
                is_processed_filter = st.selectbox(
                    "AI分析状态",
                    ["全部", "已分析", "未分析"],
                    index=0
                )
                
                # 是否已推送
                is_sent_filter = st.selectbox(
                    "推送状态",
                    ["全部", "已推送", "未推送"],
                    index=0
                )
            
            # 预览按钮
            preview_submitted = st.form_submit_button("🔍 预览将要删除的数据", use_container_width=True)
            
            if preview_submitted:
                try:
                    with st.session_state.db.get_session() as session:
                        query = session.query(Article)
                        
                        # 应用筛选条件
                        if selected_sources:
                            query = query.filter(Article.source.in_(selected_sources))
                        
                        if selected_importance:
                            if "未分析" in selected_importance:
                                importance_values = [v for v in selected_importance if v != "未分析"]
                                if importance_values:
                                    query = query.filter(
                                        (Article.importance.in_(importance_values)) | (Article.importance == None)
                                    )
                                else:
                                    query = query.filter(Article.importance == None)
                            else:
                                query = query.filter(Article.importance.in_(selected_importance))
                        
                        if selected_categories:
                            query = query.filter(Article.category.in_(selected_categories))
                        
                        if use_time_filter and cutoff_date:
                            query = query.filter(
                                (Article.published_at < cutoff_date) | 
                                ((Article.published_at.is_(None)) & (Article.collected_at < cutoff_date))
                            )
                        
                        if is_processed_filter == "已分析":
                            query = query.filter(Article.is_processed == True)
                        elif is_processed_filter == "未分析":
                            query = query.filter(Article.is_processed == False)
                        
                        if is_sent_filter == "已推送":
                            query = query.filter(Article.is_sent == True)
                        elif is_sent_filter == "未推送":
                            query = query.filter(Article.is_sent == False)
                        
                        count = query.count()
                        
                        if count > 0:
                            st.warning(f"⚠️ 将删除 {count} 篇符合条件的文章")

                            # 显示一些示例
                            sample_articles = query.limit(10).all()
                            st.markdown("**示例文章（前10篇）：**")
                            for article in sample_articles:
                                display_title = article.title_zh if article.title_zh else article.title
                                st.markdown(f"- {display_title[:80]}... ({article.source})")

                            # 保存预览结果
                            st.session_state.cleanup_preview_conditions = {
                                "query": query,
                                "count": count,
                                "conditions": {
                                    "sources": selected_sources,
                                    "importance": selected_importance,
                                    "categories": selected_categories,
                                    "time_filter": use_time_filter,
                                    "cutoff_date": cutoff_date.isoformat() if cutoff_date else None,
                                    "is_processed": is_processed_filter,
                                    "is_sent": is_sent_filter
                                }
                            }
                        else:
                            st.info("✅ 没有符合条件的数据需要删除")
                            st.session_state.cleanup_preview_conditions = None
                except Exception as e:
                    st.error(f"❌ 预览失败：{e}")
                    import traceback
                    st.code(traceback.format_exc())
        
        # 执行删除
        if st.session_state.get("cleanup_preview_conditions"):
            preview = st.session_state.cleanup_preview_conditions
            st.markdown("---")
            st.markdown("### ⚠️ 确认删除")
            st.error(f"将删除 {preview['count']} 篇符合条件的文章")
            
            # 显示删除条件
            with st.expander("📋 查看删除条件", expanded=False):
                conditions = preview['conditions']
                st.markdown(f"- **来源**: {', '.join(conditions['sources']) if conditions['sources'] else '全部'}")
                st.markdown(f"- **重要性**: {', '.join(conditions['importance']) if conditions['importance'] else '全部'}")
                st.markdown(f"- **分类**: {', '.join(conditions['categories']) if conditions['categories'] else '全部'}")
                if conditions['time_filter']:
                    st.markdown(f"- **时间**: {conditions['cutoff_date']} 之前")
                st.markdown(f"- **AI分析状态**: {conditions['is_processed']}")
                st.markdown(f"- **推送状态**: {conditions['is_sent']}")
            
            confirm_text = st.text_input(
                "请输入 'DELETE' 确认删除操作",
                key="confirm_delete_conditions",
                help="输入 DELETE 以确认删除"
            )
            
            col1, col2 = st.columns(2)
            with col1:
                if st.button("🗑️ 确认删除", type="primary", use_container_width=True, disabled=(confirm_text != "DELETE")):
                    try:
                        with st.session_state.db.get_session() as session:
                            # 重新构建查询（因为session已关闭）
                            query = session.query(Article)
                            
                            conditions = preview['conditions']
                            
                            if conditions['sources']:
                                query = query.filter(Article.source.in_(conditions['sources']))
                            
                            if conditions['importance']:
                                if "未分析" in conditions['importance']:
                                    importance_values = [v for v in conditions['importance'] if v != "未分析"]
                                    if importance_values:
                                        query = query.filter(
                                            (Article.importance.in_(importance_values)) | (Article.importance == None)
                                        )
                                    else:
                                        query = query.filter(Article.importance == None)
                                else:
                                    query = query.filter(Article.importance.in_(conditions['importance']))
                            
                            if conditions['categories']:
                                query = query.filter(Article.category.in_(conditions['categories']))
                            
                            if conditions['time_filter'] and conditions['cutoff_date']:
                                cutoff_date = datetime.fromisoformat(conditions['cutoff_date'])
                                query = query.filter(
                                    (Article.published_at < cutoff_date) | 
                                    ((Article.published_at.is_(None)) & (Article.collected_at < cutoff_date))
                                )
                            
                            if conditions['is_processed'] == "已分析":
                                query = query.filter(Article.is_processed == True)
                            elif conditions['is_processed'] == "未分析":
                                query = query.filter(Article.is_processed == False)
                            
                            if conditions['is_sent'] == "已推送":
                                query = query.filter(Article.is_sent == True)
                            elif conditions['is_sent'] == "未推送":
                                query = query.filter(Article.is_sent == False)
                            
                            deleted_count = query.delete(synchronize_session=False)
                            session.commit()
                            
                            st.success(f"✅ 成功删除 {deleted_count} 篇文章")
                            st.session_state.cleanup_preview_conditions = None
                            time.sleep(1)
                            st.rerun()
                    except Exception as e:
                        st.error(f"❌ 删除失败：{e}")
                        import traceback
                        st.code(traceback.format_exc())
            
            with col2:
                if st.button("❌ 取消", use_container_width=True, key="cancel_conditions"):
                    st.session_state.cleanup_preview_conditions = None
                    st.rerun()


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

    # 在主内容区顶部显示采集状态（如果正在采集）
    if (st.session_state.collection_status == "running" and 
        st.session_state.collection_thread and 
        st.session_state.collection_thread.is_alive()):
        st.info("🔄 " + st.session_state.collection_message + " (采集进行中，您可以继续浏览文章...)")

    # 标签页
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["📰 文章列表", "📈 数据统计", "🚀 采集历史", "⚙️ 订阅源管理", "🗑️ 数据清理"])

    with tab1:
        st.subheader(f"📰 最新AI资讯 ({filters['time_range']})")

        # 获取文章
        articles = get_articles_by_filters(filters)

        if not articles:
            st.info("🤷 暂无文章，请前往「采集历史」页面点击「开始采集」按钮")
        else:
            # 显示文章数量
            st.info(f"📊 找到 {len(articles)} 篇文章")

            # 渲染文章
            for article in articles:
                render_article_card(article)

    with tab2:
        render_statistics_tab(articles)

    with tab3:
        render_collection_history()

    with tab4:
        render_source_management()
    
    with tab5:
        render_data_cleanup()


if __name__ == "__main__":
    main()
