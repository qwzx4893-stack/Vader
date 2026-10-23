"""Test-only Windows Job Object broker; JSON control on stdin/stdout, never argv/env logs.

The job handle is unnamed and non-inheritable. Closing this broker (including a
crash or control-pipe EOF) kills the contained driver and its remaining members.
This is lifecycle containment, not a security sandbox against WMI/other brokers.
"""
import base64
import ctypes as c
from ctypes import wintypes as w
import json
import msvcrt
import os
import subprocess
import sys
import threading
import time

if sys.platform != "win32":
    raise SystemExit("Windows Job Objects require Windows")

k = c.WinDLL("kernel32", use_last_error=True)
SIZE_T = c.c_size_t
ULONG_PTR = c.c_size_t
HANDLE = w.HANDLE
LOCK = threading.Lock()


class SECURITY_ATTRIBUTES(c.Structure):
    _fields_ = [("nLength", w.DWORD), ("lpSecurityDescriptor", c.c_void_p), ("bInheritHandle", w.BOOL)]


class STARTUPINFO(c.Structure):
    _fields_ = [("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
                ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
                ("dwXSize", w.DWORD), ("dwYSize", w.DWORD), ("dwXCountChars", w.DWORD),
                ("dwYCountChars", w.DWORD), ("dwFillAttribute", w.DWORD),
                ("dwFlags", w.DWORD), ("wShowWindow", w.WORD), ("cbReserved2", w.WORD),
                ("lpReserved2", c.c_void_p), ("hStdInput", HANDLE),
                ("hStdOutput", HANDLE), ("hStdError", HANDLE)]


class STARTUPINFOEX(c.Structure):
    _fields_ = [("StartupInfo", STARTUPINFO), ("lpAttributeList", c.c_void_p)]


class PROCESS_INFORMATION(c.Structure):
    _fields_ = [("hProcess", HANDLE), ("hThread", HANDLE), ("dwProcessId", w.DWORD), ("dwThreadId", w.DWORD)]


class IO_COUNTERS(c.Structure):
    _fields_ = [(name, c.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class BASIC_LIMIT(c.Structure):
    _fields_ = [("PerProcessUserTimeLimit", c.c_longlong), ("PerJobUserTimeLimit", c.c_longlong),
                ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", SIZE_T),
                ("MaximumWorkingSetSize", SIZE_T), ("ActiveProcessLimit", w.DWORD),
                ("Affinity", ULONG_PTR), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]


class EXTENDED_LIMIT(c.Structure):
    _fields_ = [("BasicLimitInformation", BASIC_LIMIT), ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", SIZE_T), ("JobMemoryLimit", SIZE_T),
                ("PeakProcessMemoryUsed", SIZE_T), ("PeakJobMemoryUsed", SIZE_T)]


class MEMORY_COUNTERS(c.Structure):
    _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD)] + [
        (name, SIZE_T) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                  "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                                  "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]


class BASIC_ACCOUNTING(c.Structure):
    _fields_ = [(name, c.c_longlong) for name in ("TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")] + [
        (name, w.DWORD) for name in ("TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses")]


class JOB_ACCOUNTING(c.Structure):
    _fields_ = [("BasicInfo", BASIC_ACCOUNTING), ("IoInfo", IO_COUNTERS)]


def signature(name, restype, args):
    fn = getattr(k, name)
    fn.restype, fn.argtypes = restype, args
    return fn


CreateJobObject = signature("CreateJobObjectW", HANDLE, [c.c_void_p, w.LPCWSTR])
SetInformationJobObject = signature("SetInformationJobObject", w.BOOL, [HANDLE, c.c_int, c.c_void_p, w.DWORD])
QueryInformationJobObject = signature("QueryInformationJobObject", w.BOOL, [HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)])
AssignProcessToJobObject = signature("AssignProcessToJobObject", w.BOOL, [HANDLE, HANDLE])
IsProcessInJob = signature("IsProcessInJob", w.BOOL, [HANDLE, HANDLE, c.POINTER(w.BOOL)])
TerminateJobObject = signature("TerminateJobObject", w.BOOL, [HANDLE, w.UINT])
TerminateProcess = signature("TerminateProcess", w.BOOL, [HANDLE, w.UINT])
CreateProcess = signature("CreateProcessW", w.BOOL, [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(STARTUPINFOEX), c.POINTER(PROCESS_INFORMATION)])
ResumeThread = signature("ResumeThread", w.DWORD, [HANDLE])
CloseHandle = signature("CloseHandle", w.BOOL, [HANDLE])
WaitForSingleObject = signature("WaitForSingleObject", w.DWORD, [HANDLE, w.DWORD])
GetExitCodeProcess = signature("GetExitCodeProcess", w.BOOL, [HANDLE, c.POINTER(w.DWORD)])
CreatePipe = signature("CreatePipe", w.BOOL, [c.POINTER(HANDLE), c.POINTER(HANDLE), c.POINTER(SECURITY_ATTRIBUTES), w.DWORD])
SetHandleInformation = signature("SetHandleInformation", w.BOOL, [HANDLE, w.DWORD, w.DWORD])
CreateFile = signature("CreateFileW", HANDLE, [w.LPCWSTR, w.DWORD, w.DWORD, c.POINTER(SECURITY_ATTRIBUTES), w.DWORD, w.DWORD, HANDLE])
InitializeProcThreadAttributeList = signature("InitializeProcThreadAttributeList", w.BOOL, [c.c_void_p, w.DWORD, w.DWORD, c.POINTER(SIZE_T)])
UpdateProcThreadAttribute = signature("UpdateProcThreadAttribute", w.BOOL, [c.c_void_p, w.DWORD, SIZE_T, c.c_void_p, SIZE_T, c.c_void_p, c.c_void_p])
DeleteProcThreadAttributeList = signature("DeleteProcThreadAttributeList", None, [c.c_void_p])
OpenProcess = signature("OpenProcess", HANDLE, [w.DWORD, w.BOOL, w.DWORD])
GetProcessTimes = signature("GetProcessTimes", w.BOOL, [HANDLE] + [c.POINTER(w.FILETIME)] * 4)
GetProcessMemoryInfo = signature("K32GetProcessMemoryInfo", w.BOOL, [HANDLE, c.POINTER(MEMORY_COUNTERS), w.DWORD])
GetProcessIoCounters = signature("GetProcessIoCounters", w.BOOL, [HANDLE, c.POINTER(IO_COUNTERS)])
GetProcessHandleCount = signature("GetProcessHandleCount", w.BOOL, [HANDLE, c.POINTER(w.DWORD)])
QueryFullProcessImageName = signature("QueryFullProcessImageNameW", w.BOOL, [HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)])


