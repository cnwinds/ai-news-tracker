"""
依赖注入
"""
from typing import Generator
from sqlalchemy.orm import Session

from backend.app.db import get_db
from backend.app.services.collector import CollectionService
from backend.app.utils import create_ai_analyzer


def get_database() -> Generator[Session, None, None]:
    """获取数据库会话
    
    Yields:
        Session: SQLAlchemy 数据库会话
    """
    db = get_db()
    with db.get_session() as session:
        yield session


def get_collection_service() -> CollectionService:
    """获取采集服务实例
    
    Returns:
        CollectionService: 采集服务实例
    """
    ai_analyzer = create_ai_analyzer()
    return CollectionService(ai_analyzer=ai_analyzer)

