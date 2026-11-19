# Windows stand-in for /proc/<pid>/cwd: prints "<pid>`t<cwd>" for every process with this name.
# The working directory is read from the process's PEB (x64 offsets), which is the only place
# Windows keeps it. Processes we can't open (other users, protected) are skipped.
# Usage: powershell -NoProfile -File tests/proc-cwd.ps1 [name]   (default: claude)
param([string]$Name = 'claude')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ProcCwd {
  [StructLayout(LayoutKind.Sequential)]
  struct PBI { public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority, UniqueProcessId, InheritedFrom; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  static byte[] Read(IntPtr h, long addr, int size) {
    var b = new byte[size]; IntPtr n;
    if (!ReadProcessMemory(h, new IntPtr(addr), b, size, out n)) throw new Exception("read");
    return b;
  }
  public static string Get(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid); // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) return null;
    try {
      var pbi = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      long parms = BitConverter.ToInt64(Read(h, pbi.PebBaseAddress.ToInt64() + 0x20, 8), 0);
      byte[] us = Read(h, parms + 0x38, 16); // RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath
      int len = BitConverter.ToUInt16(us, 0);
      long buf = BitConverter.ToInt64(us, 8);
      return Encoding.Unicode.GetString(Read(h, buf, len));
    } catch { return null; } finally { CloseHandle(h); }
  }
}
'@
foreach ($p in Get-Process -Name $Name -ErrorAction SilentlyContinue) {
  $cwd = [ProcCwd]::Get($p.Id)
  if ($cwd) { "{0}`t{1}" -f $p.Id, $cwd.TrimEnd('\') }
}
