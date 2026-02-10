#!/usr/bin/env python3
"""
GitHub 平台模型先知发现脚本。

目标：
1. 监控厂商组织与公开热点仓库的更新信号。
2. 识别可能的新模型发布前迹象。
3. 输出统一字段供后续评估与报告生成。
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

import requests


class GitHubModelDiscovery:
    """GitHub 更新信号发现器。"""

    BASE_URL = "https://api.github.com"

    AI_ML_TOPICS = [
        "machine-learning",
        "deep-learning",
        "artificial-intelligence",
        "neural-network",
        "transformer",
        "llm",
        "large-language-model",
        "diffusion-models",
        "computer-vision",
        "multimodal",
        "huggingface",
    ]

    def __init__(self, token: Optional[str] = None):
        self.token = token or os.getenv("GITHUB_TOKEN")
        headers = {
            "Accept": "application/vnd.github.v3+json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        self.session = requests.Session()
        self.session.headers.update(headers)

    def _check_rate_limit(self, response: requests.Response) -> None:
        remaining = int(response.headers.get("X-RateLimit-Remaining", 0))
        reset_time = int(response.headers.get("X-RateLimit-Reset", 0))
        if remaining < 5:
            wait_time = reset_time - time.time()
            if wait_time > 0:
                time.sleep(wait_time + 1)

    def _make_request(self, url: str, params: Optional[Dict] = None) -> Optional[Dict]:
        retries = 3
        for attempt in range(retries):
            try:
                response = self.session.get(url, params=params, timeout=30)
                self._check_rate_limit(response)
                if response.status_code == 200:
                    return response.json()
                if response.status_code in {403, 429}:
                    time.sleep(2 ** attempt)
                    continue
                if response.status_code == 404:
                    return None
            except Exception:
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
        return None

    def search_repositories(
        self,
        keywords: Sequence[str],
        days_back: int = 7,
        min_stars: int = 100,
        max_results: int = 50,
        watch_organizations: Optional[Sequence[str]] = None,
    ) -> List[Dict]:
        cutoff_dt = datetime.utcnow() - timedelta(days=days_back)
        cutoff_date = cutoff_dt.strftime("%Y-%m-%d")
        watch_set = {item.strip().lower() for item in (watch_organizations or []) if item and item.strip()}

        all_queries: List[str] = []
        global_query = self._build_global_query(keywords=keywords, cutoff_date=cutoff_date, min_stars=min_stars)
        all_queries.append(global_query)

        for org in watch_set:
            org_query = self._build_org_query(org=org, keywords=keywords, cutoff_date=cutoff_date)
            all_queries.append(org_query)

        records: Dict[str, Dict] = {}
        per_query_limit = min(100, max(30, max_results))

        for query in all_queries:
            data = self._make_request(
                f"{self.BASE_URL}/search/repositories",
                params={
                    "q": query,
                    "sort": "updated",
                    "order": "desc",
                    "per_page": per_query_limit,
                },
            )
            if not data or "items" not in data:
                continue

            for repo in data["items"]:
                model = self._parse_repository(
                    repo=repo,
                    cutoff_dt=cutoff_dt,
                    watch_set=watch_set,
                )
                if not model:
                    continue
                if not self._is_model_repo(model):
                    continue
                if not self._keyword_match(model, keywords=keywords, watch_set=watch_set):
                    continue

                if not model.get("watch_hit") and model.get("github_stars", 0) < min_stars:
                    continue

                key = str(model.get("source_uid") or "").lower()
                if not key:
                    continue

                existing = records.get(key)
                if existing is None:
                    records[key] = model
                    continue

                if float(model.get("release_confidence", 0.0)) > float(existing.get("release_confidence", 0.0)):
                    records[key] = model
                elif int(model.get("github_stars", 0)) > int(existing.get("github_stars", 0)):
                    records[key] = model

        result = list(records.values())
        result.sort(
            key=lambda item: (
                float(item.get("release_confidence", 0.0)),
                int(item.get("github_stars", 0)),
            ),
            reverse=True,
        )
        return result[:max_results]

    def _build_global_query(self, keywords: Sequence[str], cutoff_date: str, min_stars: int) -> str:
        keyword_query = " OR ".join([f'"{kw}"' for kw in list(keywords)[:4]])
        topic_query = " OR ".join([f"topic:{topic}" for topic in self.AI_ML_TOPICS[:8]])
        return (
            f"({keyword_query}) OR ({topic_query}) "
            f"pushed:>{cutoff_date} stars:>{max(10, min_stars)} archived:false"
        )

    def _build_org_query(self, org: str, keywords: Sequence[str], cutoff_date: str) -> str:
        keyword_query = " OR ".join([f'"{kw}"' for kw in list(keywords)[:3]])
        return f"org:{org} ({keyword_query}) pushed:>{cutoff_date} archived:false"

    def _parse_repository(self, repo: Dict, cutoff_dt: datetime, watch_set: set[str]) -> Optional[Dict]:
        try:
            created_at = self._parse_datetime(repo.get("created_at"))
            pushed_at = self._parse_datetime(repo.get("pushed_at"))
            updated_at = self._parse_datetime(repo.get("updated_at"))
            latest_update = pushed_at or updated_at or created_at
            if latest_update is None or latest_update < cutoff_dt:
                return None

            owner = str(((repo.get("owner") or {}).get("login") or "Unknown")).strip()
            owner_lower = owner.lower()
            watch_hit = owner_lower in watch_set

            full_name = str(repo.get("full_name") or "").strip()
            name = str(repo.get("name") or "").strip()
            description = str(repo.get("description") or "").strip()
            topics = repo.get("topics") or []

            update_type = self._infer_update_type(created_at=created_at, latest_update=latest_update, repo=repo)
            signal_reasons = self._build_signal_reasons(repo=repo, watch_hit=watch_hit, update_type=update_type)
            release_confidence = self._estimate_release_confidence(
                repo=repo,
                watch_hit=watch_hit,
                update_type=update_type,
            )

            model: Dict = {
                "model_name": name,
                "source_platform": "github",
                "source_uid": full_name.lower(),
                "url": repo.get("html_url"),
                "organization": owner,
                "release_date": (created_at or latest_update).isoformat() if (created_at or latest_update) else None,
                "last_updated": latest_update.isoformat() if latest_update else None,
                "description": description,
                "model_type": self._identify_model_type(name=name, description=description, topics=topics),
                "github_stars": int(repo.get("stargazers_count") or 0),
                "github_forks": int(repo.get("forks_count") or 0),
                "license": ((repo.get("license") or {}).get("spdx_id") or "Unknown"),
                "update_type": update_type,
                "update_summary": self._build_update_summary(update_type=update_type, repo=repo),
                "signal_reasons": signal_reasons,
                "signal_score": round(min(100.0, release_confidence * 0.9), 2),
                "release_confidence": round(release_confidence, 2),
                "watch_hit": watch_hit,
                "discovered_at": datetime.utcnow().isoformat(),
            }

            paper_url = self._extract_paper_url_from_readme(full_name=full_name)
            if paper_url:
                model["paper_url"] = paper_url

            return model
        except Exception:
            return None

    def _extract_paper_url_from_readme(self, full_name: str) -> Optional[str]:
        if not full_name:
            return None

        readme = self._make_request(f"{self.BASE_URL}/repos/{full_name}/readme")
        if not readme or "content" not in readme:
            return None

        try:
            import base64

            content = base64.b64decode(readme["content"]).decode("utf-8", errors="ignore")
        except Exception:
            return None

        arxiv_match = re.search(r"https?://arxiv\.org/(?:abs|pdf)/([0-9]+\.[0-9]+)", content)
        if arxiv_match:
            return f"https://arxiv.org/abs/{arxiv_match.group(1)}"

        generic_match = re.search(r"https?://(?:openreview\.net|aclanthology\.org)/\S+", content)
        return generic_match.group(0) if generic_match else None

    @staticmethod
    def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text).replace(tzinfo=None)
        except ValueError:
            return None

    @staticmethod
    def _infer_update_type(created_at: Optional[datetime], latest_update: Optional[datetime], repo: Dict) -> str:
        if created_at and latest_update:
            if (latest_update - created_at).total_seconds() <= 48 * 3600:
                return "new_model_repo"

        if int(repo.get("stargazers_count") or 0) >= 500 and int(repo.get("forks_count") or 0) >= 50:
            return "new_release_tag"

        return "major_commit"

    @staticmethod
    def _build_update_summary(update_type: str, repo: Dict) -> str:
        owner = ((repo.get("owner") or {}).get("login") or "unknown")
        name = repo.get("name") or "repo"
        if update_type == "new_model_repo":
            return f"{owner}/{name} 在监控窗口内新建，疑似新模型仓库。"
        if update_type == "new_release_tag":
            return f"{owner}/{name} 社区热度快速增长，疑似新版本发布信号。"
        return f"{owner}/{name} 近期持续更新，出现潜在预发布迹象。"

    @staticmethod
    def _build_signal_reasons(repo: Dict, watch_hit: bool, update_type: str) -> List[str]:
        reasons = [f"update_type={update_type}"]
        reasons.append(f"stars={int(repo.get('stargazers_count') or 0)}")
        reasons.append(f"forks={int(repo.get('forks_count') or 0)}")
        pushed_at = repo.get("pushed_at")
        if pushed_at:
            reasons.append(f"pushed_at={pushed_at}")
        if watch_hit:
            reasons.append("watch_organization_hit=true")
        return reasons

    @staticmethod
    def _estimate_release_confidence(repo: Dict, watch_hit: bool, update_type: str) -> float:
        base_map = {
            "new_model_repo": 80.0,
            "new_release_tag": 84.0,
            "major_commit": 66.0,
        }
        score = base_map.get(update_type, 60.0)

        stars = int(repo.get("stargazers_count") or 0)
        forks = int(repo.get("forks_count") or 0)
        if stars >= 5000:
            score += 8
        elif stars >= 1000:
            score += 5
        elif stars >= 200:
            score += 3

        if forks >= 500:
            score += 4
        elif forks >= 100:
            score += 2

        if watch_hit:
            score += 6

        return max(0.0, min(99.0, score))

    @staticmethod
    def _identify_model_type(name: str, description: str, topics: Sequence[str]) -> str:
        text = f"{name} {description} {' '.join(topics)}".lower()
        if any(token in text for token in ["llm", "language model", "gpt", "bert", "transformer"]):
            return "LLM"
        if any(token in text for token in ["vision", "image", "detection", "segmentation", "vit"]):
            return "Vision"
        if any(token in text for token in ["audio", "speech", "tts", "asr"]):
            return "Audio"
        if any(token in text for token in ["multimodal", "vision-language", "vlm", "clip"]):
            return "Multimodal"
        if any(token in text for token in ["diffusion", "gan", "generative"]):
            return "Generative"
        return "Other"

    @staticmethod
    def _keyword_match(model: Dict, keywords: Sequence[str], watch_set: set[str]) -> bool:
        if model.get("watch_hit"):
            return True

        text = f"{model.get('model_name', '')} {model.get('description', '')}".lower()
        for keyword in keywords:
            if str(keyword).lower() in text:
                return True

        org = str(model.get("organization") or "").lower()
        return org in watch_set

    @staticmethod
    def _is_model_repo(model: Dict) -> bool:
        text = f"{model.get('model_name', '')} {model.get('description', '')}".lower()
        excludes = [
            "awesome",
            "tutorial",
            "course",
            "paper-list",
            "resources",
            "benchmark",
            "dataset",
        ]
        if any(token in text for token in excludes):
            keep_tokens = ["model", "checkpoint", "pretrain", "inference", "llm"]
            return any(token in text for token in keep_tokens)
        return True


def discover_github(
    keywords: Optional[List[str]] = None,
    days_back: int = 7,
    min_stars: int = 100,
    max_results: int = 50,
    token: Optional[str] = None,
    watch_organizations: Optional[List[str]] = None,
) -> List[Dict]:
    if keywords is None:
        keywords = ["LLM", "foundation model", "multimodal", "reasoning"]

    discovery = GitHubModelDiscovery(token=token)
    return discovery.search_repositories(
        keywords=keywords,
        days_back=days_back,
        min_stars=min_stars,
        max_results=max_results,
        watch_organizations=watch_organizations,
    )


if __name__ == "__main__":
    import json

    payload = discover_github(
        keywords=["LLM", "reasoning model"],
        days_back=7,
        min_stars=100,
        max_results=20,
        watch_organizations=["openai", "deepseek-ai", "qwen"],
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
