$ErrorActionPreference = 'Stop'
foreach ($worker in @('A','B')) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-onda-chrome.ps1') -Worker $worker
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
Write-Host 'Both dedicated Chrome windows are available. Keep both Onda tabs visible.'
