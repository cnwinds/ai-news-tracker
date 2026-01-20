"""
WebSocket 端点 - 实时推送采集进度和状态更新
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.app.db import get_db
from backend.app.db.models import CollectionTask

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        """接受连接"""
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        """断开连接"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """发送个人消息"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"发送消息失败: {e}")
            self.disconnect(websocket)
    
    async def broadcast(self, message: dict):
        """广播消息给所有连接"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"广播消息失败: {e}")
                disconnected.append(connection)
        
        # 移除断开的连接
        for conn in disconnected:
            self.disconnect(conn)


# 全局连接管理器
manager = ConnectionManager()


@router.websocket("")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 端点"""
    await manager.connect(websocket)
    
    try:
        # 发送初始连接成功消息
        await manager.send_personal_message({
            "type": "connected",
            "message": "WebSocket 连接成功",
            "timestamp": datetime.now().isoformat(),
        }, websocket)
        
        # 启动心跳任务
        heartbeat_task = asyncio.create_task(heartbeat_loop(websocket))
        
        # 启动状态监控任务
        status_task = asyncio.create_task(monitor_collection_status(websocket))
        
        # 保持连接
        while True:
            try:
                # 接收客户端消息（用于保持连接）
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                # 可以处理客户端发送的消息
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await manager.send_personal_message({
                            "type": "pong",
                            "timestamp": datetime.now().isoformat(),
                        }, websocket)
                except json.JSONDecodeError:
                    pass
            except asyncio.TimeoutError:
                # 超时，继续循环
                continue
            except WebSocketDisconnect:
                break
                
    except WebSocketDisconnect:
        pass
    finally:
        # 取消任务
        heartbeat_task.cancel()
        status_task.cancel()
        manager.disconnect(websocket)


async def heartbeat_loop(websocket: WebSocket):
    """心跳循环，保持连接活跃"""
    try:
        while True:
            await asyncio.sleep(30)  # 每30秒发送一次心跳
            await manager.send_personal_message({
                "type": "heartbeat",
                "timestamp": datetime.now().isoformat(),
            }, websocket)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"心跳循环错误: {e}")


async def monitor_collection_status(websocket: WebSocket):
    """监控采集状态，实时推送更新"""
    last_task_id = None
    last_status = None
    
    try:
        while True:
            await asyncio.sleep(2)  # 每2秒检查一次
            
            # 查询最新的采集任务
            db = get_db()
            with db.get_session() as session:
                latest_task = session.query(CollectionTask).order_by(
                    CollectionTask.started_at.desc()
                ).first()
                
                if latest_task:
                    # 如果任务状态发生变化，发送更新
                    if (latest_task.id != last_task_id or 
                        latest_task.status != last_status):
                        
                        # 构建状态消息
                        if latest_task.status == "running":
                            message = "🔄 采集进行中..."
                        elif latest_task.status == "completed":
                            message = (
                                f"✅ 采集完成！新增 {latest_task.new_articles_count} 篇文章，"
                                f"耗时 {latest_task.duration or 0:.1f}秒"
                            )
                        elif latest_task.status == "error":
                            message = f"❌ 采集失败: {latest_task.error_message}"
                        else:
                            message = f"状态: {latest_task.status}"
                        
                        await manager.send_personal_message({
                            "type": "collection_status",
                            "task_id": latest_task.id,
                            "status": latest_task.status,
                            "message": message,
                            "stats": {
                                "new_articles": latest_task.new_articles_count,
                                "total_sources": latest_task.total_sources,
                                "success_sources": latest_task.success_sources,
                                "failed_sources": latest_task.failed_sources,
                                "duration": latest_task.duration,
                                "ai_analyzed_count": latest_task.ai_analyzed_count,
                            },
                            "timestamp": datetime.now().isoformat(),
                        }, websocket)
                        
                        last_task_id = latest_task.id
                        last_status = latest_task.status
                        
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"状态监控错误: {e}")


# 全局函数，用于从其他模块广播消息
async def broadcast_collection_update(message: dict):
    """广播采集更新消息"""
    await manager.broadcast({
        "type": "collection_update",
        **message,
        "timestamp": datetime.now().isoformat(),
    })


async def broadcast_new_article(article_data: dict):
    """广播新文章消息"""
    await manager.broadcast({
        "type": "new_article",
        "article": article_data,
        "timestamp": datetime.now().isoformat(),
    })

