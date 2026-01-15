"""
摘要相关 API 端点
"""
import asyncio
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.core.dependencies import get_collection_service, get_database
from backend.app.db.models import DailySummary
from backend.app.core.dependencies import get_database, get_collection_service
from backend.app.api.v1.endpoints.settings import require_auth
from backend.app.schemas.summary import (
    DailySummary as DailySummarySchema,
    DailySummaryListItem,
    SummaryFieldsResponse,
    SummaryGenerateRequest,
)
from backend.app.services.collector import CollectionService
from backend.app.utils import create_ai_analyzer
from backend.app.db import get_db

router = APIRouter()


@router.get("", response_model=List[DailySummaryListItem])
async def get_summaries(
    limit: int = 50,
    db: Session = Depends(get_database),
):
    """获取历史摘要列表（只返回基本字段，节省流量）"""
    summaries = (
        db.query(DailySummary)
        .order_by(DailySummary.summary_date.desc())
        .limit(limit)
        .all()
    )
    return [DailySummaryListItem.model_validate(s) for s in summaries]


@router.get("/{summary_id}", response_model=DailySummarySchema)
async def get_summary(
    summary_id: int,
    db: Session = Depends(get_database),
):
    """获取摘要详情（完整信息）"""
    summary = db.query(DailySummary).filter(DailySummary.id == summary_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="摘要不存在")
    return DailySummarySchema.model_validate(summary)


@router.get("/{summary_id}/fields", response_model=SummaryFieldsResponse)
async def get_summary_fields(
    summary_id: int,
    fields: str = "all",
    db: Session = Depends(get_database),
):
    """
    获取摘要的特定字段（用于按需加载）
    
    Args:
        summary_id: 摘要ID
        fields: 要获取的字段，如：'summary_content' 或 'summary_content,key_topics,recommended_articles'，或 'all' 获取所有详细字段
    """
    summary = db.query(DailySummary).filter(DailySummary.id == summary_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="摘要不存在")
    
    # 解析字段列表
    if fields == "all":
        field_list = ["summary_content", "key_topics", "recommended_articles"]
    else:
        field_list = [f.strip() for f in fields.split(",")]
    
    # 构建响应
    response_data = {}
    if "summary_content" in field_list:
        response_data["summary_content"] = summary.summary_content
    if "key_topics" in field_list:
        response_data["key_topics"] = summary.key_topics
    if "recommended_articles" in field_list:
        response_data["recommended_articles"] = summary.recommended_articles
    
    return SummaryFieldsResponse(**response_data)


@router.delete("/{summary_id}")
async def delete_summary(
    summary_id: int,
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """删除摘要"""
    summary = db.query(DailySummary).filter(DailySummary.id == summary_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="摘要不存在")
    
    db.delete(summary)
    db.commit()
    return {"message": "摘要已删除", "id": summary_id}


@router.post("/generate")
async def generate_summary(
    request: SummaryGenerateRequest,
    collection_service: CollectionService = Depends(get_collection_service),
    db: Session = Depends(get_database),
    current_user: str = Depends(require_auth),
):
    """生成新摘要（支持按天或按周，可指定日期/周）"""
    # 检查AI分析器
    ai_analyzer = create_ai_analyzer()
    if not ai_analyzer:
        raise HTTPException(status_code=400, detail="未配置AI分析器")
    
    try:
        db_manager = get_db()
        summary_generator = collection_service.summary_generator
        
        if not summary_generator:
            raise HTTPException(status_code=400, detail="总结生成器未初始化")
        
        # 解析日期或周
        target_date = None
        if request.summary_type == "daily":
            if request.date:
                # 解析指定日期
                try:
                    target_date = datetime.strptime(request.date, "%Y-%m-%d")
                except ValueError:
                    raise HTTPException(status_code=400, detail="日期格式错误，应为YYYY-MM-DD")
            else:
                # 默认今天
                target_date = datetime.now()
            
            # 生成每日总结（在线程池中执行，避免阻塞）
            summary_obj = await asyncio.to_thread(
                summary_generator.generate_daily_summary,
                db_manager,
                target_date
            )
            
        elif request.summary_type == "weekly":
            if request.week:
                # 解析指定周 (YYYY-WW格式，WW是ISO周数)
                try:
                    year_str, week_num_str = request.week.split("-")
                    year = int(year_str)
                    week_num = int(week_num_str)
                    
                    # 使用isocalendar()方法找到该ISO周的第一天（周一）
                    # 从该年1月1日开始查找，找到ISO周数匹配的日期
                    # 然后计算该周的周一
                    test_date = datetime(year, 1, 1)
                    found = False
                    # 最多检查53周（一年最多53个ISO周）
                    for i in range(53 * 7):
                        test_iso_year, test_iso_week, test_weekday = test_date.isocalendar()
                        if test_iso_year == year and test_iso_week == week_num:
                            # 找到该周的第一天（周一），weekday=1表示周一
                            # isocalendar返回的weekday: Monday=1, Sunday=7
                            days_to_monday = test_weekday - 1
                            target_date = test_date - timedelta(days=days_to_monday)
                            found = True
                            break
                        test_date += timedelta(days=1)
                        # 如果已经超出该年范围，停止查找
                        if test_date.year > year:
                            break
                    
                    if not found:
                        raise HTTPException(status_code=400, detail=f"无法找到指定的ISO周: {year}-{week_num:02d}")
                except (ValueError, IndexError) as e:
                    raise HTTPException(status_code=400, detail=f"周格式错误，应为YYYY-WW: {str(e)}")
            else:
                # 默认本周
                target_date = datetime.now()
            
            # 生成每周总结（在线程池中执行，避免阻塞）
            summary_obj = await asyncio.to_thread(
                summary_generator.generate_weekly_summary,
                db_manager,
                target_date
            )
        else:
            raise HTTPException(status_code=400, detail="不支持的摘要类型")
        
        if not summary_obj:
            raise HTTPException(status_code=404, detail="没有符合条件的文章")
        
        # 从数据库重新获取完整的summary对象（包含id等）
        summary = db.query(DailySummary).filter(DailySummary.id == summary_obj.id).first()
        if not summary:
            raise HTTPException(status_code=404, detail="生成的摘要未找到")
        
        return DailySummarySchema.model_validate(summary)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成摘要失败: {str(e)}")

