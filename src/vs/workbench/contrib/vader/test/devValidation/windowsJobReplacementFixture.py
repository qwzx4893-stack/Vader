"""Controlled native B -> C replacement during a failing process probe; no app/UI."""
import base64
import ctypes as c
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import uuid

spec = importlib.util.spec_from_file_location("vader_job", Path(__file__).with_name("windowsJob.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def replacement_during_probe():
    create_event = module.signature("CreateEventW", module.HANDLE, [c.c_void_p, module.w.BOOL, module.w.BOOL, module.w.LPCWSTR])
    set_event = module.signature("SetEvent", module.w.BOOL, [module.HANDLE])
    process_id = module.signature("GetProcessId", module.w.DWORD, [module.HANDLE])
    event_name = "Local\\VaderReplacement" + uuid.uuid4().hex
    gate = module.checked(create_event(None, True, False, event_name), "CreateEvent")
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    if not pythonw.is_file():
        module.CloseHandle(gate)
        raise RuntimeError("The native replacement fixture requires pythonw.exe beside Python")

    # Console-free B/C avoid keeping B's console helper alive on C's behalf.
    child_code = "\n".join([
        "import ctypes as c, subprocess, sys",
        'k = c.WinDLL("kernel32", use_last_error=True)',
        "k.OpenEventW.restype = c.c_void_p",
        "k.OpenEventW.argtypes = [c.c_ulong, c.c_int, c.c_wchar_p]",
        "k.WaitForSingleObject.argtypes = [c.c_void_p, c.c_ulong]",
        f"gate = k.OpenEventW(0x100000, False, {event_name!r})",
        "assert gate and k.WaitForSingleObject(gate, 10000) == 0",
        'subprocess.Popen([sys.executable, "-I", "-B", "-c", "import time; time.sleep(60)"],'
        " creationflags=0x08000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
    ])
    driver_code = "\n".join([
        "import subprocess",
        f"child = subprocess.Popen([{str(pythonw)!r}, '-I', '-B', '-c', {child_code!r}],"
        " creationflags=0x08000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
        "print(child.pid, flush=True)",
    ])
    output, ready = [], threading.Event()
    original_emit, original_times = module.emit, module.process_times
    job = module.Job()
    try:
        def emit(event):
            if event.get("event") == "stdout":
                output.append(base64.b64decode(event["data"]).decode("ascii"))
                if "\n" in "".join(output):
                    ready.set()

        module.emit = emit
        job.launch({"executable": sys.executable, "args": ["-I", "-B", "-c", driver_code],
                    "env": dict(os.environ), "cwd": str(Path(__file__).parent)})
        assert module.WaitForSingleObject(job.process, 5000) == 0, "Driver did not exit"
        assert ready.wait(5), "Driver did not report B's PID"
        parent_pid = int("".join(output).strip())
        original_members = job.members
        # Choose a legal enumeration order, so B exits before its old helper is probed.
        job.members = lambda: sorted(original_members(), key=lambda pid: pid != parent_pid)

        def process_times(handle):
            if process_id(handle) == parent_pid:
                module.checked(set_event(gate), "SetEvent")
                raise OSError("controlled teardown probe denial while B spawns C")
            return original_times(handle)

        module.process_times = process_times
        live_at_terminate = []
        original_terminate = job.terminate

        def terminate():
            live_at_terminate.extend(row for pid in job.members() if (row := job.row(pid)) is not None)
            original_terminate()

        job.terminate = terminate
        cleanup = job.dispose()
        before = cleanup["beforeCleanup"]
        observed = before.get("observedProcesses", before["processes"])
        proof = {"driverPid": job.pid, "parentPid": parent_pid, "cleanup": cleanup,
                 "liveAtTerminate": live_at_terminate}
        print(json.dumps(proof), flush=True)
        assert live_at_terminate, "Fixture did not leave a live replacement"
        assert all(any(row["pid"] == live["pid"] and row["created"] == live["created"] for row in observed)
                   for live in live_at_terminate), "A live replacement was killed without pre-cleanup evidence"
    finally:
        job.close()
        module.CloseHandle(gate)
        module.emit, module.process_times = original_emit, original_times


if __name__ == "__main__":
    replacement_during_probe()
