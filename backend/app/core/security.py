"""
安全相关配置（CORS等）
"""
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from backend.app.core.config import settings


def setup_cors(app: FastAPI) -> None:
    """配置 CORS 中间件"""
    # 如果允许所有来源，不能同时设置 allow_credentials=True
    allow_all_origins = settings.BACKEND_CORS_ORIGINS == ["*"]
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=not allow_all_origins,  # 如果允许所有来源，则不允许凭证
        allow_methods=["*"],
        allow_headers=["*"],
    )




