"""
配置相关 API 端点
"""
import logging
import shutil
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

from backend.app.core.settings import settings
from backend.app.db import get_db
from backend.app.db.repositories import LLMProviderRepository, ImageProviderRepository
from backend.app.schemas.settings import (
    CollectionSettings, 
    AutoCollectionSettings, 
    SummarySettings,
    LLMSettings,
    CollectorSettings,
    NotificationSettings,
    LLMProvider,
    LLMProviderCreate,
    LLMProviderUpdate,
    ImageSettings,
    ImageProvider,
    ImageProviderCreate,
    ImageProviderUpdate,
)

router = APIRouter()
security = HTTPBearer(auto_error=False)


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[str]:
    """可选的用户认证，如果未提供token则返回None"""
    if not credentials:
        return None
    try:
        from backend.app.api.v1.endpoints.auth import verify_token
        token_data = verify_token(credentials)
        return token_data.username
    except:
        return None


def require_auth(current_user: Optional[str] = Depends(get_current_user_optional)):
    """要求用户已登录"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="需要登录才能修改设置",
        )
    return current_user


@router.get("/collection", response_model=CollectionSettings)
async def get_collection_settings():
    """获取采集配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return CollectionSettings(
        max_article_age_days=settings.MAX_ARTICLE_AGE_DAYS,
        max_analysis_age_days=settings.MAX_ANALYSIS_AGE_DAYS,
    )


@router.put("/collection", response_model=CollectionSettings)
async def update_collection_settings(
    new_settings: CollectionSettings,
    current_user: str = Depends(require_auth),
):
    """更新采集配置"""
    success = settings.save_collection_settings(
        max_article_age_days=new_settings.max_article_age_days,
        max_analysis_age_days=new_settings.max_analysis_age_days,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="保存配置失败")
    
    return CollectionSettings(
        max_article_age_days=settings.MAX_ARTICLE_AGE_DAYS,
        max_analysis_age_days=settings.MAX_ANALYSIS_AGE_DAYS,
    )


@router.get("/auto-collection", response_model=AutoCollectionSettings)
async def get_auto_collection_settings():
    """获取自动采集配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return AutoCollectionSettings(
        enabled=settings.AUTO_COLLECTION_ENABLED,
        interval_hours=settings.COLLECTION_INTERVAL_HOURS,
        max_articles_per_source=settings.MAX_ARTICLES_PER_SOURCE,
        request_timeout=settings.REQUEST_TIMEOUT,
    )


@router.put("/auto-collection", response_model=AutoCollectionSettings)
async def update_auto_collection_settings(
    new_settings: AutoCollectionSettings,
    current_user: str = Depends(require_auth),
):
    """更新自动采集配置"""
    success = settings.save_auto_collection_settings(
        enabled=new_settings.enabled,
        interval_hours=new_settings.interval_hours,
        max_articles_per_source=new_settings.max_articles_per_source,
        request_timeout=new_settings.request_timeout,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="保存自动采集配置失败")
    
    # 更新调度器任务
    try:
        from backend.app.main import scheduler
        import logging
        logger = logging.getLogger(__name__)
        
        # 如果调度器未启动，但启用了自动采集，则启动调度器
        if new_settings.enabled and not scheduler:
            try:
                from backend.app.services.scheduler import create_scheduler
                from backend.app.main import app
                # 注意：这里不能直接修改全局变量，需要通过其他方式
                # 暂时记录日志，提示用户重启应用
                logger.warning("⚠️  调度器未启动，请重启应用以使自动采集生效")
                logger.info("   提示: 调度器将在应用重启后自动启动（如果启用了自动采集）")
            except Exception as e:
                logger.error(f"❌ 尝试启动调度器失败: {e}")
        
        # 如果调度器正在运行，更新采集任务
        if scheduler:
            # 如果启用了自动采集，更新或添加任务
            if new_settings.enabled:
                interval_hours = settings.get_auto_collection_interval_hours()
                if interval_hours:
                    logger.info(f"🔄 更新自动采集任务: 每 {interval_hours} 小时执行一次")
                    scheduler.add_collection_job(interval_hours)
                    
                    # 显示下次执行时间
                    job = scheduler.scheduler.get_job("collection_job")
                    if job and job.next_run_time:
                        logger.info(f"⏰ 下次执行时间: {job.next_run_time.strftime('%Y-%m-%d %H:%M:%S')}")
            else:
                # 如果禁用了，移除任务
                try:
                    scheduler.scheduler.remove_job("collection_job")
                    logger.info("✅ 已移除自动采集任务")
                except Exception as e:
                    logger.debug(f"移除任务失败（可能任务不存在）: {e}")
    except Exception as e:
        # 如果调度器未运行或更新失败，记录日志但不影响配置保存
        import logging
        logging.getLogger(__name__).warning(f"更新调度器任务失败: {e}")
    
    return AutoCollectionSettings(
        enabled=settings.AUTO_COLLECTION_ENABLED,
        interval_hours=settings.COLLECTION_INTERVAL_HOURS,
        max_articles_per_source=settings.MAX_ARTICLES_PER_SOURCE,
        request_timeout=settings.REQUEST_TIMEOUT,
    )


@router.get("/summary", response_model=SummarySettings)
async def get_summary_settings():
    """获取总结配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return SummarySettings(
        daily_summary_enabled=settings.DAILY_SUMMARY_ENABLED,
        daily_summary_time=settings.DAILY_SUMMARY_TIME,
        weekly_summary_enabled=settings.WEEKLY_SUMMARY_ENABLED,
        weekly_summary_time=settings.WEEKLY_SUMMARY_TIME,
    )


