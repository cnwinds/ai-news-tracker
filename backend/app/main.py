"""
FastAPI 应用入口
"""
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, TYPE_CHECKING

# 在导入 backend 模块之前，先设置 Python 路径
# 计算项目根目录：backend/app/main.py -> backend/app -> backend -> 项目根
_current_file = Path(__file__).resolve()
_project_root = _current_file.parent.parent.parent
_project_root_str = str(_project_root)
if _project_root_str not in sys.path:
    sys.path.insert(0, _project_root_str)

# 现在可以安全地导入 backend 模块
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中（双重保险）
setup_python_path()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.app.api.v1.api import api_router
from backend.app.core.config import settings
from backend.app.core.security import setup_cors
from backend.app.utils import setup_logger

if TYPE_CHECKING:
    from backend.app.services.scheduler.scheduler import SchedulerService

logger = setup_logger(__name__)

# 全局调度器实例
scheduler: Optional["SchedulerService"] = None


def _initialize_database() -> None:
    """初始化数据库"""
    from backend.app.db import get_db
    
    db = get_db()
    logger.info("✅ 数据库已初始化")
    return db


def _load_settings_and_init_vectors() -> None:
    """从数据库加载配置并初始化向量表"""
    from backend.app.core.settings import settings as app_settings
    from backend.app.db import get_db
    
    app_settings.load_settings_from_db()
    logger.info("✅ 配置已从数据库加载")
    
    db = get_db()
    try:
        db.init_sqlite_vec_table(embedding_model=app_settings.OPENAI_EMBEDDING_MODEL)
        logger.info("✅ vec0虚拟表初始化完成")
    except Exception as e:
        logger.warning(f"⚠️  vec0虚拟表初始化失败: {e}")


def _start_scheduler() -> Optional["SchedulerService"]:
    """启动定时任务调度器
    
    Returns:
        调度器实例，如果启动失败则返回 None
    """
    from backend.app.services.scheduler.scheduler import create_scheduler
    
    scheduler_instance = create_scheduler()
    logger.info("✅ 定时任务调度器已启动")
    
    if scheduler_instance and scheduler_instance.scheduler:
        jobs = scheduler_instance.scheduler.get_jobs()
        if jobs:
            logger.info(f"📋 已注册 {len(jobs)} 个定时任务:")
            for job in jobs:
                logger.info(f"   - {job.name} (ID: {job.id}, Next: {job.next_run_time})")
        else:
            logger.info("ℹ️  调度器已启动，但当前没有启用的定时任务")
    else:
        logger.warning("⚠️  调度器初始化失败")
    
    return scheduler_instance


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（启动和关闭事件）
    
    Args:
        app: FastAPI 应用实例
    """
    global scheduler
    
    logger.info("🚀 应用启动中...")
    
    try:
        _initialize_database()
    except Exception as e:
        logger.warning(f"⚠️  数据库初始化失败: {e}")
        raise
    
    try:
        _load_settings_and_init_vectors()
    except Exception as e:
        logger.warning(f"⚠️  从数据库加载配置失败: {e}")
    
    if os.getenv("SCHEDULER_ENABLED", "true").lower() in {"0", "false", "no", "off"}:
        logger.info("⏸️  SCHEDULER_ENABLED=false，跳过定时任务调度器")
    else:
        try:
            scheduler = _start_scheduler()
        except Exception as e:
            logger.error(f"❌ 启动定时任务调度器失败: {e}", exc_info=True)
    
    yield
    
    logger.info("⏹️  应用关闭中...")
    
    if scheduler:
        try:
            scheduler.shutdown()
            logger.info("✅ 定时任务调度器已关闭")
        except Exception as e:
            logger.error(f"❌ 关闭定时任务调度器失败: {e}", exc_info=True)
    
    logger.info("✅ 应用已关闭")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,  # 使用新的 lifespan 事件处理器
)

# 配置 CORS
setup_cors(app)

# 注册路由
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """捕获请求验证错误并记录详细信息
    
    Args:
        request: FastAPI 请求对象
        exc: 验证错误异常
        
    Returns:
        JSON 响应，包含错误详情
    """
    logger.error(
        f"请求验证失败: URL={request.url}, method={request.method}, "
        f"查询参数={request.query_params}, 路径参数={request.path_params}"
    )
    logger.error(f"验证错误详情: {exc.errors()}")
    
    body = await request.body()
    if body:
        logger.error(f"请求体: {body}")
    
    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "body": body.decode("utf-8") if body else None,
            "query_params": dict(request.query_params),
            "path_params": dict(request.path_params),
        }
    )


@app.get("/")
async def root() -> JSONResponse:
    """根路径
    
    Returns:
        API 基本信息
    """
    return JSONResponse({
        "message": "AI News Tracker API",
        "version": settings.VERSION,
        "docs": "/docs",
    })


@app.get("/health")
async def health_check() -> JSONResponse:
    """健康检查端点
    
    Returns:
        健康状态信息
    """
    return JSONResponse({"status": "healthy"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )

