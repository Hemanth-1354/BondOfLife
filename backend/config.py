# backend/config.py
"""
Simple .env loader for BondOfLife.

- Reads a .env file placed at the repository root.
- Populates os.environ for the current process.
- No external dependencies (pure Python).
"""

import os
from pathlib import Path

def _load_dotenv(dotenv_path: Path) -> None:
    """Parse a .env file and set variables in os.environ.

    Lines starting with ``#`` are ignored. Empty lines are skipped.
    Values are stripped of surrounding quotes.
    Existing environment variables are **not** overwritten.
    """
    if not dotenv_path.is_file():
        return
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"\'')
        os.environ.setdefault(key, value)

# Determine repository root (two levels up from this file)
_repo_root = Path(__file__).resolve().parents[1]
_load_dotenv(_repo_root / ".env")