@router.put("/summary", response_model=SummarySettings)
async def update_summary_settings(
    new_settings: SummarySettings,
    current_user: str = Depends(require_auth),
):
    """更新总结配置"""
    success = settings.save_summary_settings(
        daily_enabled=new_settings.daily_summary_enabled,
        daily_time=new_settings.daily_summary_time,
        weekly_enabled=new_settings.weekly_summary_enabled,
        weekly_time=new_settings.weekly_summary_time,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="保存总结配置失败")
    
    # 如果调度器正在运行，更新总结任务
    try:
        from backend.app.main import scheduler
        if scheduler:
            # 更新每日总结任务
            if new_settings.daily_summary_enabled:
                cron_expr = settings.get_daily_summary_cron()
                if cron_expr:
                    scheduler.add_daily_summary_job(cron_expr)
            else:
                try:
                    scheduler.scheduler.remove_job("daily_summary_job")
                except:
                    pass
            
            # 更新每周总结任务
            if new_settings.weekly_summary_enabled:
                cron_expr = settings.get_weekly_summary_cron()
                if cron_expr:
                    scheduler.add_weekly_summary_job(cron_expr)
            else:
                try:
                    scheduler.scheduler.remove_job("weekly_summary_job")
                except:
                    pass
    except Exception as e:
        # 如果调度器未运行或更新失败，记录日志但不影响配置保存
        import logging
        logging.getLogger(__name__).warning(f"更新调度器任务失败: {e}")
    
    return SummarySettings(
        daily_summary_enabled=settings.DAILY_SUMMARY_ENABLED,
        daily_summary_time=settings.DAILY_SUMMARY_TIME,
        weekly_summary_enabled=settings.WEEKLY_SUMMARY_ENABLED,
        weekly_summary_time=settings.WEEKLY_SUMMARY_TIME,
    )


