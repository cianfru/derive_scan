from types import SimpleNamespace

import record_once
from derive.config import Settings
from derive.filestore import FileStore
from derive import question_job


def test_failed_questions_retries_successful_chains_in_the_same_slot(tmp_path):
    settings = Settings(data_dir=tmp_path, sources=["v2_mainnet"], underlyings=["BTC", "ETH"])
    store = FileStore(tmp_path)
    status = {"v2_mainnet:BTC": {"ok": True, "ts": 900}, "v2_mainnet:ETH": {"ok": True, "ts": 900},
              "questions:v2_mainnet": {"ok": False, "ts": 900}}
    store.record_runs(900, status)
    assert record_once.due_keys(settings, store, 900) == {"v2_mainnet:BTC", "v2_mainnet:ETH"}
    store.record_runs(900, {"questions:v2_mainnet": {"ok": True, "ts": 900}})
    assert record_once.due_keys(settings, store, 900) == set()


async def test_questions_failure_is_recorded_without_discarding_snapshots(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path, sources=["v2_mainnet"])
    rec = SimpleNamespace(chains={"v2_mainnet:BTC": {}}, specs={}, status={"v2_mainnet:BTC": {"ok": True}})
    def fail(*args, **kwargs):
        raise ValueError("bad board")
    monkeypatch.setattr(question_job, "run", fail)
    await record_once.questions(settings, rec, 900, None)
    assert rec.status["v2_mainnet:BTC"]["ok"] is True
    assert rec.status["questions:v2_mainnet"] == {"ok": False, "ts": 900, "error": "bad board"}


def test_only_a_run_that_recorded_nothing_fails_the_command(tmp_path, monkeypatch):
    monkeypatch.setenv("DERIVE_UNDERLYINGS", "BTC,ETH")
    monkeypatch.setattr("sys.argv", ["record_once.py", "--out", str(tmp_path)])
    result = {}
    async def fake(*args, **kwargs):
        return result
    monkeypatch.setattr(record_once, "record", fake)
    result.update({"v2_mainnet:BTC": {"ok": True}, "v2_mainnet:ETH": {"ok": False}})
    assert record_once.main() == 0
    result.update({"v2_mainnet:BTC": {"ok": False}})
    assert record_once.main() == 1


async def test_no_live_options_is_not_a_questions_failure(tmp_path):
    settings = Settings(data_dir=tmp_path, sources=["v2_mainnet"])
    rec = SimpleNamespace(chains={}, specs={}, status={"v2_mainnet:BTC": {"ok": True, "expiries": 0}})
    await record_once.questions(settings, rec, 900, None)
    assert rec.status["questions:v2_mainnet"]["ok"] is True
