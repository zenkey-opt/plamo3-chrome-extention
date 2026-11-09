# List visible top-level windows of the isolated test Brave (profile dir in its command line) with real screen rects.
param([string]$Profile = 'brave-profile-dev')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
$pids = @(Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -like "*$Profile*" } | ForEach-Object { [uint32]$_.ProcessId })
$out = New-Object System.Collections.ArrayList
[W]::EnumWindows({ param($h, $l)
  $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)
  if ($pids -contains $p -and [W]::IsWindowVisible($h)) {
    $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
    $sb = New-Object System.Text.StringBuilder 200; [void][W]::GetWindowText($h, $sb, 200)
    [void]$out.Add(('{0}x{1} at ({2},{3}) iconic={4} "{5}"' -f ($r.R - $r.L), ($r.B - $r.T), $r.L, $r.T, [W]::IsIconic($h), $sb.ToString()))
  }
  $true }, [IntPtr]::Zero) | Out-Null
if ($out.Count) { $out } else { 'no visible windows' }
