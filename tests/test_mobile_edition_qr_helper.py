import base64
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "Generate-MobileEditionQr.py"


class MobileEditionQrHelperTests(unittest.TestCase):
    def run_helper(self, value):
        return subprocess.run(
            [sys.executable, str(HELPER), value],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_qr_helper_rejects_invalid_input(self):
        for value in ["", "http://desktop.tailnet.ts.net", "not a url", "ftp://desktop.tailnet.ts.net"]:
            with self.subTest(value=value):
                result = self.run_helper(value)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertNotIn("desktop.tailnet.ts.net", result.stderr)

    def test_qr_helper_returns_png_payload_without_echoing_url(self):
        url = "https://desktop.tailnet.ts.net"
        result = self.run_helper(url)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn(url, result.stdout)

        payload = base64.b64decode(result.stdout, validate=True)
        self.assertGreater(len(payload), 100)
        self.assertTrue(payload.startswith(b"\x89PNG\r\n\x1a\n"))


if __name__ == "__main__":
    unittest.main()
