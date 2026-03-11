"""
统一日志管理模块
"""
import logging
import sys
from pathlib import Path
from typing import Optional

from backend.app.core.settings import settings


def _create_file_handler(log_path: Path, log_level: int) -> logging.FileHandler:
    """创建文件处理器
    
    Args:
        log_path: 日志文件路径
        log_level: 日志级别
        
    Returns:
        配置好的文件处理器
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setLevel(log_level)
    file_handler.setFormatter(_get_formatter())
    return file_handler


def _get_formatter() -> logging.Formatter:
    """获取日志格式化器
    
    Returns:
        配置好的日志格式化器
    """
    return logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )


def setup_logger(name: str = "", log_file: Optional[str] = None) -> logging.Logger:
    """设置并返回日志记录器（配置根 logger 以支持所有模块）

    Args:
        name: 日志记录器名称（默认为空，配置根 logger）
        log_file: 日志文件路径（可选）

    Returns:
        配置好的日志记录器
    """
    logger = logging.getLogger(name)
    root_logger = logging.getLogger()

    if root_logger.handlers:
        return logger

    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    root_logger.setLevel(log_level)

    formatter = _get_formatter()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    watchfiles_logger = logging.getLogger("watchfiles")
    watchfiles_logger.setLevel(logging.DEBUG)

    log_path: Optional[Path] = None
    if log_file:
        log_path = Path(log_file)
    elif settings.LOG_FILE:
        log_path = Path(settings.LOG_FILE)

    if log_path:
        root_logger.addHandler(_create_file_handler(log_path, log_level))

    return logger


def get_logger(name: str) -> logging.Logger:
    """获取日志记录器（使用全局配置）

    Args:
        name: 日志记录器名称

    Returns:
        日志记录器
    """
    return logging.getLogger(name)
