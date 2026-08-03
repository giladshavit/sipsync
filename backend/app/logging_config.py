# backend/app/logging_config.py
"""Backend-wide logging setup. Call once at process startup (see main.py).
Before this, the backend had zero logging anywhere — every exception
caught-and-swallowed in room_service.py (e.g. the pub/sub listener) left no
trace in production. This doesn't change what's caught; it makes what's
already being caught visible."""

import logging
import sys

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotent — logging.basicConfig no-ops if the root logger already
    has a handler, so calling this more than once (e.g. once from main.py,
    once from a test) is safe."""
    logging.basicConfig(level=level, format=_LOG_FORMAT, stream=sys.stdout)
