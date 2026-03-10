"""
临时验证脚本：确认 _responses_create 传给 client.responses.create 的参数不含 max_tokens。
运行: 在项目根目录执行 python backend/app/test_responses_create_params.py
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

# 项目根目录
_root = Path(__file__).resolve().parent.parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from backend.app.services.analyzer.ai_analyzer import _responses_create

def main():
    captured_kwargs = {}

    def fake_create(**kwargs):
        captured_kwargs.clear()
        captured_kwargs.update(kwargs)
        raise RuntimeError("stop_here")  # 仅验证参数，不真正请求

    client = MagicMock()
    client.responses.create = fake_create

    try:
        _responses_create(
            client,
            "test-model",
            [{"role": "user", "content": "Hi"}],
            temperature=0,
            max_tokens=5,
        )
    except RuntimeError as e:
        if str(e) != "stop_here":
            raise

    assert "max_tokens" not in captured_kwargs, (
        f"responses.create 不应收到 max_tokens，实际 keys: {list(captured_kwargs.keys())}"
    )
    assert "max_output_tokens" in captured_kwargs, (
        f"responses.create 应收到 max_output_tokens，实际 keys: {list(captured_kwargs.keys())}"
    )
    assert captured_kwargs["max_output_tokens"] == 5

    print("OK: _responses_create 传入的 params 不含 max_tokens，含 max_output_tokens=5")
    return 0

if __name__ == "__main__":
    sys.exit(main())
