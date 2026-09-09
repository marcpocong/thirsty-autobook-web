$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $projectRoot '.local\onda-chrome-profile'
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome is not installed.' }
$listeners = @(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }) { throw 'UNSAFE_CDP_BIND: port 9222 is exposed beyond localhost.' }
  Write-Host 'Port 9222 is already listening. Reusing is subject to CDP profile validation; no new Chrome opened.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
# This is the visible, interactive browser requested by the user.
Start-Process -FilePath $chromePath -ArgumentList @(
  '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=`"$profilePath`"", '--no-first-run', '--no-default-browser-check',
  'https://app.onda.fit/book/thirsty-pickle'
)
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 200
  $listeners = @(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
} until ($listeners.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline)
if ($listeners.Count -eq 0) { throw 'Chrome CDP did not start within 15 seconds.' }
if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }) { throw 'UNSAFE_CDP_BIND: do not attach.' }
Write-Host 'Dedicated Chrome ready; localhost-only CDP verified on port 9222.'
