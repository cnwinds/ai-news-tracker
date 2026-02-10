#!/usr/bin/env python3
"""
Fetch and normalize web page content for agent research.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Any, Dict, List, Union
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BLOCKED_HOSTNAMES = {"localhost", "0.0.0.0"}
MAX_REDIRECTS = 5
IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _dedupe_links(links: List[Dict[str, str]], max_links: int) -> List[Dict[str, str]]:
    deduped: List[Dict[str, str]] = []
    seen: set[str] = set()
    for link in links:
        url = (link.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(link)
        if len(deduped) >= max_links:
            break
    return deduped


def _is_public_ip(ip_obj: IPAddress) -> bool:
    return not (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    )


def _validate_target_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("仅支持 http/https URL")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("URL 缺少主机名")
    if hostname in BLOCKED_HOSTNAMES or hostname.endswith(".localhost") or hostname.endswith(".local"):
        raise ValueError("禁止访问本地或内网地址")

    ip_literal = None
    try:
        ip_literal = ipaddress.ip_address(hostname)
    except ValueError:
        pass

    if ip_literal is not None:
        if not _is_public_ip(ip_literal):
            raise ValueError("禁止访问本地或内网地址")
        return

    try:
        addr_info = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError(f"无法解析目标主机: {hostname}") from exc

    resolved_ips = {
        info[4][0]
        for info in addr_info
        if info and len(info) > 4 and info[4]
    }
    if not resolved_ips:
        raise ValueError(f"无法解析目标主机: {hostname}")

    for ip_text in resolved_ips:
        try:
            ip_obj = ipaddress.ip_address(ip_text)
        except ValueError:
            continue
        if not _is_public_ip(ip_obj):
            raise ValueError("禁止访问本地或内网地址")


def _safe_get_with_redirects(url: str, timeout_seconds: int) -> requests.Response:
    headers = {
        "User-Agent": "AI-News-Tracker-Agent/1.0",
        "Accept": "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
    }
    current_url = url
    for _ in range(MAX_REDIRECTS + 1):
        _validate_target_host(current_url)
        response = requests.get(
            current_url,
            timeout=timeout_seconds,
            allow_redirects=False,
            headers=headers,
        )
        if response.is_redirect or response.is_permanent_redirect:
            location = (response.headers.get("Location") or "").strip()
            if not location:
                return response
            current_url = urljoin(current_url, location)
            continue
        return response
    raise ValueError(f"重定向次数过多（>{MAX_REDIRECTS}）")


def fetch_web_page(
    url: str,
    timeout_seconds: int = 20,
    max_chars: int = 12000,
    max_links: int = 20,
) -> Dict[str, Any]:
    if not str(url or "").strip():
        raise ValueError("url 不能为空")

    normalized_url = str(url).strip()

    timeout_seconds = _clamp_int(timeout_seconds, minimum=5, maximum=60, default=20)
    max_chars = _clamp_int(max_chars, minimum=500, maximum=50000, default=12000)
    max_links = _clamp_int(max_links, minimum=0, maximum=100, default=20)

    response = _safe_get_with_redirects(normalized_url, timeout_seconds=timeout_seconds)

    content_type = (response.headers.get("Content-Type") or "").lower()
    title = ""
    extracted_text = response.text or ""
    links: List[Dict[str, str]] = []

    if "html" in content_type:
        soup = BeautifulSoup(response.text, "lxml")
        for tag in soup(["script", "style", "noscript"]):
            tag.extract()
        title = (soup.title.string or "").strip() if soup.title else ""
        extracted_text = soup.get_text("\n", strip=True)

        if max_links > 0:
            for node in soup.find_all("a", href=True):
                href = urljoin(response.url, node.get("href", "").strip())
                if not href.startswith(("http://", "https://")):
                    continue
                label = " ".join(node.get_text(" ", strip=True).split())
                links.append(
                    {
                        "text": label[:120],
                        "url": href,
                    }
                )
            links = _dedupe_links(links, max_links=max_links)

    truncated = False
    if len(extracted_text) > max_chars:
        extracted_text = extracted_text[:max_chars]
        truncated = True

    return {
        "url": normalized_url,
        "final_url": str(response.url),
        "status_code": response.status_code,
        "ok": response.ok,
        "content_type": content_type,
        "title": title,
        "text": extracted_text,
        "links": links,
        "truncated": truncated,
        "text_length": len(extracted_text),
    }
