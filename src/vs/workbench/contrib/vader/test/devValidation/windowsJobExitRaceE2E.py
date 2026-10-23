"""Isolated Win32 API transition fixtures; actual kernel integration is tested separately."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, Mock, call

spec = importlib.util.spec_from_file_location("vader_job", Path(__file__).with_name("windowsJob.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def is_member(handle, job, output):
    output._obj.value = True
    return True


class ExitRaceTests(unittest.TestCase):
    def probe(self, waits, error):
        job = module.Job.__new__(module.Job)
        job.handle = 7
        waiter = Mock(side_effect=waits)
        closer = Mock()
        with patch.object(module, "OpenProcess", return_value=11), \
             patch.object(module, "IsProcessInJob", side_effect=is_member), \
             patch.object(module, "WaitForSingleObject", waiter), \
             patch.object(module, "process_times", side_effect=error), \
             patch.object(module, "CloseHandle", closer):
            try:
                return job.row(123), waiter
            finally:
                closer.assert_called_once_with(11)

    def test_probe_failure_during_exit_requires_a_confirmed_kernel_exit(self):
        row, waiter = self.probe([258, 0], OSError("controlled teardown probe denial"))
        self.assertIsNone(row)
        self.assertEqual(waiter.call_args_list, [call(11, 0), call(11, 2000)])

    def test_live_process_probe_failure_is_still_fatal(self):
        with self.assertRaisesRegex(OSError, "controlled live access denial"):
            self.probe([258, 258], OSError("controlled live access denial"))

    def test_failed_native_wait_does_not_hide_the_probe_error(self):
        with self.assertRaisesRegex(OSError, "controlled measurement error"):
            self.probe([258, 0xFFFFFFFF], OSError("controlled measurement error"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
