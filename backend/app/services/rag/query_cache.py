"""Query embedding TTL cache (process-level)."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import List, Optional, Tuple


class QueryEmbeddingCache:
    """Short-TTL LRU for query vectors. Same model + text reuses the embedding."""

    def __init__(self, maxsize: int = 256, ttl_seconds: float = 600.0):
        self.maxsize = maxsize
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._store: OrderedDict[Tuple[str, str], Tuple[float, List[float]]] = OrderedDict()

    def _normalize(self, model: str, text: str) -> Tuple[str, str]:
        return ((model or "").strip(), (text or "").strip())

    def get(self, model: str, text: str) -> Optional[List[float]]:
        key = self._normalize(model, text)
        if not key[1]:
            return None
        now = time.monotonic()
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires_at, embedding = item
            if expires_at <= now:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return list(embedding)

    def set(self, model: str, text: str, embedding: List[float]) -> None:
        key = self._normalize(model, text)
        if not key[1] or not embedding:
            return
        expires_at = time.monotonic() + self.ttl_seconds
        with self._lock:
            self._store[key] = (expires_at, list(embedding))
            self._store.move_to_end(key)
            while len(self._store) > self.maxsize:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


query_embedding_cache = QueryEmbeddingCache()
