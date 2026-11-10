# Memory of the isolated test browser's renderer processes (private bytes / working set, MB).
param([string]$Profile = 'test-profile', [string]$Exe = $(if ($env:BROWSER) { Split-Path $env:BROWSER -Leaf } else { 'brave.exe' }))
Get-CimInstance Win32_Process -Filter "Name='$Exe'" | Where-Object { $_.CommandLine -like "*$Profile*" -and $_.CommandLine -match '--type=renderer' } | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($p) { '{0,-6} private {1,7:N0} MB  ws {2,7:N0} MB' -f $p.Id, ($p.PrivateMemorySize64 / 1MB), ($p.WorkingSet64 / 1MB) }
}
