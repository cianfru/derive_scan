import time

from fastapi.testclient import TestClient

from derive import egress
from derive.features import ExpirySlice


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DERIVE_RECORDER", "off")
    from main import app
    return app


def test_etag_304_and_counter(tmp_path, monkeypatch):
    app = _client(tmp_path, monkeypatch)
    with TestClient(app) as c:
        s = ExpirySlice(2000, 30, 100, 0.5, 0.52, 0.55, -0.03, 0.035, 10, 5, 40)
        now = int(time.time())
        app.state.store.write_snapshot(now, "v2_mainnet", "ETH", {"atm_iv_30d": 0.5}, [s])
        r1 = c.get("/api/surface/eth")
        assert r1.status_code == 200 and r1.headers["etag"] and r1.headers["cache-control"] == "no-cache"
        assert r1.json()["stale"] is False
        r2 = c.get("/api/surface/ETH", headers={"If-None-Match": r1.headers["etag"]})
        assert r2.status_code == 304 and r2.content == b""
        route = egress.snapshot()["routes"]["/api/surface/{underlying}"]
        assert route["requests"] >= 2 and route["not_modified"] >= 1
        status = c.get("/api/status").json()
        assert status["db_bytes"] > 0 and "egress" in status


def test_stale_and_range_cap(tmp_path, monkeypatch):
    app = _client(tmp_path, monkeypatch)
    with TestClient(app) as c:
        app.state.store.write_snapshot(1000, "v2_mainnet", "BTC", {"atm_iv_30d": 0.4}, [])
        assert c.get("/api/surface/btc").json()["stale"] is True
        assert c.get("/api/features/btc", params={"from": 0, "to": 401 * 86400}).status_code == 400


def test_etag_matching():
    assert egress.etag_matches('W/"abc", "x"', '"abc"')
    assert egress.etag_matches("*", '"abc"')
    assert not egress.etag_matches(None, '"abc"')
