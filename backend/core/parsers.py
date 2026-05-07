"""
DDD file parsing — subprocess call to tachoparser.
"""

import json
import subprocess

from config import DDDPARSER_PATH


def parse_ddd_file(file_path):
    """Parse DDD file using tachoparser (dddparser CLI)."""
    result = subprocess.run(
        [DDDPARSER_PATH, '-card', '-format', '-input', file_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Parser error: {result.stderr}")
    return json.loads(result.stdout)


def parse_ddd_auto(file_path, config_loader=None):
    """Parse DDD file using tachoparser."""
    return parse_ddd_file(file_path)