@router.get("/llm", response_model=LLMSettings)
async def get_llm_settings():
    """获取LLM配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return LLMSettings(
        selected_llm_provider_id=settings.SELECTED_LLM_PROVIDER_ID,
        selected_embedding_provider_id=settings.SELECTED_EMBEDDING_PROVIDER_ID,
        selected_llm_models=settings.SELECTED_LLM_MODELS,
        selected_embedding_models=settings.SELECTED_EMBEDDING_MODELS,
    )


@router.put("/llm", response_model=LLMSettings)
async def update_llm_settings(
    new_settings: LLMSettings,
    current_user: str = Depends(require_auth),
):
    """更新LLM配置"""
    success = settings.save_llm_settings(
        selected_llm_provider_id=new_settings.selected_llm_provider_id,
        selected_embedding_provider_id=new_settings.selected_embedding_provider_id,
        selected_llm_models=new_settings.selected_llm_models,
        selected_embedding_models=new_settings.selected_embedding_models,
    )
    if not success:
        raise HTTPException(status_code=500, detail="保存LLM配置失败")
    
    # 重新加载配置
    settings.load_settings_from_db()
    return LLMSettings(
        selected_llm_provider_id=settings.SELECTED_LLM_PROVIDER_ID,
        selected_embedding_provider_id=settings.SELECTED_EMBEDDING_PROVIDER_ID,
        selected_llm_models=settings.SELECTED_LLM_MODELS,
        selected_embedding_models=settings.SELECTED_EMBEDDING_MODELS,
    )


@router.get("/providers", response_model=list[LLMProvider])
async def get_providers(
    enabled_only: bool = False,
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """获取所有提供商列表"""
    db = get_db()
    with db.get_session() as session:
        providers = LLMProviderRepository.get_all(session, enabled_only=enabled_only)
        # 如果未登录，不返回API密钥
        return [LLMProvider(
            id=p.id,
            name=p.name,
            provider_type=p.provider_type,
            api_key=p.api_key if current_user else "",
            api_base=p.api_base,
            llm_model=p.llm_model,
            embedding_model=p.embedding_model,
            enabled=p.enabled
        ) for p in providers]


@router.post("/providers", response_model=LLMProvider)
async def create_provider(
    provider_data: LLMProviderCreate,
    current_user: str = Depends(require_auth),
):
    """创建新提供商"""
    db = get_db()
    with db.get_session() as session:
        try:
            provider = LLMProviderRepository.create(
                session=session,
                name=provider_data.name,
                api_key=provider_data.api_key,
                api_base=provider_data.api_base,
                llm_model=provider_data.llm_model,
                embedding_model=provider_data.embedding_model,
                enabled=provider_data.enabled,
                provider_type=provider_data.provider_type
            )
            return LLMProvider(
                id=provider.id,
                name=provider.name,
                provider_type=provider.provider_type,
                api_key=provider.api_key,
                api_base=provider.api_base,
                llm_model=provider.llm_model,
                embedding_model=provider.embedding_model,
                enabled=provider.enabled
            )
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=400, detail=f"创建提供商失败: {str(e)}")


@router.get("/providers/{provider_id}", response_model=LLMProvider)
async def get_provider(
    provider_id: int,
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """获取指定提供商"""
    db = get_db()
    with db.get_session() as session:
        provider = LLMProviderRepository.get_by_id(session, provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="提供商不存在")
        # 如果未登录，不返回API密钥
        return LLMProvider(
            id=provider.id,
            name=provider.name,
            provider_type=provider.provider_type,
            api_key=provider.api_key if current_user else "",
            api_base=provider.api_base,
            llm_model=provider.llm_model,
            embedding_model=provider.embedding_model,
            enabled=provider.enabled
        )


@router.put("/providers/{provider_id}", response_model=LLMProvider)
async def update_provider(
    provider_id: int,
    provider_data: LLMProviderUpdate,
    current_user: str = Depends(require_auth),
):
    """更新提供商"""
    db = get_db()
    with db.get_session() as session:
        provider = LLMProviderRepository.update(
            session=session,
            provider_id=provider_id,
            name=provider_data.name,
            api_key=provider_data.api_key,
            api_base=provider_data.api_base,
            llm_model=provider_data.llm_model,
            embedding_model=provider_data.embedding_model,
            enabled=provider_data.enabled,
            provider_type=provider_data.provider_type
        )
        if not provider:
            raise HTTPException(status_code=404, detail="提供商不存在")
        return LLMProvider(
            id=provider.id,
            name=provider.name,
            provider_type=provider.provider_type,
            api_key=provider.api_key,
            api_base=provider.api_base,
            llm_model=provider.llm_model,
            embedding_model=provider.embedding_model,
            enabled=provider.enabled
        )


@router.delete("/providers/{provider_id}")
async def delete_provider(
    provider_id: int,
    current_user: str = Depends(require_auth),
):
    """删除提供商"""
    db = get_db()
    with db.get_session() as session:
        # 检查是否正在使用此提供商
        settings.load_settings_from_db()
        if settings.SELECTED_LLM_PROVIDER_ID == provider_id:
            raise HTTPException(
                status_code=400, 
                detail="无法删除正在使用的LLM提供商，请先选择其他提供商"
            )
        if settings.SELECTED_EMBEDDING_PROVIDER_ID == provider_id:
            raise HTTPException(
                status_code=400,
                detail="无法删除正在使用的向量模型提供商，请先选择其他提供商"
            )
        
        success = LLMProviderRepository.delete(session, provider_id)
        if not success:
            raise HTTPException(status_code=404, detail="提供商不存在")
        return {"message": "提供商已删除"}


@router.get("/collector", response_model=CollectorSettings)
async def get_collector_settings():
    """获取采集器配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return CollectorSettings(
        collection_interval_hours=settings.COLLECTION_INTERVAL_HOURS,
        max_articles_per_source=settings.MAX_ARTICLES_PER_SOURCE,
        request_timeout=settings.REQUEST_TIMEOUT,
    )


