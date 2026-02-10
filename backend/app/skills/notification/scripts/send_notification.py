#!/usr/bin/env python3
"""
通知发送脚本
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def send_notification(title: str, content: str, channel: Optional[str] = None) -> bool:
    """
    最小可用通知实现。
    当前默认写日志，后续可接入飞书/钉钉等渠道。
    """
    logger.info("notification channel=%s title=%s content=%s", channel or "log", title, content[:200])
    return True
