param([ValidateSet('A','B')][string]$Worker = 'A')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = if ($Worker -eq 'B') { 9223 } else { 9222 }
$profile = if ($Worker -eq 'B') { '.local\onda-chrome-profile-b' } else { '.local\onda-chrome-profile' }
$profilePath = Join-Path $projectRoot $profile
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome is not installed.' }
$verification = & (Join-Path $PSScriptRoot 'verify-onda-chrome.ps1') -Port $port -ExpectedProfile $profilePath
if ($verification -eq 'CDP_VERIFIED') {
  Write-Host 'Dedicated Chrome verified. Reusing the existing localhost session.'
  exit 0
}
if ($verification -ne 'CDP_NOT_LISTENING') {
  Write-Host 'WRONG OR UNVERIFIED CDP SESSION DETECTED. Close the conflicting debug session and use Start / Attach Chrome.'
  Write-Host $verification
  exit 1
}
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
# This is the visible, interactive browser requested by the user.
Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$port", '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=`"$profilePath`"", '--no-first-run', '--no-default-browser-check',
  'https://app.onda.fit/book/thirsty-pickle'
)
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 200
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
} until ($listeners.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline)
if ($listeners.Count -eq 0) { throw 'Chrome CDP did not start within 15 seconds.' }
$verification = & (Join-Path $PSScriptRoot 'verify-onda-chrome.ps1') -Port $port -ExpectedProfile $profilePath
if ($verification -ne 'CDP_VERIFIED') { Write-Host $verification; exit 1 }
Write-Host 'Dedicated Chrome ready; localhost-only CDP and dedicated profile verified.'