@router.put("/collector", response_model=CollectorSettings)
async def update_collector_settings(
    new_settings: CollectorSettings,
    current_user: str = Depends(require_auth),
):
    """更新采集器配置"""
    success = settings.save_collector_settings(
        collection_interval_hours=new_settings.collection_interval_hours,
        max_articles_per_source=new_settings.max_articles_per_source,
        request_timeout=new_settings.request_timeout,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="保存采集器配置失败")
    
    return CollectorSettings(
        collection_interval_hours=settings.COLLECTION_INTERVAL_HOURS,
        max_articles_per_source=settings.MAX_ARTICLES_PER_SOURCE,
        request_timeout=settings.REQUEST_TIMEOUT,
    )


@router.get("/notification", response_model=NotificationSettings)
async def get_notification_settings(
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """获取通知配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    # 如果未登录，不返回加密密钥
    secret = settings.NOTIFICATION_SECRET if current_user else ""
    # 转换勿扰时段格式
    from backend.app.schemas.settings import QuietHours
    quiet_hours = [
        QuietHours(start_time=qh["start_time"], end_time=qh["end_time"])
        for qh in settings.QUIET_HOURS
    ] if settings.QUIET_HOURS else []
    
    return NotificationSettings(
        platform=settings.NOTIFICATION_PLATFORM,
        webhook_url=settings.NOTIFICATION_WEBHOOK_URL,
        secret=secret,
        instant_notification_enabled=settings.INSTANT_NOTIFICATION_ENABLED,
        quiet_hours=quiet_hours,
    )


@router.put("/notification", response_model=NotificationSettings)
async def update_notification_settings(
    new_settings: NotificationSettings,
    current_user: str = Depends(require_auth),
):
    """更新通知配置"""
    # 转换勿扰时段格式
    quiet_hours_list = [
        {"start_time": qh.start_time, "end_time": qh.end_time}
        for qh in (new_settings.quiet_hours or [])
    ]
    
    success = settings.save_notification_settings(
        platform=new_settings.platform,
        webhook_url=new_settings.webhook_url,
        secret=new_settings.secret,
        instant_notification_enabled=new_settings.instant_notification_enabled,
        quiet_hours=quiet_hours_list,
    )
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="保存通知配置失败")
    
    # 转换勿扰时段格式用于返回
    from backend.app.schemas.settings import QuietHours
    quiet_hours = [
        QuietHours(start_time=qh["start_time"], end_time=qh["end_time"])
        for qh in settings.QUIET_HOURS
    ] if settings.QUIET_HOURS else []
    
    return NotificationSettings(
        platform=settings.NOTIFICATION_PLATFORM,
        webhook_url=settings.NOTIFICATION_WEBHOOK_URL,
        secret=settings.NOTIFICATION_SECRET,
        instant_notification_enabled=settings.INSTANT_NOTIFICATION_ENABLED,
        quiet_hours=quiet_hours,
    )


@router.get("/image", response_model=ImageSettings)
async def get_image_settings():
    """获取图片生成配置"""
    # 确保从数据库加载最新配置
    settings.load_settings_from_db()
    return ImageSettings(
        selected_image_provider_id=settings.SELECTED_IMAGE_PROVIDER_ID,
        selected_image_models=settings.SELECTED_IMAGE_MODELS,
    )


@router.put("/image", response_model=ImageSettings)
async def update_image_settings(
    new_settings: ImageSettings,
    current_user: str = Depends(require_auth),
):
    """更新图片生成配置"""
    success = settings.save_image_settings(
        selected_image_provider_id=new_settings.selected_image_provider_id,
        selected_image_models=new_settings.selected_image_models,
    )
    if not success:
        raise HTTPException(status_code=500, detail="保存图片生成配置失败")
    
    # 重新加载配置
    settings.load_settings_from_db()
    return ImageSettings(
        selected_image_provider_id=settings.SELECTED_IMAGE_PROVIDER_ID,
        selected_image_models=settings.SELECTED_IMAGE_MODELS,
    )


@router.get("/image-providers", response_model=list[ImageProvider])
async def get_image_providers(
    enabled_only: bool = False,
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """获取所有图片生成提供商列表"""
    db = get_db()
    with db.get_session() as session:
        providers = ImageProviderRepository.get_all(session, enabled_only=enabled_only)
        # 如果未登录，不返回API密钥
        return [ImageProvider(
            id=p.id,
            name=p.name,
            provider_type=p.provider_type,
            api_key=p.api_key if current_user else "",
            api_base=p.api_base,
            image_model=p.image_model,
            enabled=p.enabled
        ) for p in providers]


@router.post("/image-providers", response_model=ImageProvider)
async def create_image_provider(
    provider_data: ImageProviderCreate,
    current_user: str = Depends(require_auth),
):
    """创建新图片生成提供商"""
    db = get_db()
    with db.get_session() as session:
        try:
            provider = ImageProviderRepository.create(
                session=session,
                name=provider_data.name,
                api_key=provider_data.api_key,
                api_base=provider_data.api_base,
                image_model=provider_data.image_model,
                enabled=provider_data.enabled,
                provider_type=provider_data.provider_type
            )
            return ImageProvider(
                id=provider.id,
                name=provider.name,
                provider_type=provider.provider_type,
                api_key=provider.api_key,
                api_base=provider.api_base,
                image_model=provider.image_model,
                enabled=provider.enabled
            )
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=400, detail=f"创建图片生成提供商失败: {str(e)}")


@router.get("/image-providers/{provider_id}", response_model=ImageProvider)
async def get_image_provider(
    provider_id: int,
    current_user: Optional[str] = Depends(get_current_user_optional),
):
    """获取指定图片生成提供商"""
    db = get_db()
    with db.get_session() as session:
        provider = ImageProviderRepository.get_by_id(session, provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="图片生成提供商不存在")
        # 如果未登录，不返回API密钥
        return ImageProvider(
            id=provider.id,
            name=provider.name,
            provider_type=provider.provider_type,
            api_key=provider.api_key if current_user else "",
            api_base=provider.api_base,
            image_model=provider.image_model,
            enabled=provider.enabled
        )


@router.put("/image-providers/{provider_id}", response_model=ImageProvider)
async def update_image_provider(
    provider_id: int,
    provider_data: ImageProviderUpdate,
    current_user: str = Depends(require_auth),
):
    """更新图片生成提供商"""
    db = get_db()
    with db.get_session() as session:
        provider = ImageProviderRepository.update(
            session=session,
            provider_id=provider_id,
            name=provider_data.name,
            api_key=provider_data.api_key,
            api_base=provider_data.api_base,
            image_model=provider_data.image_model,
            enabled=provider_data.enabled,
            provider_type=provider_data.provider_type
        )
        if not provider:
            raise HTTPException(status_code=404, detail="图片生成提供商不存在")
        return ImageProvider(
            id=provider.id,
            name=provider.name,
            provider_type=provider.provider_type,
            api_key=provider.api_key,
            api_base=provider.api_base,
            image_model=provider.image_model,
            enabled=provider.enabled
        )


@router.delete("/image-providers/{provider_id}")
async def delete_image_provider(
    provider_id: int,
    current_user: str = Depends(require_auth),
):
    """删除图片生成提供商"""
    db = get_db()
    with db.get_session() as session:
        # 检查是否正在使用此提供商
        settings.load_settings_from_db()
        if settings.SELECTED_IMAGE_PROVIDER_ID == provider_id:
            raise HTTPException(
                status_code=400, 
                detail="无法删除正在使用的图片生成提供商，请先选择其他提供商"
            )
        
        success = ImageProviderRepository.delete(session, provider_id)
        if not success:
            raise HTTPException(status_code=404, detail="图片生成提供商不存在")
        return {"message": "图片生成提供商已删除"}


@router.get("/database/backup")
async def backup_database(
    current_user: str = Depends(require_auth),
):
    """备份数据库（下载数据库文件）"""
    try:
        from backend.app.core.paths import APP_ROOT
        
        # 获取数据库文件路径
        db_path = APP_ROOT / "data" / "ai_news.db"
        
        if not db_path.exists():
            raise HTTPException(
                status_code=404,
                detail="数据库文件不存在"
            )
        
        # 创建备份文件名（带时间戳）
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"ai_news_backup_{timestamp}.db"
        
        # 创建临时备份文件
        backup_dir = APP_ROOT / "data" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / backup_filename
        
        # 复制数据库文件
        shutil.copy2(db_path, backup_path)
        
        # 返回文件
        return FileResponse(
            path=str(backup_path),
            filename=backup_filename,
            media_type="application/x-sqlite3",
            headers={
                "Content-Disposition": f"attachment; filename={backup_filename}"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"备份数据库失败: {str(e)}"
        )


@router.post("/database/restore")
async def restore_database(
    file: UploadFile = File(...),
    current_user: str = Depends(require_auth),
):
    """还原数据库（上传数据库文件）"""
    try:
        from backend.app.core.paths import APP_ROOT
        
        # 验证文件类型
        if not file.filename or not file.filename.endswith('.db'):
            raise HTTPException(
                status_code=400,
                detail="只能上传 .db 格式的数据库文件"
            )
        
        # 获取数据库文件路径
        db_path = APP_ROOT / "data" / "ai_news.db"
        backup_dir = APP_ROOT / "data" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        auto_backup_path = None
        
        # 创建当前数据库的备份（以防万一）
        if db_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            auto_backup_path = backup_dir / f"auto_backup_before_restore_{timestamp}.db"
            shutil.copy2(db_path, auto_backup_path)
        
        # 保存上传的文件
        temp_restore_path = backup_dir / f"temp_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        
        with open(temp_restore_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        # 验证文件是否为有效的SQLite数据库
        try:
            import sqlite3
            conn = sqlite3.connect(str(temp_restore_path))
            # 尝试执行一个简单查询
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.close()
            conn.close()
        except Exception as e:
            # 删除无效文件
            if temp_restore_path.exists():
                temp_restore_path.unlink()
            raise HTTPException(
                status_code=400,
                detail=f"上传的文件不是有效的SQLite数据库: {str(e)}"
            )
        
        # 关闭所有数据库连接（重要！）
        from backend.app.db import get_db
        db = get_db()
        if hasattr(db, 'engine'):
            # 关闭所有连接
            db.engine.dispose()
        
        # 替换数据库文件
        if db_path.exists():
            db_path.unlink()
        shutil.move(str(temp_restore_path), str(db_path))
        
        # 重新创建引擎和会话工厂
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        
        connect_args = {"check_same_thread": False}
        new_engine = create_engine(
            f"sqlite:///{db_path.absolute()}",
            connect_args=connect_args,
            echo=False,
        )
        
        # 重新设置数据库管理器的引擎和会话工厂
        db.engine = new_engine
        db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=new_engine)
        
        # 重新初始化sqlite-vec扩展（需要重新设置事件监听器）
        if hasattr(db, '_setup_sqlite_vec_loader'):
            db._setup_sqlite_vec_loader()
        
        # 重新初始化数据库表结构（确保表存在）
        try:
            from backend.app.db.models import Base
            Base.metadata.create_all(bind=new_engine)
        except Exception as e:
            logger.warning(f"重新初始化数据库表时出错（可能不需要）: {e}")
        
        return {
            "message": "数据库还原成功，请刷新页面以使用新的数据库",
            "filename": file.filename,
            "auto_backup": str(auto_backup_path) if auto_backup_path and auto_backup_path.exists() else None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"还原数据库失败: {str(e)}"
        )