def checked(value, name):
    if not value:
        # Deliberately omit command lines, environment values and system error text.
        raise OSError(f"{name} failed (Win32 {c.get_last_error()})")
    return value


def emit(message):
    with LOCK:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def ticks(value):
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


def process_times(handle):
    created, exited, kernel, user = (w.FILETIME() for _ in range(4))
    checked(GetProcessTimes(handle, c.byref(created), c.byref(exited), c.byref(kernel), c.byref(user)), "GetProcessTimes")
    return "filetime:" + str(ticks(created)), (ticks(kernel) + ticks(user)) / 10000


class Job:
    def __init__(self):
        self.handle = checked(CreateJobObject(None, None), "CreateJobObject")
        self.process = None
        self.pid = None
        self.threads = []
        self.root_identity = None
        self.exit_thread = None
        limits = EXTENDED_LIMIT()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE, no breakaway.
        try:
            checked(SetInformationJobObject(self.handle, 9, c.byref(limits), c.sizeof(limits)), "SetInformationJobObject")
        except BaseException:
            CloseHandle(self.handle)
            raise

    def launch(self, config):
        executable, args = config["executable"], config.get("args", [])
        if not os.path.isabs(executable) or not isinstance(args, list) or not all(isinstance(s, str) and "\0" not in s for s in [executable] + args):
            raise ValueError("Driver requires an absolute executable and string arguments")
        env = config["env"]
        if not all(isinstance(a, str) and isinstance(b, str) and a and "=" not in a and "\0" not in a + b for a, b in env.items()):
            raise ValueError("Invalid driver environment")
        block = c.create_unicode_buffer("\0".join(f"{a}={b}" for a, b in sorted(env.items(), key=lambda x: x[0].upper())) + "\0\0")
        inheritable = SECURITY_ATTRIBUTES(c.sizeof(SECURITY_ATTRIBUTES), None, True)
        handles = []
        attributes = None
        pi = PROCESS_INFORMATION()
        try:
            read_handles, write_handles = [], []
            for _ in range(2):
                read, write = HANDLE(), HANDLE()
                checked(CreatePipe(c.byref(read), c.byref(write), c.byref(inheritable), 0), "CreatePipe")
                handles.extend([read.value, write.value])
                checked(SetHandleInformation(read, 1, 0), "SetHandleInformation")
                read_handles.append(read.value)
                write_handles.append(write.value)
            null = CreateFile("NUL", 0x80000000, 3, c.byref(inheritable), 3, 0, None)
            if null in (None, c.c_void_p(-1).value):
                checked(False, "CreateFile(NUL)")
            handles.append(null)
            size = SIZE_T()
            InitializeProcThreadAttributeList(None, 1, 0, c.byref(size))
            storage = c.create_string_buffer(size.value)
            attributes = c.cast(storage, c.c_void_p)
            checked(InitializeProcThreadAttributeList(attributes, 1, 0, c.byref(size)), "InitializeProcThreadAttributeList")
            inherited = (HANDLE * 3)(null, *write_handles)
            checked(UpdateProcThreadAttribute(attributes, 0, 0x20002, inherited, c.sizeof(inherited), None, None), "UpdateProcThreadAttribute(HANDLE_LIST)")
            si = STARTUPINFOEX()
            si.StartupInfo.cb = c.sizeof(si)
            si.StartupInfo.dwFlags = 0x100  # STARTF_USESTDHANDLES
            si.StartupInfo.hStdInput, si.StartupInfo.hStdOutput, si.StartupInfo.hStdError = null, *write_handles
            si.lpAttributeList = attributes
            command = c.create_unicode_buffer(subprocess.list2cmdline([executable] + args))
            flags = 0x4 | 0x80000 | 0x400 | 0x8000000  # SUSPENDED | EXTENDED_STARTUPINFO | UNICODE_ENVIRONMENT | NO_WINDOW
            checked(CreateProcess(executable, command, None, None, True, flags, block, config["cwd"], c.byref(si), c.byref(pi)), "CreateProcess(suspended)")
            self.process, self.pid = pi.hProcess, pi.dwProcessId
            checked(AssignProcessToJobObject(self.handle, self.process), "AssignProcessToJobObject")
            member = w.BOOL()
            checked(IsProcessInJob(self.process, self.handle, c.byref(member)), "IsProcessInJob(driver)")
            if not member.value:
                raise RuntimeError("Driver was not assigned to its job")
            created, _ = process_times(self.process)
            self.root_identity = f"{self.pid}:{created}"
            # A test can start and exit immediately; job membership already exists before any code runs.
            if ResumeThread(pi.hThread) == 0xFFFFFFFF:
                checked(False, "ResumeThread")
            emit({"event": "ready", "pid": self.pid, "rootIdentity": self.root_identity,
                  "containment": "windows-job", "assignedBeforeResume": True})
            for channel, read in zip(("stdout", "stderr"), read_handles):
                handles.remove(read)  # Ownership transfers to the reader thread/fd.
                thread = threading.Thread(target=self.forward, args=(channel, read), daemon=True)
                thread.start()
                self.threads.append(thread)
            self.exit_thread = threading.Thread(target=self.watch_exit, daemon=True)
            self.exit_thread.start()
        except BaseException:
            if self.process:
                TerminateProcess(self.process, 1)  # Also covers failed job assignment while suspended.
                WaitForSingleObject(self.process, 5000)
            raise
        finally:
            if pi.hThread:
                CloseHandle(pi.hThread)
            if attributes:
                DeleteProcThreadAttributeList(attributes)
            for handle in handles:
                CloseHandle(handle)

    def forward(self, channel, handle):
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        try:
            while True:
                data = os.read(fd, 65536)
                if not data:
                    break
                emit({"event": channel, "data": base64.b64encode(data).decode("ascii")})
        except OSError:
            emit({"event": "fatal", "error": f"Driver {channel} pipe failed"})
        finally:
            os.close(fd)
            emit({"event": channel + "End"})

    def exited(self):
        result = WaitForSingleObject(self.process, 0)
        if result == 0xFFFFFFFF:
            checked(False, "WaitForSingleObject")
        return result == 0

    def exit_code(self):
        code = w.DWORD()
        checked(GetExitCodeProcess(self.process, c.byref(code)), "GetExitCodeProcess")
        return code.value

    def watch_exit(self):
        try:
            checked(WaitForSingleObject(self.process, 0xFFFFFFFF) != 0xFFFFFFFF, "WaitForSingleObject(driver)")
            emit({"event": "exit", "code": self.exit_code()})
        except BaseException as error:
            emit({"event": "fatal", "error": str(error)})

    def members(self):
        capacity = 64
        while capacity <= 1048576:
            data = c.create_string_buffer(8 + c.sizeof(ULONG_PTR) * capacity)
            ok = QueryInformationJobObject(self.handle, 3, data, len(data), None)
            assigned = w.DWORD.from_buffer(data).value
            count = w.DWORD.from_buffer(data, 4).value
            if ok and assigned <= count:
                return list((ULONG_PTR * count).from_buffer(data, 8))
            if not ok and c.get_last_error() != 234:
                checked(False, "QueryInformationJobObject")
            capacity = max(capacity * 2, assigned)
        raise RuntimeError("Job membership exceeded observer capacity")

    def row(self, pid):
        handle = OpenProcess(0x400 | 0x10 | 0x100000, False, pid)
        if not handle:
            if c.get_last_error() == 87:  # Exited between enumeration and opening; no PID-based cleanup.
                return None
            checked(False, "OpenProcess(job member)")
        try:
            member = w.BOOL()
            checked(IsProcessInJob(handle, self.handle, c.byref(member)), "IsProcessInJob(member)")
            if not member.value:  # PID reused by an unrelated process: never read/kill it.
                return None
            if WaitForSingleObject(handle, 0) == 0:
                return None
            try:
                created, cpu = process_times(handle)
                memory = MEMORY_COUNTERS()
                memory.cb = c.sizeof(memory)
                checked(GetProcessMemoryInfo(handle, c.byref(memory), memory.cb), "GetProcessMemoryInfo")
                io, handles = IO_COUNTERS(), w.DWORD()
                checked(GetProcessIoCounters(handle, c.byref(io)), "GetProcessIoCounters")
                checked(GetProcessHandleCount(handle, c.byref(handles)), "GetProcessHandleCount")
                name, length = c.create_unicode_buffer(32768), w.DWORD(32768)
                checked(QueryFullProcessImageName(handle, 0, name, c.byref(length)), "QueryFullProcessImageName")
                return {"pid": pid, "parent": None, "created": created, "jobMember": True,
                        "name": os.path.basename(name.value), "role": "unknown",
                        # PROCESS_MEMORY_COUNTERS_EX.PrivateUsage and WorkingSetSize are bytes.
                        "cpuMs": cpu, "privateBytes": memory.PrivateUsage, "workingBytes": memory.WorkingSetSize,
                        "handles": handles.value, "readBytes": io.ReadTransferCount, "writeBytes": io.WriteTransferCount}
            except OSError:
                # Windows may revoke image/counter queries during process teardown
                # before the process handle becomes signaled. Confirm actual exit
                # on that same identity-bound handle; a still-live probe failure
                # remains fatal. GitHub reproduction: wait=258 then wait=0.
                if WaitForSingleObject(handle, 2000) == 0:
                    return None
                raise
        finally:
            CloseHandle(handle)

    def sample(self):
        pids = self.members()
        rows = [row for pid in pids if (row := self.row(pid)) is not None]
        exited = self.exited()
        accounting = JOB_ACCOUNTING()
        checked(QueryInformationJobObject(self.handle, 8, c.byref(accounting), c.sizeof(accounting), None), "QueryInformationJobObject(accounting)")
        basic, io = accounting.BasicInfo, accounting.IoInfo
        return {"scope": "windows-job", "at": time.time_ns() // 1000000, "processes": rows,
                "membershipPids": pids, "rootIdentity": self.root_identity, "driverExited": exited,
                "jobAccounting": {"cpuMs": (basic.TotalUserTime + basic.TotalKernelTime) / 10000,
                                  "readBytes": io.ReadTransferCount, "writeBytes": io.WriteTransferCount,
                                  "otherBytes": io.OtherTransferCount, "totalProcesses": basic.TotalProcesses,
                                  "activeProcesses": basic.ActiveProcesses, "terminatedProcesses": basic.TotalTerminatedProcesses},
                "driverExitCode": self.exit_code() if exited else None}

    def terminate(self):
        checked(TerminateJobObject(self.handle, 1), "TerminateJobObject")

    def dispose(self):
        before = self.sample()  # Preserve leaks before terminating them.
        self.terminate()
        deadline = time.monotonic() + 10
        while self.members():
            if time.monotonic() > deadline:
                raise RuntimeError("Job members survived TerminateJobObject")
            time.sleep(0.02)
        for thread in self.threads:
            thread.join(timeout=2)
            if thread.is_alive():
                raise RuntimeError("Driver output pipe did not close after job termination")
        self.exit_thread.join(timeout=2)
        if self.exit_thread.is_alive():
            raise RuntimeError("Driver exit was not acknowledged after job termination")
        return {"beforeCleanup": before, "remaining": [], "cleanupVerified": True}

    def close(self):
        # Closing the only non-inheritable job handle is an unconditional crash/EOF safety net.
        CloseHandle(self.handle)
        if self.process:
            CloseHandle(self.process)


def main():
    job = Job()
    try:
        config_line = sys.stdin.readline()
        if not config_line:
            return
        job.launch(json.loads(config_line))
        for line in sys.stdin:
            request = json.loads(line)
            try:
                operation = request["op"]
                if operation == "sample":
                    result = job.sample()
                elif operation == "terminate":
                    job.terminate()
                    result = {"terminated": True}
                elif operation == "dispose":
                    result = job.dispose()
                else:
                    raise ValueError("Unknown job operation")
                emit({"id": request["id"], "result": result})
                if operation == "dispose":
                    return
            except BaseException as error:
                emit({"id": request["id"], "error": str(error)})
                return  # Observer/control errors close the job, never fall back to ancestry.
    except BaseException as error:
        emit({"event": "fatal", "error": str(error)})
        return 1
    finally:
        job.close()


if __name__ == "__main__":
    raise SystemExit(main())
