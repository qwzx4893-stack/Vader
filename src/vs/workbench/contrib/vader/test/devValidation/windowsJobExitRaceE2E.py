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


class CleanupSnapshotTests(unittest.TestCase):
    def snapshot(self, pids, rows):
        return {"membershipPids": pids, "processes": rows}

    def reconcile(self, snapshots, accounts, memberships):
        job = module.Job.__new__(module.Job)
        with patch.object(job, "sample", side_effect=snapshots), \
             patch.object(job, "accounting", side_effect=accounts), \
             patch.object(job, "members", side_effect=memberships):
            return job.before_cleanup()

    def test_retained_exited_helper_pid_does_not_invent_a_leak(self):
        account = {"totalProcesses": 2, "activeProcesses": 0}
        before = self.reconcile([self.snapshot([123], [])], [account, account], [[123]])
        self.assertEqual(before["observedProcesses"], [])

    def test_replacement_is_resampled_when_the_parent_exits_during_its_probe(self):
        parent = {"totalProcesses": 2, "activeProcesses": 1}
        replacement = {"totalProcesses": 3, "activeProcesses": 1}
        row = {"pid": 456, "created": "filetime:222"}
        before = self.reconcile([self.snapshot([123], []), self.snapshot([456], [row])],
                                [parent, replacement, replacement, replacement], [[456], [456]])
        self.assertEqual(before["observedProcesses"], [row])

    def test_live_observation_is_sticky_across_reconciliation(self):
        initial = {"totalProcesses": 2, "activeProcesses": 1}
        final = {"totalProcesses": 3, "activeProcesses": 0}
        row = {"pid": 123, "created": "filetime:111"}
        before = self.reconcile([self.snapshot([123], [row]), self.snapshot([], [])],
                                [initial, final, final, final], [[], []])
        self.assertEqual(before["observedProcesses"], [row])

    def test_unexplained_active_members_fail_closed_after_bounded_reconciliation(self):
        account = {"totalProcesses": 2, "activeProcesses": 1}
        with self.assertRaisesRegex(RuntimeError, "could not be reconciled"):
            self.reconcile([self.snapshot([123], []) for _ in range(3)], [account] * 6, [[123]] * 3)

    def test_spawn_after_reconciliation_cannot_be_reported_as_verified_cleanup(self):
        job = module.Job.__new__(module.Job)
        job.threads, job.exit_thread = [], Mock()
        job.exit_thread.is_alive.return_value = False
        with patch.object(job, "before_cleanup", return_value={"jobAccounting": {"totalProcesses": 2}}), \
             patch.object(job, "terminate") as terminate, \
             patch.object(job, "members", return_value=[]), \
             patch.object(job, "accounting", return_value={"totalProcesses": 3, "activeProcesses": 0}):
            with self.assertRaisesRegex(RuntimeError, "changed after"):
                job.dispose()
            terminate.assert_called_once_with()


if __name__ == "__main__":
    unittest.main(verbosity=2)
