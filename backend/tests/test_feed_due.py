import os
import json
import time
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize("failed", ["record", "signal", "history", "flow"])
def test_due_check_failure_does_not_publish_partial_outputs(tmp_path, failed):
    result, outputs = run_due(tmp_path, failed=failed)
    assert result.returncode == 1
    assert outputs == ""
    assert f"{failed} due: failed" in result.stdout


@pytest.mark.parametrize("missing", ["record", "signal", "history", "flow"])
def test_success_without_expected_output_fails(tmp_path, missing):
    result, outputs = run_due(tmp_path, missing=missing)
    assert result.returncode == 1
    assert outputs == ""


def test_successful_nothing_due_is_published(tmp_path):
    result, outputs = run_due(tmp_path)
    assert result.returncode == 0
    assert outputs.splitlines() == ["due=false", "signals_due=false", "history_due=false", "flow_due=false"]


def run_due(tmp_path, failed="", missing=""):
    executable = tmp_path / "python3"
    executable.write_text('''#!/usr/bin/env bash
check=${1%_once.py}
if [ "$check" = "$FAIL_CHECK" ]; then echo "bounded failure" >&2; exit 7; fi
if [ "$check" = "$MISSING_CHECK" ]; then exit 0; fi
case "$check" in record) key=due;; signal) key=signals_due;; history) key=history_due;; flow) key=flow_due;; esac
echo "$key=false" >>"$GITHUB_OUTPUT"
''')
    executable.chmod(0o755)
    output = tmp_path / "outputs"
    output.touch()
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "STORE": str(tmp_path / "store"),
           "FEED_LOG": str(tmp_path / "log"), "GITHUB_OUTPUT": str(output), "FAIL_CHECK": failed, "MISSING_CHECK": missing}
    result = subprocess.run(["bash", str(Path(__file__).parents[1] / "feed.sh"), "due"], env=env, capture_output=True, text=True)
    return result, output.read_text()


@pytest.mark.parametrize("stale", [False, True])
def test_no_jobs_due_still_checks_published_health(tmp_path, stale):
    now = int(time.time())
    site = tmp_path / "site"
    site.mkdir()
    (site / "health.json").write_text(json.dumps({
        "generated_at": now - (5000 if stale else 0), "recordings": {"BTC": {"ok": True, "ts": now}},
        "signals": {"4h": now, "1d": now}, "questions": now,
    }))
    env = {**os.environ, "STORE": str(tmp_path / "store"), "SITE": str(site),
           "FEED_LOG": str(tmp_path / "log"), "DUE": "false", "FLOW_DUE": "false",
           "SIGNALS_DUE": "false", "HISTORY_DUE": "false", "FORCE": "false"}
    result = subprocess.run(["bash", str(Path(__file__).parents[1] / "feed.sh"), "run"], env=env, capture_output=True, text=True)
    assert result.returncode == int(stale)
    assert ("health: failed" if stale else "health: ok") in result.stdout
