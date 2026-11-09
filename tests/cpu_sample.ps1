# CPU usage of the isolated test Brave (processes whose command line contains the given profile dir).
# usage: powershell -File cpu_sample.ps1 -Profile brave-profile-dev -Seconds 8
param([string]$Profile = 'brave-profile-dev', [int]$Seconds = 8)
function Snap {
  $h = @{}
  Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -like "*$Profile*" } | ForEach-Object {
    $type = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }
    if ($_.CommandLine -match '--utility-sub-type=([\w.]+)') { $type += ':' + $Matches[1] }
    $h[$_.ProcessId] = @{ t = ($_.KernelModeTime + $_.UserModeTime) / 1e7; type = $type }
  }
  $h
}
$a = Snap; $t0 = Get-Date
Start-Sleep -Seconds $Seconds
$b = Snap; $dt = ((Get-Date) - $t0).TotalSeconds
$cores = [Environment]::ProcessorCount
$rows = foreach ($k in $b.Keys) { if ($a.ContainsKey($k)) { [pscustomobject]@{ pid = $k; type = $b[$k].type; cpuSec = [math]::Round($b[$k].t - $a[$k].t, 2) } } }
$rows | Where-Object { $_.cpuSec -gt 0.05 } | Sort-Object cpuSec -Descending | ForEach-Object { '{0,-28} pid {1,-6} {2,6:N2} s  = {3,5:N1}% of one core' -f $_.type, $_.pid, $_.cpuSec, (100 * $_.cpuSec / $dt) }
$tot = ($rows | Measure-Object cpuSec -Sum).Sum
'TOTAL {0:N2} s CPU in {1:N1} s = {2:N1}% of one core ({3:N1}% of all {4} logical cores)' -f $tot, $dt, (100 * $tot / $dt), (100 * $tot / $dt / $cores), $cores
