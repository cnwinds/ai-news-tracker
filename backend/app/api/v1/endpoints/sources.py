"""
订阅源相关 API 端点
"""
import asyncio
import json
import logging
from typing import List, Optional, Dict, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core import import_rss_sources
from backend.app.core.dependencies import get_database
from backend.app.core.paths import APP_ROOT
from backend.app.db.models import RSSSource
from backend.app.db.repositories import RSSSourceRepository
from backend.app.schemas.source import (
    RSSSource as RSSSourceSchema,
    RSSSourceCreate,
    RSSSourceUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def parse_extra_config_safely(extra_config_raw: Union[str, dict, None]) -> dict:
    """
    安全地解析 extra_config
    
    Args:
        extra_config_raw: extra_config 原始值（可能是字符串、字典或None）
        
    Returns:
        解析后的字典，如果解析失败则返回空字典
    """
    if extra_config_raw is None:
        return {}
    if isinstance(extra_config_raw, dict):
        return extra_config_raw
    if isinstance(extra_config_raw, str):
        try:
            return json.loads(extra_config_raw)
        except (json.JSONDecodeError, TypeError, ValueError) as e:
            logger.warning(f"解析 extra_config 字符串失败: {e}")
            return {}
    return {}


def extract_sub_type_from_config(
    source_type: str, 
    extra_config: Dict[str, str], 
    url: str = ""
) -> Optional[str]:
    """
    从extra_config中提取sub_type（用于导入新源时）
    
    Args:
        source_type: 源类型（rss/api/web/email）
        extra_config: 扩展配置字典
        url: 源URL（用于从URL特征判断）
    
    Returns:
        sub_type字符串，如果无法确定则返回None
    """
    if not extra_config:
        return None
    
    url_lower = url.lower() if url else ""
    
    if source_type == "api":
        # API源：从collector_type提取
        collector_type = extra_config.get("collector_type", "").lower()
        if collector_type:
            type_mapping = {
                "hf": "huggingface",
                "huggingface": "huggingface",
                "pwc": "paperswithcode",
                "paperswithcode": "paperswithcode",
            }
            return type_mapping.get(collector_type, collector_type)
        
        # 从URL判断
        url_type_mapping = {
            "arxiv.org": "arxiv",
            "huggingface.co": "huggingface",
            "paperswithcode.com": "paperswithcode",
        }
        for domain, sub_type in url_type_mapping.items():
            if domain in url_lower:
                return sub_type
        
        if "twitter.com" in url_lower or "x.com" in url_lower:
            return "twitter"
    
    return None


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
    current_user: str = Depends(require_auth),
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
    current_user: str = Depends(require_auth),
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
    current_user: str = Depends(require_auth),
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
                sources.extend(config.get("email_sources", []))
            
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
                    "sub_type": source.get("sub_type"),  # 添加sub_type字段
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
            elif source_type == "email":
                sources = import_rss_sources.load_email_sources()
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
    current_user: str = Depends(require_auth),
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
            with open(sources_json_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            all_sources = []
            all_sources.extend(config.get("rss_sources", []))
            all_sources.extend(config.get("api_sources", []))
            all_sources.extend(config.get("web_sources", []))
            all_sources.extend(config.get("email_sources", []))
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
            source_name = source_data.get("name", "未知")
            try:
                # 检查是否已存在（根据名称或URL）
                existing = db.query(RSSSource).filter(
                    (RSSSource.name == source_data.get("name")) |
                    (RSSSource.url == source_data.get("url"))
                ).first()
                
                if existing:
                    # 如果源已存在，检查是否需要更新 extra_config
                    extra_config_raw = source_data.get("extra_config")
                    if extra_config_raw is not None:
                        extra_config_dict = parse_extra_config_safely(extra_config_raw)
                        
                        if extra_config_dict:
                            extra_config_str = json.dumps(extra_config_dict, ensure_ascii=False)
                            # 如果数据库中的 extra_config 为空或不同，则更新
                            if not existing.extra_config or existing.extra_config != extra_config_str:
                                existing.extra_config = extra_config_str
                                db.commit()
                                logger.info(f"已更新源 '{source_name}' 的 extra_config")
                    skipped_count += 1
                    continue
                
                # 处理 extra_config（如果是字典，序列化为JSON字符串）
                extra_config_raw = source_data.get("extra_config")
                extra_config_dict = parse_extra_config_safely(extra_config_raw)
                
                # 序列化为JSON字符串
                extra_config_str = json.dumps(extra_config_dict, ensure_ascii=False) if extra_config_dict else ""
                
                # 提取sub_type
                source_type = source_data.get("source_type", "rss")
                url = source_data.get("url", "")
                sub_type = source_data.get("sub_type")  # 优先使用直接提供的sub_type
                if not sub_type:
                    sub_type = extract_sub_type_from_config(source_type, extra_config_dict, url)
                
                # 处理 description：优先使用 description，如果没有则使用 note（向后兼容）
                description = source_data.get("description", "")
                if not description:
                    description = source_data.get("note", "")
                
                # 创建新源
                new_source = RSSSource(
                    name=source_data.get("name", ""),
                    url=url,
                    description=description,
                    category=source_data.get("category", "other"),
                    tier=source_data.get("tier", "tier3"),
                    source_type=source_type,
                    sub_type=sub_type,  # 设置sub_type字段
                    language=source_data.get("language", "en"),
                    enabled=source_data.get("enabled", True),
                    priority=source_data.get("priority", 3),
                    note=None,  # 不再使用 note 字段存储描述信息
                    extra_config=extra_config_str,
                    analysis_prompt=source_data.get("analysis_prompt"),  # 自定义AI分析提示词
                )
                db.add(new_source)
                imported_count += 1
            except Exception as e:
                logger.error(f"处理源 '{source_name}' 时出错: {e}", exc_info=True)
                errors.append(f"{source_data.get('name', '未知')}: {str(e)}")
        
        db.commit()
        
        return {
            "message": "导入完成",
            "imported": imported_count,
            "skipped": skipped_count,
            "errors": errors if errors else None,
        }
    except Exception as e:
        logger.error(f"导入失败: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.post("/{source_id}/fix-parse")
async def fix_source_parse(
    source_id: int,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """手动触发AI修复解析配置"""
    source = db.query(RSSSource).filter(RSSSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    
    # 检查源类型是否支持修复
    if source.source_type not in ["web", "rss"]:
        raise HTTPException(
            status_code=400, 
            detail=f"源类型 {source.source_type} 暂不支持AI修复"
        )
    
    try:
        # 创建AI分析器和解析器
        from backend.app.utils import create_ai_analyzer
        from backend.app.services.collector.ai_parser import AIParser
        
        ai_analyzer = create_ai_analyzer()
        if not ai_analyzer:
            raise HTTPException(status_code=400, detail="未配置AI分析器")
        
        ai_parser = AIParser(ai_analyzer)
        
        # 准备源配置
        source_config = {
            "name": source.name,
            "url": source.url,
            "source_type": source.source_type,
            "extra_config": source.extra_config,
        }
        
        # 执行修复（在线程池中执行，避免阻塞）
        result = await asyncio.to_thread(
            ai_parser.analyze_and_fix_config,
            source_config,
            None,  # raw_data
            source.last_error  # error_message
        )
        
        if result["success"]:
            # 更新配置
            from backend.app.db import get_db
            db_manager = get_db()
            success = ai_parser.update_source_config(
                db_manager,
                source_id,
                result["new_config"],
                result["fix_history_entry"]
            )
            
            if success:
                return {
                    "message": "修复成功",
                    "source_id": source_id,
                    "new_config": result["new_config"],
                    "fix_history": result["fix_history_entry"]
                }
            else:
                raise HTTPException(status_code=500, detail="更新配置失败")
        else:
            # 即使修复失败，也记录历史
            from backend.app.db import get_db
            db_manager = get_db()
            ai_parser.update_source_config(
                db_manager,
                source_id,
                source_config.get("extra_config", {}),
                result["fix_history_entry"]
            )
            
            raise HTTPException(
                status_code=500, 
                detail=f"修复失败: {result.get('error', '未知错误')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"修复源配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")


@router.get("/{source_id}/fix-history")
async def get_fix_history(
    source_id: int,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """获取源的修复历史"""
    source = db.query(RSSSource).filter(RSSSource.id == source_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    
    try:
        history = []
        if source.parse_fix_history:
            history = json.loads(source.parse_fix_history)
        
        return {
            "source_id": source_id,
            "source_name": source.name,
            "fix_history": history
        }
    except Exception as e:
        logger.error(f"获取修复历史失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取修复历史失败: {str(e)}")

