# backend/app/logging_config.py
"""Backend-wide logging setup. Call once at process startup (see main.py).
Before this, the backend had zero logging anywhere — every exception
caught-and-swallowed in room_service.py (e.g. the pub/sub listener) left no
trace in production. This doesn't change what's caught; it makes what's
already being caught visible."""

import logging
import os
import sys

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotent — logging.basicConfig no-ops if the root logger already
    has a handler, so calling this more than once (e.g. once from main.py,
    once from a test) is safe.

    The effective level can be raised (e.g. to DEBUG, to surface the
    logger.debug(...) calls in room_service.py's _pubsub_listener) without a
    code change via the LOG_LEVEL environment variable. An explicit `level`
    argument still wins when the env var is unset; when it's set, LOG_LEVEL
    wins over the `level` default."""
    level = getattr(
        logging, os.getenv("LOG_LEVEL", logging.getLevelName(level)).upper(), level
    )
    logging.basicConfig(level=level, format=_LOG_FORMAT, stream=sys.stdout)
