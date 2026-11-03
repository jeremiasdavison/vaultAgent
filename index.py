"""Entrada para Vercel (preset FastAPI): expone `app`. En la VM o en Docker se usa `llaverito serve`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from llaverito.app import create_app  # noqa: E402

app = create_app()
