$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $projectRoot '.local\api-booking\native-hybrid-profile'
$port = 19333
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chromePath) { throw 'CHROME_NOT_INSTALLED' }
$verification = & (Join-Path $PSScriptRoot 'verify-onda-chrome.ps1') -Port $port -ExpectedProfile $profilePath
if ($verification -eq 'CDP_VERIFIED') { Write-Output 'HYBRID_DEV_CHROME_VERIFIED'; exit 0 }
if ($verification -ne 'CDP_NOT_LISTENING') { throw "HYBRID_DEV_CHROME_CONFLICT: $verification" }
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$port", '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=`"$profilePath`"", '--no-first-run', '--no-default-browser-check',
  'https://app.onda.fit/book/thirsty-pickle'
) -WindowStyle Normal
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 200
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
} until ($listeners.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline)
if ($listeners.Count -eq 0) { throw 'HYBRID_DEV_CHROME_START_TIMEOUT' }
$verification = & (Join-Path $PSScriptRoot 'verify-onda-chrome.ps1') -Port $port -ExpectedProfile $profilePath
if ($verification -ne 'CDP_VERIFIED') { throw "HYBRID_DEV_CHROME_NOT_VERIFIED: $verification" }
Write-Output 'HYBRID_DEV_CHROME_VERIFIED'
