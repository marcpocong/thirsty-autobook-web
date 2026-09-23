param([switch]$ListOnly)
$ErrorActionPreference = 'Stop'
# Closes every Chrome window this bot launched and nothing else. A bot browser is
# a chrome.exe browser process whose --user-data-dir lives inside this
# installation's .local folder (A-H API profiles, the practice profile, and any
# investigation profile). The user's own Chrome profile is never under .local.
# Only a JSON summary with counts crosses the process boundary; never metadata.
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.local')).TrimEnd('\') + '\'

function Get-BotBrowsers {
  @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $command = [string]$_.CommandLine
    # Child processes (renderer, GPU, utility) carry --type=; the browser process owns the tree.
    if (-not $command -or $command -match '(?:^|\s)--type=') { return $false }
    $match = [regex]::Match($command, '(?:^|\s)--user-data-dir=(?:"([^"]+)"|([^\s]+))')
    if (-not $match.Success) { return $false }
    $userDataDir = if ($match.Groups[1].Value) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    try { $full = [IO.Path]::GetFullPath($userDataDir).TrimEnd('\') + '\' } catch { return $false }
    $full.StartsWith($localRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

# taskkill writes to stderr when a graceful close finds no window (for example a
# headless or already-closing Chrome). Windows PowerShell would turn that into a
# terminating error under 'Stop', skipping the forced pass, so it is isolated here.
function Invoke-TaskKill([int]$Id, [switch]$Force) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
  try { if ($Force) { & taskkill.exe /PID $Id /T /F 2>&1 | Out-Null } else { & taskkill.exe /PID $Id /T 2>&1 | Out-Null } }
  catch {} finally { $ErrorActionPreference = $previous }
}

function Wait-Closed([int[]]$Ids, [int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $alive = @($Ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($alive.Count -eq 0) { return @() }
    Start-Sleep -Milliseconds 200
  } until ([DateTime]::UtcNow -ge $deadline)
  return $alive
}

$browsers = Get-BotBrowsers
$ids = @($browsers | ForEach-Object { [int]$_.ProcessId })
if ($ListOnly) { Write-Output (@{ found = $ids.Count; code = 'BOT_BROWSERS_LISTED' } | ConvertTo-Json -Compress); exit 0 }
$forced = 0
if ($ids.Count -gt 0) {
  # Graceful first: WM_CLOSE lets Chrome flush its profile like a normal window close.
  foreach ($id in $ids) { Invoke-TaskKill $id }
  $remaining = Wait-Closed $ids 6
  foreach ($id in $remaining) { Invoke-TaskKill $id -Force; $forced++ }
  $remaining = Wait-Closed $remaining 6
  if ($remaining.Count -gt 0) {
    Write-Output (@{ found = $ids.Count; closed = $ids.Count - $remaining.Count; forced = $forced; code = 'BOT_BROWSER_CLOSE_TIMEOUT' } | ConvertTo-Json -Compress)
    exit 1
  }
}
Write-Output (@{ found = $ids.Count; closed = $ids.Count; forced = $forced; code = 'BOT_BROWSERS_CLOSED' } | ConvertTo-Json -Compress)
