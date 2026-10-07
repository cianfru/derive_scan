import hashlib
import json

import pytest

from publish_site import _write, finalize_publication, flow_health


@pytest.mark.parametrize("number", [float("nan"), float("inf"), float("-inf")])
def test_writer_rejects_nonfinite_without_overwriting_last_artifact(tmp_path, number):
    path = tmp_path / "reading.json"
    path.write_text('{"reading":null}')
    with pytest.raises(ValueError):
        _write(path, {"reading": number})
    assert path.read_text() == '{"reading":null}'


def test_publication_shares_revision_preserves_times_and_checksums(tmp_path):
    _write(tmp_path / "markets.json", {"coins": [], "generated_at": 100})
    _write(tmp_path / "questions" / "BTC.json", {"und": "BTC", "dates": [], "prices_ts": 50, "reading": None})
    revision = finalize_publication(tmp_path, 110)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["publication_revision"] == revision
    board = json.loads((tmp_path / "questions" / "BTC.json").read_text())
    assert board["publication_revision"] == revision and board["prices_ts"] == 50
    assert board["reading"] is None
    for relative, info in manifest["artifacts"].items():
        content = (tmp_path / relative).read_bytes()
        assert info == {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


@pytest.mark.parametrize("invalid", ['{"coins":null}', '{"coins":[],"reading":NaN}', '{"coins":[],"reading":1e999}'])
def test_invalid_artifact_blocks_manifest_without_rewriting_other_files(tmp_path, invalid):
    (tmp_path / "markets.json").write_text(invalid)
    (tmp_path / "a.json").write_text('{"reading":null}')
    with pytest.raises(ValueError):
        finalize_publication(tmp_path, 110)
    assert not (tmp_path / "manifest.json").exists()
    assert (tmp_path / "a.json").read_text() == '{"reading":null}'


def test_flow_health_retains_first_degraded_time_until_recovered(tmp_path):
    data, site = tmp_path / "data", tmp_path / "site"
    _write(data / "flow" / "status.json", {"checked_at": 100, "live": {"legs": 0},
                                            "recovery": {"ready": False, "remaining_intervals": 2, "errors": []}})
    windows = {"24h": {"ready": True}, "7d": {"ready": False}}
    first = flow_health(data, site, windows, 100)
    assert first["degraded_since"] == 100 and first["live_ok"] is True
    _write(site / "health.json", {"flow": first})
    assert flow_health(data, site, windows, 4000)["degraded_since"] == 100
    windows["7d"]["ready"] = True
    assert flow_health(data, site, windows, 4000)["degraded_since"] is None
