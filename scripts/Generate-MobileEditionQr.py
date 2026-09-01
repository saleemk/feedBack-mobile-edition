#!/usr/bin/env python3
"""Emit a PNG QR code for one private HTTPS URL as base64 on stdout."""

from __future__ import annotations

import base64
import io
import sys
from urllib.parse import urlparse

import qrcode


def _valid_private_https_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and not parsed.fragment


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Expected exactly one HTTPS URL.", file=sys.stderr)
        return 2

    url = argv[1].strip()
    if not url or not _valid_private_https_url(url):
        print("Expected a valid HTTPS URL.", file=sys.stderr)
        return 2

    image = qrcode.make(url)
    output = io.BytesIO()
    image.save(output, format="PNG")
    sys.stdout.write(base64.b64encode(output.getvalue()).decode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
