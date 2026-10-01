"""Reflex's signal code, copied unchanged from cianfru/RCCE_Scanner (see SOURCE.md).

The copied files import each other as top-level modules (``signal_synthesizer``,
``engines.rcce_engine``...), exactly as in Reflex, so this directory is put on the path
once. Edit nothing here by hand: update from Reflex as described in SOURCE.md.
"""
import sys
from pathlib import Path

_DIR = str(Path(__file__).resolve().parent)
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)
