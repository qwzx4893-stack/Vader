"""Adversarial acceptance tests using real child processes in disposable folders."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import integrity


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-integrity-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.plan = self.root / "plan.json"
        self.evidence = self.root / "evidence"
        (self.root / "feature.py").write_text("def answer():\n    return 42\n", encoding="utf-8")

    def configure(self, gates=None, levels=None):
        gates = gates or [{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "from feature import answer; assert answer() == 42"], "timeout": 10}]
        data = {"version": 1, "inputs": ["feature.py"], "gates": gates,
                "criteria": [{"id": "C1", "behavior": "Answer returns 42", "gates": [g["id"] for g in gates], "levels": levels or list({g["level"] for g in gates})}]}
        integrity.dump(self.plan, data)

    def run_gates(self, selected=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return integrity.execute(self.plan, self.root, self.evidence, selected)

    def audit(self, claim=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return integrity.audit(self.plan, self.root, self.evidence, claim)

    def test_real_pass_has_reproducible_log(self):
        self.configure()
        self.assertEqual(self.run_gates(), 0)
        self.assertEqual(self.audit(), 0)
        self.assertEqual(integrity.load(self.evidence / "evidence.json")["gates"][0]["exit_code"], 0)

    def test_actual_failing_test_remains_fail(self):
        self.configure()
        (self.root / "feature.py").write_text("def answer():\n    return 0\n", encoding="utf-8")
        self.assertEqual(self.run_gates(), 1)
        self.assertEqual(self.audit(), 1)
        row = integrity.load(self.evidence / "evidence.json")["gates"][0]
        self.assertEqual(row["state"], "FAIL")
        self.assertNotEqual(row["exit_code"], 0)
        self.assertIn("AssertionError", (self.evidence / "unit.log").read_text())

    def test_stub_implementation_is_flagged_and_fails_behavior(self):
        self.configure()
        (self.root / "feature.py").write_text("def answer():\n    raise NotImplementedError('not implemented')\n", encoding="utf-8")
        self.assertEqual(self.run_gates(), 1)
        findings = integrity.scan_diff("+++ b/feature.py\n+    raise NotImplementedError('not implemented')")
        self.assertEqual(findings[0]["kind"], "possible-production-placeholder")

    def test_real_unavailable_local_integration_not_verified(self):
        self.configure([{"id": "integration", "level": "integration", "argv": ["{python}", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:0', timeout=1)"], "timeout": 10}])
        self.assertEqual(self.run_gates(), 1)
        self.assertEqual(self.audit(), 1)
        self.assertNotEqual(integrity.load(self.evidence / "evidence.json")["gates"][0]["exit_code"], 0)

    def test_missing_executable_is_blocked(self):
        self.configure([{"id": "integration", "level": "integration", "argv": [str(self.root / "missing-command")], "timeout": 10}])
        self.assertEqual(self.run_gates(), 1)
        self.assertEqual(integrity.load(self.evidence / "evidence.json")["gates"][0]["state"], "BLOCKED")
        self.assertEqual(self.audit(), 1)

    def test_build_pass_runtime_fail_cannot_claim_complete(self):
        self.configure([
            {"id": "build", "level": "build", "argv": ["{python}", "-m", "py_compile", "feature.py"]},
            {"id": "runtime", "level": "e2e", "argv": ["{python}", "-c", "from feature import answer; assert answer() == 99"]}])
        self.assertEqual(self.run_gates(), 1)
        rows = integrity.load(self.evidence / "evidence.json")["gates"]
        self.assertEqual([r["state"] for r in rows], ["PASS", "FAIL"])
        claim = self.root / "claim.json"
        integrity.dump(claim, {"final_status": "VERIFIED", "criteria": [{"id": "C1", "state": "VERIFIED"}]})
        self.assertEqual(self.audit(claim), 1)

    def test_unselected_checks_are_not_run(self):
        self.configure([
            {"id": "unit", "level": "unit", "argv": ["{python}", "-c", "pass"]},
            {"id": "runtime", "level": "e2e", "argv": ["{python}", "-c", "pass"]}])
        self.assertEqual(self.run_gates(["unit"]), 1)
        self.assertEqual(integrity.load(self.evidence / "evidence.json")["gates"][1]["state"], "NOT RUN")
        self.assertEqual(self.audit(), 1)

    def test_zero_exit_failure_marker_is_rejected(self):
        self.configure([{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "print('1 failed, 0 passed')"], "reject_output": ["[1-9][0-9]* failed"]}])
        self.assertEqual(self.run_gates(), 1)
        self.assertEqual(self.audit(), 1)

    def test_timeout_is_failure(self):
        self.configure([{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "import time; time.sleep(20)"], "timeout": 0.15}])
        self.assertEqual(self.run_gates(), 1)
        self.assertEqual(integrity.load(self.evidence / "evidence.json")["gates"][0]["reason"], "Timed out")

    def test_logs_changes_invalidate_evidence(self):
        self.configure()
        self.run_gates()
        (self.evidence / "unit.log").write_text("fabricated PASS", encoding="utf-8")
        self.assertEqual(self.audit(), 1)

    def test_source_changes_invalidate_otherwise_valid_evidence(self):
        self.configure()
        self.run_gates()
        self.assertEqual(self.audit(), 0)
        (self.root / "feature.py").write_text("def answer(): return 7", encoding="utf-8")
        self.assertEqual(self.audit(), 1)

    def test_unfinalized_run_cannot_be_verified_after_input_restored(self):
        original = (self.root / "feature.py").read_bytes()
        self.configure([{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "from pathlib import Path; Path('feature.py').unlink()"]}])
        self.assertEqual(self.run_gates(), 1)
        (self.root / "feature.py").write_bytes(original)
        self.assertEqual(self.audit(), 1)

    def test_option_shaped_revision_cannot_write_a_file(self):
        target = self.root / "must-not-exist"
        result = subprocess.run([sys.executable, str(Path(integrity.__file__)), "scan", "--root", str(self.root), "--base=--output=" + str(target)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(target.exists())

    def test_python_test_names_and_skip_flags_are_detected(self):
        findings = integrity.scan_diff("+++ b/test_feature.py\n-assert actual == expected\n+@unittest.skip('reason')\n+assert True")
        self.assertEqual({x["kind"] for x in findings}, {"removed-test-assertion", "test-bypass"})

    def test_orphaned_stdout_does_not_hold_runner_open(self):
        self.configure([{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "import subprocess,sys; subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(10)'])"], "timeout": 2}])
        import time
        started = time.monotonic()
        self.assertEqual(self.run_gates(), 0)
        self.assertLess(time.monotonic() - started, 4)

    def test_runner_termination_stops_gate_before_delayed_side_effect(self):
        import time
        self.configure([{"id": "unit", "level": "unit", "argv": ["{python}", "-c", "from pathlib import Path; import time; Path('ready').write_text('started'); time.sleep(1.5); Path('must-not-exist').write_text('leaked')"]}])
        runner = subprocess.Popen([sys.executable, str(Path(integrity.__file__)), "run", "--plan", str(self.plan), "--root", str(self.root), "--evidence", str(self.evidence)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while not (self.root / "ready").exists() and runner.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.root / "ready").exists(), "Gate must actually start before testing cancellation")
        finally:
            if runner.poll() is None:
                runner.kill()
            runner.wait(timeout=5)
        time.sleep(1.8)
        self.assertFalse((self.root / "must-not-exist").exists(), "Gate survived runner termination")
        self.assertEqual(self.audit(), 1)

    def test_retroactive_acceptance_change_rejected(self):
        self.configure()
        self.run_gates()
        data = integrity.load(self.plan)
        data["criteria"][0]["behavior"] = "Different scope"
        integrity.dump(self.plan, data)
        self.assertEqual(self.audit(), 1)

    def test_plan_missing_runtime_layer_rejected(self):
        self.configure(levels=["unit", "e2e"])
        with self.assertRaises(ValueError):
            self.run_gates()

    def test_test_weakening_and_suppression_flagged(self):
        findings = integrity.scan_diff("+++ b/test/feature.test.js\n-assert.equal(actual, expected);\n+test.skip('broken', () => {});\n+++ b/.github/workflows/ci.yml\n+continue-on-error: true")
        self.assertEqual({f["kind"] for f in findings}, {"removed-test-assertion", "test-bypass", "failure-suppression"})
        self.assertEqual(integrity.scan_diff("+++ b/test/fixtures/mock.py\n+# placeholder for isolated test"), [])

    def test_success_shaped_stub_is_not_verified_by_static_success(self):
        (self.root / "feature.py").write_text("def answer():\n    return {'success': True, 'items': []}\n", encoding="utf-8")
        self.configure()
        self.assertEqual(self.run_gates(), 1)
        findings = integrity.scan_diff("+++ b/feature.py\n+    return {'success': True, 'items': []}")
        self.assertEqual(findings[0]["kind"], "constant-success-needs-review")

    def test_path_escape_and_evidence_overwrite_rejected(self):
        with self.assertRaises(ValueError):
            integrity.safe_path(self.root, "../outside")
        self.configure()
        self.run_gates()
        with self.assertRaises(ValueError):
            self.run_gates()

    def test_actual_cli_propagates_failure(self):
        self.configure()
        (self.root / "feature.py").write_text("def answer(): return 0", encoding="utf-8")
        result = subprocess.run([sys.executable, str(Path(integrity.__file__)), "run", "--plan", str(self.plan), "--root", str(self.root), "--evidence", str(self.evidence)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unit: FAIL", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
