"""
统一日志管理模块
"""
import logging
import sys
from pathlib import Path
from typing import Optional
from backend.app.core.paths import setup_python_path

# 确保项目根目录在 Python 路径中
setup_python_path()

from backend.app.core.settings import settings


def setup_logger(name: str = "", log_file: Optional[str] = None) -> logging.Logger:
    """
    设置并返回日志记录器（配置根 logger 以支持所有模块）

    Args:
        name: 日志记录器名称（默认为空，配置根 logger）
        log_file: 日志文件路径（可选）

    Returns:
        配置好的日志记录器
    """
    logger = logging.getLogger(name)

    # 配置根 logger，让所有子 logger 都能继承配置
    root_logger = logging.getLogger()

    # 如果根 logger 已经配置过，直接返回
    if root_logger.handlers:
        return logger

    # 设置日志级别
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    root_logger.setLevel(log_level)

    # 日志格式
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # 文件处理器（如果指定了日志文件）
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    elif settings.LOG_FILE:
        # 使用配置的日志文件
        log_path = Path(settings.LOG_FILE)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

    return logger


def get_logger(name: str) -> logging.Logger:
    """
    获取日志记录器（使用全局配置）

    Args:
        name: 日志记录器名称

    Returns:
        日志记录器
    """
    return logging.getLogger(name)
