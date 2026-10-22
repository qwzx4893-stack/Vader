"""Native POSIX signal evidence regression. Run on Linux, not a Windows proof."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest

import integrity


@unittest.skipUnless(os.name == "posix", "Requires native POSIX signals")
class PosixSignalTests(unittest.TestCase):
    def test_signal_exit_is_preserved_through_owned_wrapper(self):
        result = subprocess.run([sys.executable, str(Path(integrity.__file__)), "_child", str(os.getpid()), sys.executable, "-c", "import os,signal; os.kill(os.getpid(), signal.SIGTERM)"], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, -signal.SIGTERM)


if __name__ == "__main__":
    unittest.main(verbosity=2)
