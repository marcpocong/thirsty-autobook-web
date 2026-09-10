$projectRoot = Split-Path -Parent $PSScriptRoot
$profilePath = (Join-Path $projectRoot '.local\onda-chrome-profile') -replace '/', '\'
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $rawCommand = $_.CommandLine
  if ($null -eq $rawCommand) { $rawCommand = '' }
  $command = ($rawCommand -replace '/', '\')
  $command.Contains('--remote-debugging-port=9222') -and $command.Contains('--user-data-dir=') -and $command.Contains($profilePath)
})
if ($processes.Count -eq 0) {
  $listeners = @(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) { throw 'DEDICATED_CHROME_NOT_IDENTIFIED' }
  Write-Host 'Dedicated Chrome is already closed.'
  exit 0
}

# Only the browser process carrying this project profile and this loopback CDP
# port is eligible. The task tree never includes the user's normal Chrome.
$browser = $processes | Select-Object -First 1
& taskkill.exe /PID $browser.ProcessId /T /F | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  Start-Sleep -Milliseconds 200
  $listeners = @(Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
} until ($listeners.Count -eq 0 -or [DateTime]::UtcNow -ge $deadline)
if ($listeners.Count -gt 0) { throw 'DEDICATED_CHROME_CLOSE_TIMEOUT' }
Write-Host 'Dedicated Chrome closed.'
