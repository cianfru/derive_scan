"""The copied Reflex files must stay byte-identical to the commit named in reflex/SOURCE.md."""
import hashlib
import re
from pathlib import Path

REFLEX = Path(__file__).resolve().parents[1] / "reflex"


def test_copied_files_match_the_pinned_commit():
    listed = re.findall(r"^([0-9a-f]{64})  (\S+)$", (REFLEX / "SOURCE.md").read_text(), re.M)
    assert len(listed) == 12
    for digest, rel in listed:
        assert hashlib.sha256((REFLEX / rel).read_bytes()).hexdigest() == digest, rel
    own = {"__init__.py", "cto_policy.py"}
    present = {str(p.relative_to(REFLEX)) for p in REFLEX.rglob("*.py")}
    assert present == {rel for _, rel in listed} | own
