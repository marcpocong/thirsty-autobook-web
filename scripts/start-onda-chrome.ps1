param([ValidateSet('A','B')][string]$Worker = 'A', [ValidateScript({ $_ -eq 0 -or ($_ -ge 1024 -and $_ -le 65535) })][int]$Port = 0)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$endpointFile = Join-Path $projectRoot '.local\browser-endpoints.json'
$port = $Port
if ($port -eq 0 -and (Test-Path -LiteralPath $endpointFile)) {
  try {
    $saved = Get-Content -LiteralPath $endpointFile -Raw | ConvertFrom-Json
    $candidate = if ($Worker -eq 'B') { $saved.B } else { $saved.A }
    if ($saved.version -eq 1 -and $candidate -ge 1024 -and $candidate -le 65535) { $port = [int]$candidate }
  } catch {}
}
if ($port -eq 0) { $port = if ($env:THIRSTY_API_TEST_INSTALLATION -eq '1') { if ($Worker -eq 'B') { 19445 } else { 19444 } } else { if ($Worker -eq 'B') { 9223 } else { 9222 } } }
$profile = if ($env:THIRSTY_API_TEST_INSTALLATION -eq '1') { if ($Worker -eq 'B') { '.local\api-first-chrome-profile-b' } else { '.local\api-first-chrome-profile' } } else { if ($Worker -eq 'B') { '.local\onda-chrome-profile-b' } else { '.local\onda-chrome-profile' } }
$profilePath = Join-Path $projectRoot $profile
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { Write-Error 'CHROME_NOT_INSTALLED'; exit 1 }
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
$arguments = @(
  "--remote-debugging-port=$port", '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=`"$profilePath`"", '--no-first-run', '--no-default-browser-check',
  'https://app.onda.fit/book/thirsty-pickle'
)
Start-Process -FilePath $chromePath -ArgumentList $arguments
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 200
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
} until ($listeners.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline)
if ($listeners.Count -eq 0) { Write-Error 'CHROME_START_TIMEOUT'; exit 1 }
$verification = & (Join-Path $PSScriptRoot 'verify-onda-chrome.ps1') -Port $port -ExpectedProfile $profilePath
if ($verification -ne 'CDP_VERIFIED') { Write-Host $verification; exit 1 }
Write-Host 'Dedicated Chrome ready; localhost-only CDP and dedicated profile verified.'
