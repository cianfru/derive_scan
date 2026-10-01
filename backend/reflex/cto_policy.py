"""Stand-in for Reflex's cto_policy.py, which is not copied (it needs Reflex's research package).

Reflex runs the baseline policy in shadow mode unless CTO_POLICY_PATH names a validated
policy file. Derive Scan has no such file, so it always runs the baseline, as Reflex does
by default.
"""


def active_policy():
    return ("baseline", 1), "shadow", None, {}
