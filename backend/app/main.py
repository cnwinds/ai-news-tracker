"""
FastAPI 应用入口
"""
import sys
from pathlib import Path

# 在导入 backend 模块之前，先设置 Python 路径
# 计算项目根目录（从当前文件位置：backend/app/main.py -> backend/app -> backend -> 项目根）
_current_file = Path(__file__).resolve()
_project_root = _current_file.parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from contextlib import asynccontextmanager
import logging
import os
import traceback
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中（双重保险）
setup_python_path()

from backend.app.core.config import settings
from backend.app.core.security import setup_cors
from backend.app.api.v1.api import api_router
from backend.app.utils import setup_logger

logger = setup_logger(__name__)

# 全局调度器实例
scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（启动和关闭事件）"""
    global scheduler
    
    # 启动事件
    logger.info("🚀 应用启动中...")
    
    # 初始化数据库（确保数据库已创建）
    try:
        from backend.app.db import get_db
        db = get_db()
        logger.info("✅ 数据库已初始化")
    except Exception as e:
        logger.warning(f"⚠️  数据库初始化失败: {e}")
    
    # 从数据库加载配置
    try:
        from backend.app.core.settings import settings as app_settings
        app_settings.load_settings_from_db()
        logger.info("✅ 配置已从数据库加载")
        
        # 第二阶段：初始化 vec0 虚拟表（需要配置加载后才能确定维度）
        try:
            db.init_sqlite_vec_table(embedding_model=app_settings.OPENAI_EMBEDDING_MODEL)
            logger.info("✅ vec0虚拟表初始化完成")
        except Exception as e:
            logger.warning(f"⚠️  vec0虚拟表初始化失败: {e}")
    except Exception as e:
        logger.warning(f"⚠️  从数据库加载配置失败: {e}")
    
    # 启动定时任务调度器
    # 如果自动采集已启用，则启动调度器
    if app_settings.AUTO_COLLECTION_ENABLED:
        try:
            from backend.app.services.scheduler import create_scheduler
            scheduler = create_scheduler()
            logger.info("✅ 定时任务调度器已启动")
            
            # 检查调度器中的任务
            if scheduler and scheduler.scheduler:
                jobs = scheduler.scheduler.get_jobs()
                if jobs:
                    logger.info(f"📋 已注册 {len(jobs)} 个定时任务:")
                    for job in jobs:
                        logger.info(f"   - {job.name} (ID: {job.id}, Next: {job.next_run_time})")
                else:
                    logger.warning("⚠️  调度器已启动，但未找到任何定时任务")
        except Exception as e:
            logger.error(f"❌ 启动定时任务调度器失败: {e}", exc_info=True)
    else:
        logger.info("ℹ️  定时任务调度器未启用（自动采集未启用）")
        logger.info("   提示: 在系统功能中启用自动采集以启动调度器")
    
    yield
    
    # 关闭事件
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
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """捕获请求验证错误并记录详细信息"""
    logger.error(f"请求验证失败: URL={request.url}, method={request.method}")
    logger.error(f"查询参数: {request.query_params}")
    logger.error(f"路径参数: {request.path_params}")
    logger.error(f"验证错误详情: {exc.errors()}")
    logger.error(f"请求体: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "body": str(await request.body()) if hasattr(request, '_body') else None,
            "query_params": dict(request.query_params),
            "path_params": dict(request.path_params),
        }
    )


@app.get("/")
async def root():
    """根路径"""
    return JSONResponse({
        "message": "AI News Tracker API",
        "version": settings.VERSION,
        "docs": "/docs",
    })


@app.get("/health")
async def health_check():
    """健康检查"""
    return JSONResponse({"status": "healthy"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )

