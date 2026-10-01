from fastapi.testclient import TestClient

from derive.features import ExpirySlice


def test_api_serves_recorded_data(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DERIVE_RECORDER", "off")
    from main import app

    with TestClient(app) as c:
        assert c.get("/health").json() == {"ok": True}
        assert c.get("/api/surface/eth").status_code == 404
        store = app.state.store
        s = ExpirySlice(2000, 30, 100, 0.5, 0.52, 0.55, -0.03, 0.035, 10, 5, 40)
        store.write_snapshot(1000, "v2_mainnet", "ETH", {"atm_iv_30d": 0.5}, [s])
        store.write_snapshot(1900, "v2_mainnet", "ETH", {"atm_iv_30d": 0.6}, [s])
        body = c.get("/api/surface/eth").json()
        assert body["ts"] == 1900 and body["features"] == {"atm_iv_30d": 0.6}
        assert body["expiries"][0]["rr25"] == -0.03
        pts = c.get("/api/features/ETH", params={"feature": "atm_iv_30d", "from": 0, "to": 5000}).json()["points"]
        assert pts == [[1000, 0.5], [1900, 0.6]]
        assert c.get("/api/surface/eth", params={"source": "v3_mainnet"}).status_code == 404
        assert c.get("/api/status").json()["rows"]["features"] == 2
