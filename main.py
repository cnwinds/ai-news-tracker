"""
AI News Tracker - 主程序入口
命令行工具
"""
import sys
import click
import logging
from pathlib import Path
from datetime import datetime
import os

# 添加项目根目录到Python路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

from collector import CollectionService
from notification import NotificationService
from database import get_db
from utils import create_ai_analyzer, setup_logger

# 配置日志
logger = setup_logger(__name__)


@click.group()
@click.version_option(version="1.0.0")
def cli():
    """AI News Tracker - AI前沿资讯自动追踪系统

    一个自动采集、分析、推送AI前沿资讯的智能系统。
    """
    pass


@cli.command()
@click.option("--enable-ai", is_flag=True, help="启用AI分析")
@click.option("--no-ai", is_flag=True, help="禁用AI分析")
def collect(enable_ai, no_ai):
    """采集数据"""
    click.echo("🚀 开始采集数据...")

    # 确定是否启用AI
    use_ai = enable_ai or (not no_ai and os.getenv("OPENAI_API_KEY"))

    # 初始化AI分析器
    ai_analyzer = None
    if use_ai:
        ai_analyzer = create_ai_analyzer()
        if not ai_analyzer:
            click.echo("⚠️  未配置OPENAI_API_KEY，将跳过AI分析", err=True)
        else:
            click.echo("✅ AI分析器已启用")

    # 初始化采集服务
    collector = CollectionService(ai_analyzer=ai_analyzer)

    # 执行采集
    try:
        with click.progressbar(length=100, label="采集进度") as bar:
            stats = collector.collect_all(enable_ai_analysis=use_ai)
            bar.update(100)

        # 显示结果
        click.echo("\n✅ 采集完成!")
        click.echo(f"   总文章数: {stats['total_articles']}")
        click.echo(f"   新增文章: {stats['new_articles']}")
        click.echo(f"   成功源数: {stats['sources_success']}")
        click.echo(f"   失败源数: {stats['sources_error']}")
        click.echo(f"   耗时: {stats['duration']:.2f}秒")

        if "analyzed_count" in stats:
            click.echo(f"   AI分析: {stats['analyzed_count']} 篇")

    except Exception as e:
        click.echo(f"❌ 采集失败: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option("--limit", default=10, help="最大文章数")
@click.option("--hours", default=24, help="时间范围（小时）")
def summary(limit, hours):
    """生成每日摘要"""
    click.echo(f"📝 生成每日摘要 (最近{hours}小时)...")

    # 检查API配置
    if not os.getenv("OPENAI_API_KEY"):
        click.echo("❌ 未配置OPENAI_API_KEY", err=True)
        sys.exit(1)

    # 初始化
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        click.echo("❌ 未配置OPENAI_API_KEY", err=True)
        sys.exit(1)

    collector = CollectionService(ai_analyzer=ai_analyzer)
    db = get_db()

    try:
        # 获取文章
        articles = collector.get_daily_summary(db, limit=limit)

        if not articles:
            click.echo("📭 暂无重要文章")
            return

        click.echo(f"📊 找到 {len(articles)} 篇重要文章")

        # 准备数据
        articles_data = []
        for article in articles:
            articles_data.append(
                {
                    "title": article.title,
                    "content": article.content,
                    "source": article.source,
                    "published_at": article.published_at,
                }
            )

        # 生成摘要
        with click.progressbar(length=100, label="AI生成中...") as bar:
            summary_text = ai_analyzer.generate_daily_summary(articles_data, max_count=limit)
            bar.update(100)

        # 显示摘要
        click.echo("\n" + "=" * 60)
        click.echo("📅 每日AI资讯摘要")
        click.echo("=" * 60)
        click.echo(summary_text)
        click.echo("=" * 60)

    except Exception as e:
        click.echo(f"❌ 生成摘要失败: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option("--limit", default=20, help="显示文章数")
@click.option("--hours", default=24, help="时间范围（小时）")
@click.option("--importance", type=click.Choice(["high", "medium", "low"]), help="筛选重要性")
def list(limit, hours, importance):
    """列出最近的文章"""
    db = get_db()

    with db.get_session() as session:
        from datetime import timedelta
        from database.models import Article

        # 构建查询
        time_threshold = datetime.now() - timedelta(hours=hours)
        query = session.query(Article).filter(Article.published_at >= time_threshold)

        if importance:
            query = query.filter(Article.importance == importance)

        articles = query.order_by(Article.published_at.desc()).limit(limit).all()

        if not articles:
            click.echo(f"📭 最近{hours}小时暂无文章")
            return

        click.echo(f"\n📰 最近{hours}小时的文章 (共{len(articles)}篇):\n")

        for i, article in enumerate(articles, 1):
            importance_emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(article.importance, "⚪")

            click.echo(f"{i}. {importance_emoji} {article.title}")
            click.echo(f"   📰 {article.source} | 📅 {article.published_at.strftime('%Y-%m-%d %H:%M') if article.published_at else 'Unknown'}")

            if article.summary:
                click.echo(f"   📝 {article.summary[:100]}...")

            if article.tags:
                tags_str = " ".join([f"#{tag}" for tag in article.tags[:5]])
                click.echo(f"   🏷️  {tags_str}")

            click.echo()


@cli.command()
@click.option("--webhook", help="飞书Webhook URL（覆盖环境变量）")
def send(webhook):
    """发送每日摘要到飞书"""
    click.echo("📤 准备发送每日摘要到飞书...")

    # 检查配置
    feishu_webhook = webhook or os.getenv("FEISHU_BOT_WEBHOOK")
    if not feishu_webhook:
        click.echo("❌ 未配置FEISHU_BOT_WEBHOOK", err=True)
        sys.exit(1)

    if not os.getenv("OPENAI_API_KEY"):
        click.echo("❌ 未配置OPENAI_API_KEY", err=True)
        sys.exit(1)

    # 初始化服务
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        click.echo("❌ 未配置OPENAI_API_KEY", err=True)
        sys.exit(1)

    collector = CollectionService(ai_analyzer=ai_analyzer)
    notifier = NotificationService(feishu_webhook=feishu_webhook)
    db = get_db()

    try:
        # 生成摘要
        articles = collector.get_daily_summary(db, limit=20)

        if not articles:
            click.echo("📭 暂无重要文章可推送")
            return

        click.echo(f"📊 找到 {len(articles)} 篇重要文章")

        articles_data = []
        for article in articles:
            articles_data.append(
                {
                    "title": article.title,
                    "content": article.content,
                    "source": article.source,
                    "published_at": article.published_at,
                }
            )

        summary = ai_analyzer.generate_daily_summary(articles_data, max_count=15)

        # 发送
        click.echo("📤 正在发送到飞书...")
        success = notifier.send_daily_summary(summary, db, limit=20)

        if success:
            click.echo("✅ 发送成功!")
        else:
            click.echo("❌ 发送失败", err=True)
            sys.exit(1)

    except Exception as e:
        click.echo(f"❌ 发送失败: {e}", err=True)
        sys.exit(1)


@cli.command()
def web():
    """启动Web Dashboard"""
    import subprocess

    click.echo("🌐 启动Web Dashboard...")

    try:
        # 使用streamlit运行
        subprocess.run(["streamlit", "run", "web/app.py"], cwd=project_root)

    except KeyboardInterrupt:
        click.echo("\n⏹️  Web Dashboard已停止")
    except Exception as e:
        click.echo(f"❌ 启动失败: {e}", err=True)
        sys.exit(1)


@cli.command()
def schedule():
    """启动定时任务调度器"""
    import subprocess

    click.echo("⏰ 启动定时任务调度器...")

    try:
        # 运行调度器
        subprocess.run([sys.executable, "scheduler.py"], cwd=project_root)

    except KeyboardInterrupt:
        click.echo("\n⏹️  调度器已停止")
    except Exception as e:
        click.echo(f"❌ 启动失败: {e}", err=True)
        sys.exit(1)


@cli.command()
def init():
    """初始化项目（创建数据库、配置文件等）"""
    click.echo("🔧 初始化AI News Tracker...")

    # 创建必要的目录
    dirs = ["data", "logs", "config"]
    for dir_name in dirs:
        dir_path = project_root / dir_name
        dir_path.mkdir(parents=True, exist_ok=True)
        click.echo(f"   ✅ 创建目录: {dir_name}")

    # 复制配置文件
    env_example = project_root / ".env.example"
    env_file = project_root / ".env"

    if not env_file.exists() and env_example.exists():
        import shutil

        shutil.copy(env_example, env_file)
        click.echo("   ✅ 创建配置文件: .env")
        click.echo("   ⚠️  请编辑 .env 文件，填写API密钥等配置")
    else:
        click.echo("   ℹ️  配置文件已存在")

    # 初始化数据库
    try:
        db = get_db()
        click.echo("   ✅ 数据库初始化成功")
    except Exception as e:
        click.echo(f"   ❌ 数据库初始化失败: {e}", err=True)

    click.echo("\n✅ 初始化完成!")
    click.echo("\n下一步:")
    click.echo("1. 编辑 .env 文件，配置API密钥")
    click.echo("2. 运行 'python main.py collect' 测试采集")
    click.echo("3. 运行 'python main.py web' 启动Web界面")
    click.echo("4. 运行 'python main.py schedule' 启动定时任务")


@cli.command()
@click.option("--force", is_flag=True, help="强制删除所有数据")
def reset(force):
    """重置数据库（⚠️  危险操作）"""
    if not force:
        confirm = click.confirm("⚠️  这将删除所有数据，确定要继续吗？")
        if not confirm:
            click.echo("❌ 操作已取消")
            return

    click.echo("🗑️  正在重置数据库...")

    try:
        db = get_db()
        db.drop_all()
        db.init_db()
        click.echo("✅ 数据库已重置")
    except Exception as e:
        click.echo(f"❌ 重置失败: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
