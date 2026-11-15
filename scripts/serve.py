#!/usr/bin/env python3
"""Serve site/ on 127.0.0.1:8765 with no-cache headers so browsers always revalidate."""
import functools
import http.server
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(Handler, directory=str(SITE))).serve_forever()
