param([ValidateSet('A','B','C','D','E','F','G','H')][string]$Worker = 'A', [ValidateScript({ $_ -eq 0 -or ($_ -ge 1024 -and $_ -le 65535) })][int]$Port = 0)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$endpointFile = Join-Path $projectRoot '.local\browser-endpoints.json'
$port = $Port
if ($port -eq 0 -and (Test-Path -LiteralPath $endpointFile)) {
  try {
    $saved = Get-Content -LiteralPath $endpointFile -Raw | ConvertFrom-Json
    $candidate = $saved.$Worker
    if ($saved.version -eq 1 -and $candidate -ge 1024 -and $candidate -le 65535) { $port = [int]$candidate }
  } catch {}
}
$apiInstallation = $env:THIRSTY_API_INSTALLATION -eq '1' -or $env:THIRSTY_API_TEST_INSTALLATION -eq '1'
$workerOffset = @{ A = 0; B = 1; C = 2; D = 3; E = 4; F = 5; G = 6; H = 7 }[$Worker]
if ($port -eq 0) { $port = $(if ($apiInstallation) { 19444 } else { 9222 }) + $workerOffset }
$profileBase = if ($apiInstallation) { '.local\api-first-chrome-profile' } else { '.local\onda-chrome-profile' }
$profile = if ($Worker -eq 'A') { $profileBase } else { "$profileBase-$($Worker.ToLowerInvariant())" }
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
