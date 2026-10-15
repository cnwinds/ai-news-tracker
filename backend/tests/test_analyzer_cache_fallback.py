"""分析器缓存必须带上备用 LLM，调度器初始化不能被热重载吞掉。"""
import unittest
from types import SimpleNamespace
from unittest.mock import patch


class _FakeAnalyzer:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.model = kwargs.get("model")
        self.fallback = None

    def configure_fallback(self, **kwargs):
        self.fallback = kwargs


class AnalyzerCacheFallbackTests(unittest.TestCase):
    def setUp(self):
        from backend.app.utils import factories

        self.factories = factories
        factories.invalidate_ai_analyzer_cache()

    def tearDown(self):
        self.factories.invalidate_ai_analyzer_cache()

    def _patches(self, fallback_calls):
        llm = {
            "id": 1,
            "selected_model": "primary",
            "api_base": "https://llm.example",
            "api_key": "llm-secret-123456",
        }
        emb = {
            "id": 1,
            "selected_model": "embed",
            "api_base": "https://llm.example",
            "api_key": "emb-secret-123456",
        }
        settings = self.factories.settings
        return (
            patch.object(self.factories, "AIAnalyzer", _FakeAnalyzer),
            patch.object(settings, "load_settings_from_db"),
            patch.object(settings, "get_llm_provider_config", return_value=llm),
            patch.object(settings, "get_embedding_provider_config", return_value=emb),
            patch.object(
                settings,
                "get_fallback_llm_provider_config",
                side_effect=fallback_calls,
            ),
            patch.object(settings, "SELECTED_FALLBACK_LLM_PROVIDER_ID", 2),
            patch.object(settings, "SELECTED_FALLBACK_LLM_MODELS", ["backup"]),
        )

    def test_reuses_client_and_applies_fallback_once(self):
        fallback = {
            "id": 2,
            "api_key": "fb-secret-abcdef",
            "api_base": "https://fb.example",
            "selected_model": "backup",
        }
        calls = []

        def get_fallback():
            calls.append("fallback")
            return fallback

        contexts = self._patches(get_fallback)
        with contexts[0], contexts[1], contexts[2], contexts[3], contexts[4], contexts[5], contexts[6]:
            first = self.factories.create_ai_analyzer()
            second = self.factories.create_ai_analyzer()

        self.assertIs(first, second)
        self.assertEqual(first.fallback["fallback_model"], "backup")
        self.assertEqual(first.fallback["fallback_base_url"], "https://fb.example")
        self.assertEqual(calls, ["fallback"])

    def test_fallback_change_and_force_new_rebuild(self):
        configs = [
            {
                "id": 2,
                "api_key": "fb-secret-abcdef",
                "api_base": "https://fb.example",
                "selected_model": "backup",
            },
            {
                "id": 3,
                "api_key": "fb2-secret-zzzzzz",
                "api_base": "https://fb2.example",
                "selected_model": "other",
            },
        ]

        def get_fallback():
            return configs[0] if self.factories.settings.SELECTED_FALLBACK_LLM_PROVIDER_ID == 2 else configs[1]

        contexts = self._patches(get_fallback)
        with contexts[0], contexts[1], contexts[2], contexts[3], contexts[4], contexts[5], contexts[6]:
            first = self.factories.create_ai_analyzer()
            self.factories.settings.SELECTED_FALLBACK_LLM_PROVIDER_ID = 3
            self.factories.settings.SELECTED_FALLBACK_LLM_MODELS = ["other"]
            changed = self.factories.create_ai_analyzer()
            forced = self.factories.create_ai_analyzer(force_new=True)
            load_calls = self.factories.settings.load_settings_from_db.call_args_list

        self.assertIsNot(changed, first)
        self.assertEqual(changed.fallback["fallback_model"], "other")
        self.assertIsNot(forced, changed)
        self.assertTrue(any(call.kwargs.get("force_reload") is True for call in load_calls))


class SchedulerInitTests(unittest.TestCase):
    def test_init_binds_db_and_reload_forces_new_analyzer(self):
        import backend.app.services.scheduler.scheduler as sched

        db = object()
        calls = []

        def fake_create(*args, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(model="primary")

        with patch.object(sched, "create_ai_analyzer", side_effect=fake_create), \
             patch.object(sched, "CollectionService", return_value=object()), \
             patch.object(sched, "get_db", return_value=db), \
             patch.object(sched.settings, "load_settings_from_db"), \
             patch.object(sched.settings, "NOTIFICATION_WEBHOOK_URL", ""):
            scheduler = sched.TaskScheduler()
            self.assertIs(scheduler.db, db)
            self.assertIsNone(scheduler.notifier)
            self.assertEqual(calls, [{}])

            scheduler.reload_ai_analyzer()
            self.assertEqual(calls[-1], {"force_new": True})
            self.assertIs(scheduler.db, db)

            with patch(
                "backend.app.services.collector.summary_generator.SummaryGenerator"
            ) as summary_cls:
                summary_cls.return_value.generate_daily_summary.return_value = None
                scheduler._run_daily_summary()
            self.assertEqual(calls[-1], {"force_new": True})
