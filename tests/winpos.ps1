# Get / set a window's position without activating it (SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSIZE).
# usage: winpos.ps1 -Hwnd <decimal> [-X <int> -Y <int>]
param([Parameter(Mandatory)][long]$Hwnd, [Nullable[int]]$X, [Nullable[int]]$Y)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class WP {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h = [IntPtr]$Hwnd
if (-not [WP]::IsWindow($h)) { 'not a window'; exit 1 }
if ($X -ne $null -and $Y -ne $null) {
  # SWP_NOSIZE 0x1 | SWP_NOZORDER 0x4 | SWP_NOACTIVATE 0x10
  [void][WP]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0, 0x15)
}
$r = New-Object WP+RECT; [void][WP]::GetWindowRect($h, [ref]$r)
$sb = New-Object System.Text.StringBuilder 300; [void][WP]::GetWindowText($h, $sb, 300)
'{0}x{1} at ({2},{3}) "{4}"' -f ($r.R - $r.L), ($r.B - $r.T), $r.L, $r.T, $sb.ToString()
