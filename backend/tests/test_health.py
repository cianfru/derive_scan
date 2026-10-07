from check_health import problems


def healthy(now=100000):
    return {"generated_at": now, "recordings": {"v2_mainnet:BTC": {"ok": True, "ts": now - 600}},
            "signals": {"4h": now - 14400, "1d": now - 86400}, "questions": now - 600}


def test_healthy_publication():
    assert problems(healthy(), 100000) == []


def test_fresh_publication_does_not_hide_old_or_failed_inputs():
    doc = healthy()
    doc["recordings"]["v2_mainnet:ETH"] = {"ok": False, "ts": 100000}
    doc["recordings"]["v2_mainnet:BTC"]["ts"] = 0
    doc["signals"]["4h"] = 0
    doc["questions"] = 0
    errors = problems(doc, 100000)
    assert any("ETH: recording failed" in e for e in errors)
    assert any("BTC: missing or stale" in e for e in errors)
    assert any("signals 4h" in e for e in errors)
    assert any("questions" in e for e in errors)


def test_missing_inputs_fail():
    assert len(problems({}, 100000)) == 4
    assert any("questions" in e for e in problems({**healthy(), "questions": None, "questions_required": True}, 100000))


def test_recent_publication_does_not_hide_wallet_gaps_or_missing_coverage():
    doc = {**healthy(), "coverage_required": True}
    assert "wallet history: incomplete coverage" in problems(doc, 100000)
    doc["coverage"] = {"ready": True, "gaps": 1}
    assert "wallet history: unreconciled gaps" in problems(doc, 100000)
    doc["coverage"]["gaps"] = 0
    assert problems(doc, 100000) == []


def test_flow_recovery_has_a_bounded_grace_period():
    flow = {"checked_at": 100000, "live_ok": True, "degraded_since": 99000,
            "coverage": {"24h": {"ready": True}, "7d": {"ready": False}}}
    doc = {**healthy(), "flow": flow}
    assert problems(doc, 100000) == []
    flow["degraded_since"] = 95000
    assert "flow coverage: incomplete 7d" in problems(doc, 100000)
    flow["coverage"]["7d"]["ready"] = True
    flow["live_ok"] = False
    assert "flow collection: failed or unavailable" in problems(doc, 100000)
    flow["live_ok"] = True
    flow["checked_at"] = 95000
    assert "flow collection: missing or stale timestamp" in problems(doc, 100000)
