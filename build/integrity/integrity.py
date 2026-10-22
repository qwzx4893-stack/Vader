"""Local command evidence and completion audit. Python 3.10+, standard library only.

Plans execute trusted local commands: review them before running. Evidence is
tamper-evident against accidental edits, not signed or secure against its owner.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def dump(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def safe_path(root, name):
    if not isinstance(name, str) or not name:
        raise ValueError("Expected nonempty relative path")
    target = (root / name).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Path escapes root: " + name)
    return target


def plan_at(path):
    plan = load(path)
    if plan.get("version") != 1:
        raise ValueError("Unsupported plan version")
    gates = plan.get("gates", [])
    criteria = plan.get("criteria", [])
    if not gates or not criteria:
        raise ValueError("Plan requires gates and acceptance criteria")
    ids = set()
    levels = {"static", "build", "unit", "integration", "e2e", "manual"}
    for gate in gates:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", gate.get("id", "")) or gate["id"] in ids:
            raise ValueError("Invalid or duplicate gate ID")
        ids.add(gate["id"])
        if gate.get("level") not in levels:
            raise ValueError("Gate needs a known verification level")
        if not gate.get("argv") or not all(isinstance(x, str) and x for x in gate["argv"]):
            raise ValueError("Gate needs nonempty argv")
        if not 0 < gate.get("timeout", 300) <= 3600:
            raise ValueError("Timeout must be in (0, 3600]")
        for pattern in gate.get("reject_output", []):
            re.compile(pattern)
    cids = set()
    for criterion in criteria:
        if not criterion.get("id") or criterion["id"] in cids or not criterion.get("behavior"):
            raise ValueError("Criterion needs unique ID and observable behavior")
        cids.add(criterion["id"])
        required = criterion.get("gates", [])
        if not required or not set(required) <= ids:
            raise ValueError("Criterion must reference existing gates")
        if not criterion.get("levels") or not set(criterion["levels"]) <= levels:
            raise ValueError("Criterion needs required verification levels")
        if not set(criterion["levels"]) <= {g["level"] for g in gates if g["id"] in required}:
            raise ValueError("Criterion is missing a required verification layer")
    return plan


def input_hashes(plan, root):
    inputs = plan.get("inputs", [])
    if not inputs:
        raise ValueError("Declare input files; evidence must bind to reviewed source")
    result = {}
    for name in inputs:
        target = safe_path(root, name)
        if not target.is_file():
            raise ValueError("Missing input file: " + name)
        result[name] = digest(target.read_bytes())
    return result


def redact(text):
    text = re.sub(r"\b(?:sk-[\w-]{12,}|ghp_[\w-]{12,}|github_pat_[\w-]{12,})", "[REDACTED]", text)
    return re.sub(r"(?i)(authorization\s*:\s*bearer\s+)\S+", r"\1[REDACTED]", text)


def stop_tree(proc):
    if os.name == "nt":
        # The wrapper owns a kill-on-close Job Object. Killing it also kills
        # descendants even when their original parent has already exited.
        proc.kill()
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    proc.wait(timeout=5)


def windows_child(argv, runner_pid):
    """Own the command tree before starting it; fail closed if job setup fails."""
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)

    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t),
                    ("max_ws", ctypes.c_size_t), ("active", wintypes.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                    ("scheduling", wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ["read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes"]]

    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", IO), ("process_memory", ctypes.c_size_t),
                    ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t),
                    ("peak_job", ctypes.c_size_t)]

    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    parent = kernel.OpenProcess(0x100000, False, runner_pid)  # SYNCHRONIZE
    if not parent:
        raise OSError(ctypes.get_last_error(), "Cannot observe runner lifetime")
    job = kernel.CreateJobObjectW(None, None)
    info = Extended()
    info.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise OSError(ctypes.get_last_error(), "Cannot establish owned Windows command job")
    def watch_parent():
        # Parent termination, not just a timeout, must close our owned job.
        kernel.WaitForSingleObject(parent, 0xFFFFFFFF)
        os._exit(125)
    threading.Thread(target=watch_parent, daemon=True).start()
    # Intentionally retain this non-inheritable handle until wrapper process exit.
    # Its OS cleanup kills any remaining command descendants without killing peers.
    return subprocess.call(argv)


def owned_child(argv, runner_pid):
    if os.name == "nt":
        return windows_child(argv, runner_pid)
    def watch_parent():
        while os.getppid() == runner_pid:
            time.sleep(0.1)
        os.killpg(os.getpgrp(), signal.SIGKILL)
    threading.Thread(target=watch_parent, daemon=True).start()
    code = subprocess.call(argv)
    if code < 0:
        # sys.exit(-15) becomes 241; preserve the actual POSIX signal instead.
        signum = -code
        if signum not in {signal.SIGKILL, signal.SIGSTOP}:
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
    return code


def execute(plan_path, root, output, selected=None):
    plan = plan_at(plan_path)
    root, output = Path(root).resolve(), Path(output).resolve()
    before = input_hashes(plan, root)
    if output.exists():
        raise ValueError("Evidence directory exists; use a fresh directory, do not overwrite history")
    if selected and not set(selected) <= {g["id"] for g in plan["gates"]}:
        raise ValueError("Unknown gate")
    output.mkdir(parents=True)
    evidence = {"version": 1, "plan_sha256": digest(Path(plan_path).read_bytes()),
                "root": str(root), "inputs": before,
                "created": datetime.now(timezone.utc).isoformat(), "finalized": False, "gates": []}
    dump(output / "evidence.json", evidence)
    for gate in plan["gates"]:
        row = {"id": gate["id"], "argv": gate["argv"], "level": gate["level"],
               "state": "NOT RUN", "exit_code": None, "reason": "Not selected"}
        if not selected or gate["id"] in selected:
            argv = [sys.executable if x == "{python}" else x for x in gate["argv"]]
            started = time.monotonic()
            raw = ""
            row["reason"] = ""
            try:
                executable = argv[0] if not any(s in argv[0] for s in ["/", "\\"]) else str((root / argv[0]).resolve())
                if not shutil.which(executable):
                    raise FileNotFoundError("Executable unavailable: " + argv[0])
                command = [sys.executable, str(Path(__file__).resolve()), "_child", str(os.getpid()), *argv]
                # A file prevents orphaned inherited stdout handles from causing
                # an unbounded communicate() after the command parent exits.
                with tempfile.TemporaryFile() as capture:
                    proc = subprocess.Popen(command, cwd=root, stdout=capture, stderr=subprocess.STDOUT,
                                            start_new_session=os.name != "nt")
                    try:
                        proc.wait(timeout=gate.get("timeout", 300))
                        row["exit_code"] = proc.returncode
                        row["state"] = "PASS" if proc.returncode == 0 else "FAIL"
                    except subprocess.TimeoutExpired:
                        stop_tree(proc)
                        row.update(state="FAIL", exit_code=proc.returncode, reason="Timed out")
                    finally:
                        if os.name != "nt":
                            try:
                                os.killpg(proc.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                    capture.seek(0)
                    raw = capture.read().decode("utf-8", errors="replace")
                if any(re.search(p, raw) for p in gate.get("reject_output", [])):
                    row.update(state="FAIL", reason="Output matched a declared failure/skip marker")
            except OSError as error:
                row.update(state="BLOCKED", reason=str(error))
            row["seconds"] = round(time.monotonic() - started, 3)
            log = redact(raw).encode("utf-8")
            log_name = gate["id"] + ".log"
            (output / log_name).write_bytes(log)
            row.update(log=log_name, log_sha256=digest(log))
        evidence["gates"].append(row)
        dump(output / "evidence.json", evidence)
        print(gate["id"] + ": " + row["state"])
    try:
        if input_hashes(plan, root) != before:
            evidence["inputs_changed_during_run"] = True
        evidence["finalized"] = True
    except (OSError, ValueError) as error:
        evidence["finalization_error"] = str(error)
    dump(output / "evidence.json", evidence)
    return 0 if evidence["finalized"] and all(g["state"] == "PASS" for g in evidence["gates"]) and not evidence.get("inputs_changed_during_run") else 1


def audit(plan_path, root, evidence_dir, claim=None):
    plan = plan_at(plan_path)
    directory = Path(evidence_dir).resolve()
    evidence = load(directory / "evidence.json")
    errors = []
    if evidence.get("finalized") is not True or evidence.get("finalization_error"):
        errors.append("Execution did not finalize successfully")
    if evidence.get("plan_sha256") != digest(Path(plan_path).read_bytes()):
        errors.append("Acceptance plan changed or evidence belongs to another plan")
    if evidence.get("root") != str(Path(root).resolve()) or evidence.get("inputs") != input_hashes(plan, Path(root)):
        errors.append("Source inputs/root changed since execution")
    if evidence.get("inputs_changed_during_run"):
        errors.append("Source inputs changed during execution")
    recorded = evidence.get("gates", [])
    if len({r["id"] for r in recorded}) != len(recorded):
        errors.append("Duplicate evidence IDs")
    rows = {r["id"]: r for r in recorded}
    for gate in plan["gates"]:
        row = rows.get(gate["id"], {})
        if row.get("state") != "PASS" or row.get("exit_code") != 0:
            errors.append(gate["id"] + ": " + row.get("state", "MISSING"))
        if row.get("argv") != gate["argv"] or row.get("level") != gate["level"]:
            errors.append(gate["id"] + ": evidence command/level mismatch")
        if row.get("state") == "NOT RUN":
            continue
        try:
            log = safe_path(directory, row.get("log", "")).read_bytes()
            if digest(log) != row.get("log_sha256"):
                errors.append(gate["id"] + ": log changed")
            if any(re.search(p, log.decode("utf-8", errors="replace")) for p in gate.get("reject_output", [])):
                errors.append(gate["id"] + ": failure/skip marker in log")
        except (OSError, ValueError):
            errors.append(gate["id"] + ": log missing/invalid")
    matrix = []
    for c in plan["criteria"]:
        passed = all(rows.get(g, {}).get("state") == "PASS" and rows.get(g, {}).get("exit_code") == 0 for g in c["gates"])
        matrix.append({"id": c["id"], "state": "VERIFIED" if passed and not errors else "UNVERIFIED", "gates": c["gates"]})
    if claim is not None:
        report = load(claim)
        known = {c["id"]: c for c in matrix}
        if report.get("final_status") not in {"VERIFIED", "PARTIAL", "FAILED", "BLOCKED", "UNVERIFIED"}:
            errors.append("Unknown completion status")
        if report.get("final_status") == "VERIFIED" and any(c["state"] != "VERIFIED" for c in matrix):
            errors.append("Unsupported VERIFIED completion claim")
        for c in report.get("criteria", []):
            if c.get("id") not in known or (c.get("state") == "VERIFIED" and known[c["id"]]["state"] != "VERIFIED"):
                errors.append("Unsupported criterion claim: " + str(c.get("id")))
    print(json.dumps({"status": "VERIFIED" if not errors else "UNVERIFIED", "matrix": matrix, "errors": errors}, indent=2))
    return 1 if errors else 0


def scan_diff(text):
    """Heuristics yield REVIEW_REQUIRED, never prove correctness or infer intent."""
    findings, file = [], ""
    for line in text.splitlines():
        if line.startswith("+++ b/"):
            file = line[6:]
        if line.startswith(("+++", "---")):
            continue
        test = bool(re.search(r"(^|/)(test[s]?|fixtures|__tests__)(/|\.)|[._](test|spec)\.|(^|/)test_[^/]+\.py$", file))
        if line.startswith("+"):
            if test and re.search(r"\b(?:it|test|describe)\.(?:skip|only)\s*\(|\b(?:skip|skipIf|skipUnless)\s*\(|assert\s+(?:True|true)\b", line):
                findings.append({"file": file, "kind": "test-bypass", "line": line[1:]})
            if not test and not file.endswith((".md", ".json", ".yml", ".yaml")) and re.search(r"TODO|FIXME|NotImplementedError|not implemented|onClick\s*=\s*\{\s*\(\)\s*=>\s*\{\s*\}|\b(?:fake|mock|placeholder)\b", line, re.I):
                findings.append({"file": file, "kind": "possible-production-placeholder", "line": line[1:]})
            if not test and re.search(r"\breturn\s*\{\s*['\"]?(?:success|ok)['\"]?\s*:\s*(?:true|True)\b|Promise\.resolve\(\s*\{\s*(?:success|ok)\s*:\s*true\b", line):
                findings.append({"file": file, "kind": "constant-success-needs-review", "line": line[1:]})
        if test and line.startswith("-") and re.search(r"\b(?:assert|expect|check)\b", line):
            findings.append({"file": file, "kind": "removed-test-assertion", "line": line[1:]})
        if line.startswith("+") and re.search(r"continue-on-error:\s*true|\|\|\s*true\b", line):
            findings.append({"file": file, "kind": "failure-suppression", "line": line[1:]})
    return findings


def main():
    if len(sys.argv) > 3 and sys.argv[1] == "_child":
        try:
            return owned_child(sys.argv[3:], int(sys.argv[2]))
        except (OSError, ValueError) as error:
            print("BLOCKED: " + str(error), file=sys.stderr)
            return 2
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ["run", "audit"]:
        p = sub.add_parser(command)
        p.add_argument("--plan", required=True)
        p.add_argument("--root", required=True)
        p.add_argument("--evidence", required=True)
        if command == "run":
            p.add_argument("--gate", action="append")
        else:
            p.add_argument("--claim")
    p = sub.add_parser("scan")
    p.add_argument("--root", required=True)
    p.add_argument("--base", default="HEAD")
    args = parser.parse_args()
    try:
        if args.command == "run":
            return execute(args.plan, args.root, args.evidence, args.gate)
        if args.command == "audit":
            return audit(args.plan, args.root, args.evidence, args.claim)
        if args.base.startswith("-"):
            raise ValueError("Base must be a Git revision, not an option")
        revision = subprocess.run(["git", "rev-parse", "--verify", "--end-of-options", args.base + "^{commit}"], cwd=args.root, check=True, capture_output=True, text=True).stdout.strip()
        if not re.fullmatch(r"[a-fA-F0-9]{40,64}", revision):
            raise ValueError("Invalid resolved Git revision")
        data = subprocess.run(["git", "diff", "--no-ext-diff", "--no-textconv", "--unified=3", revision, "--"], cwd=args.root, check=True, capture_output=True).stdout.decode("utf-8", errors="replace")
        findings = scan_diff(data)
        print(json.dumps({"status": "REVIEW_REQUIRED" if findings else "NO_HEURISTIC_FINDINGS", "findings": findings, "limitations": "Tracked diff only; manual review still required, including untracked files."}, indent=2))
        return 3 if findings else 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
