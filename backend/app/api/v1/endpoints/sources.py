"""
订阅源相关 API 端点
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.app.core.paths import setup_python_path, APP_ROOT

# 确保项目根目录在 Python 路径中
setup_python_path()

from backend.app.db.repositories import RSSSourceRepository
from backend.app.db.models import RSSSource
from backend.app.core.dependencies import get_database
from backend.app.schemas.source import (
    RSSSource as RSSSourceSchema,
    RSSSourceCreate,
    RSSSourceUpdate,
)
# 导入配置模块
import logging
logger = logging.getLogger(__name__)

try:
    from backend.app.core import import_rss_sources
    logger.info("成功加载 import_rss_sources 模块")
except Exception as e:
    logger.error(f"加载 import_rss_sources 模块失败: {e}", exc_info=True)
    import_rss_sources = None

router = APIRouter()


@router.get("", response_model=List[RSSSourceSchema])
async def get_sources(
    category: str = None,
    tier: str = None,
    source_type: str = None,
    enabled_only: bool = None,
    db: Session = Depends(get_database),
):
    """获取订阅源列表"""
    sources = RSSSourceRepository.get_filtered_sources(
        session=db,
        category=category,
        tier=tier,
        source_type=source_type,
        enabled_only=enabled_only,
    )
    return [RSSSourceSchema.model_validate(s) for s in sources]


@router.get("/{source_id}", response_model=RSSSourceSchema)
async def get_source(
    source_id: int,
    db: Session = Depends(get_database),
):
    """获取订阅源详情"""
    source = db.query(RSSSource).filter(RSSSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    return RSSSourceSchema.model_validate(source)


@router.post("", response_model=RSSSourceSchema)
async def create_source(
    source_data: RSSSourceCreate,
    db: Session = Depends(get_database),
):
    """创建订阅源"""
    # 检查名称和URL是否已存在
    existing = db.query(RSSSource).filter(
        (RSSSource.name == source_data.name) | (RSSSource.url == source_data.url)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="订阅源名称或URL已存在")
    
    source = RSSSource(**source_data.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    return RSSSourceSchema.model_validate(source)


@router.put("/{source_id}", response_model=RSSSourceSchema)
async def update_source(
    source_id: int,
    source_data: RSSSourceUpdate,
    db: Session = Depends(get_database),
):
    """更新订阅源"""
    source = db.query(RSSSource).filter(RSSSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    
    # 更新字段
    update_data = source_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(source, field, value)
    
    db.commit()
    db.refresh(source)
    return RSSSourceSchema.model_validate(source)


@router.delete("/{source_id}")
async def delete_source(
    source_id: int,
    db: Session = Depends(get_database),
):
    """删除订阅源"""
    source = db.query(RSSSource).filter(RSSSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    
    db.delete(source)
    db.commit()
    return {"message": "订阅源已删除", "source_id": source_id}


@router.get("/default/list", response_model=List[dict])
async def get_default_sources(
    source_type: str = None,
):
    """获取默认数据源列表（从 backend/app/sources.json）"""
    # 如果模块加载失败，直接读取 JSON 文件
    if not import_rss_sources:
        logger.warning("import_rss_sources 模块未加载，尝试直接读取 JSON 文件")
        # sources.json 在 backend/app 目录下
        sources_json_path = APP_ROOT / "sources.json"
        
        if not sources_json_path.exists():
            error_msg = f"无法找到 sources.json 文件。路径: {sources_json_path}"
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        
        try:
            import json
            with open(sources_json_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            # 根据 source_type 返回对应的源
            if source_type:
                source_key = f"{source_type}_sources"
                sources = config.get(source_key, [])
            else:
                # 返回所有类型的源
                sources = []
                sources.extend(config.get("rss_sources", []))
                sources.extend(config.get("api_sources", []))
                sources.extend(config.get("web_sources", []))
                sources.extend(config.get("social_sources", []))
            
            # 格式化源数据
            formatted_sources = []
            for source in sources:
                # 提取 extra_config（如果存在）
                extra_config = source.get("extra_config", {})
                if isinstance(extra_config, str):
                    try:
                        extra_config = json.loads(extra_config)
                    except:
                        extra_config = {}
                
                # 处理 description：优先使用 description，如果没有则使用 note（向后兼容）
                description = source.get("description", "")
                if not description:
                    description = source.get("note", "")
                
                formatted_source = {
                    "name": source.get("name", ""),
                    "url": source.get("url", ""),
                    "description": description,
                    "category": source.get("category", "other"),
                    "tier": source.get("tier", "tier3"),
                    "source_type": source.get("source_type", source_type or "rss"),
                    "language": source.get("language", "en"),
                    "priority": source.get("priority", 3),
                    "enabled": source.get("enabled", True),
                    "extra_config": extra_config if extra_config else {},
                }
                formatted_sources.append(formatted_source)
            
            return formatted_sources
        except Exception as e:
            logger.error(f"读取 sources.json 失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"读取默认数据源失败: {str(e)}")
    
    # 使用模块加载
    try:
        if source_type:
            # 获取指定类型的源
            if source_type == "rss":
                sources = import_rss_sources.load_rss_sources()
            elif source_type == "api":
                sources = import_rss_sources.load_api_sources()
            elif source_type == "web":
                sources = import_rss_sources.load_web_sources()
            elif source_type == "social":
                sources = import_rss_sources.load_social_sources()
            else:
                sources = []
        else:
            # 获取所有类型的源
            sources = import_rss_sources.load_all_sources()
        
        return sources
    except Exception as e:
        logger.error(f"获取默认数据源失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取默认数据源失败: {str(e)}")


@router.post("/default/import")
async def import_default_sources(
    source_names: List[str],
    db: Session = Depends(get_database),
):
    """批量导入默认数据源"""
    # 如果模块加载失败，直接读取 JSON 文件
    if not import_rss_sources:
        logger.warning("import_rss_sources 模块未加载，尝试直接读取 JSON 文件")
        # sources.json 在 backend/app 目录下
        sources_json_path = APP_ROOT / "sources.json"
        
        if not sources_json_path.exists():
            error_msg = f"无法找到 sources.json 文件。路径: {sources_json_path}"
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        
        try:
            import json
            with open(sources_json_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            all_sources = []
            all_sources.extend(config.get("rss_sources", []))
            all_sources.extend(config.get("api_sources", []))
            all_sources.extend(config.get("web_sources", []))
            all_sources.extend(config.get("social_sources", []))
        except Exception as e:
            logger.error(f"读取 sources.json 失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"读取默认数据源失败: {str(e)}")
    else:
        try:
            all_sources = import_rss_sources.load_all_sources()
        except Exception as e:
            logger.error(f"加载默认数据源失败: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"加载默认数据源失败: {str(e)}")
    
    try:
        
        # 筛选要导入的源
        sources_to_import = [
            s for s in all_sources
            if s.get("name") in source_names
        ]
        
        if not sources_to_import:
            raise HTTPException(status_code=400, detail="没有找到要导入的源")
        
        imported_count = 0
        skipped_count = 0
        errors = []
        
        for source_data in sources_to_import:
            try:
                # 检查是否已存在（根据名称或URL）
                existing = db.query(RSSSource).filter(
                    (RSSSource.name == source_data.get("name")) |
                    (RSSSource.url == source_data.get("url"))
                ).first()
                
                if existing:
                    skipped_count += 1
                    continue
                
                # 处理 extra_config（如果是字典，序列化为JSON字符串）
                extra_config = source_data.get("extra_config", "")
                if isinstance(extra_config, dict):
                    import json
                    extra_config = json.dumps(extra_config, ensure_ascii=False)
                elif not extra_config:
                    extra_config = ""
                
                # 处理 description：优先使用 description，如果没有则使用 note（向后兼容）
                description = source_data.get("description", "")
                if not description:
                    description = source_data.get("note", "")
                
                # 创建新源
                new_source = RSSSource(
                    name=source_data.get("name", ""),
                    url=source_data.get("url", ""),
                    description=description,
                    category=source_data.get("category", "other"),
                    tier=source_data.get("tier", "tier3"),
                    source_type=source_data.get("source_type", "rss"),
                    language=source_data.get("language", "en"),
                    enabled=source_data.get("enabled", True),
                    priority=source_data.get("priority", 3),
                    note=None,  # 不再使用 note 字段存储描述信息
                    extra_config=extra_config,
                )
                db.add(new_source)
                imported_count += 1
            except Exception as e:
                errors.append(f"{source_data.get('name', '未知')}: {str(e)}")
        
        db.commit()
        
        return {
            "message": "导入完成",
            "imported": imported_count,
            "skipped": skipped_count,
            "errors": errors if errors else None,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")

