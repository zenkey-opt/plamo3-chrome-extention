# Foreground window: process name, title, rect (to avoid stealing focus from a game).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class F {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO l);
}
"@
$h = [F]::GetForegroundWindow(); $p = 0; [void][F]::GetWindowThreadProcessId($h, [ref]$p)
$sb = New-Object System.Text.StringBuilder 300; [void][F]::GetWindowText($h, $sb, 300)
$r = New-Object F+RECT; [void][F]::GetWindowRect($h, [ref]$r)
$li = New-Object F+LASTINPUTINFO; $li.cbSize = 8; [void][F]::GetLastInputInfo([ref]$li)
$idle = ([Environment]::TickCount - $li.dwTime) / 1000
'{0} (pid {1}) "{2}" {3}x{4} at ({5},{6}); user idle {7:N0} s' -f (Get-Process -Id $p).ProcessName, $p, $sb.ToString(), ($r.R - $r.L), ($r.B - $r.T), $r.L, $r.T, $idle
