"""
安全相关配置（CORS等）
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import settings


def setup_cors(app: FastAPI) -> None:
    """配置 CORS 中间件
    
    Args:
        app: FastAPI 应用实例
    """
    allow_all_origins = settings.BACKEND_CORS_ORIGINS == ["*"]
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=not allow_all_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
