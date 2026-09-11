param([string]$ExpectedProfile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.local\onda-chrome-profile'))
$ErrorActionPreference = 'Stop'
# Only a closed diagnostic code crosses the process boundary. Never print metadata.
function Get-DedicatedChromeCode {
  try { $listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 9222) }
  catch { return 'CDP_PROCESS_METADATA_UNAVAILABLE' }
  if ($listeners.Count -eq 0) { return 'CDP_NOT_LISTENING' }
  if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }) { return 'CDP_UNSAFE_BIND' }
  $owners = @($listeners.OwningProcess | Select-Object -Unique)
  if ($owners.Count -ne 1) { return 'CDP_AMBIGUOUS_LISTENER' }
  try { $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owners[0]) }
  catch { return 'CDP_PROCESS_METADATA_UNAVAILABLE' }
  if (-not $process -or -not $process.Name -or -not $process.CommandLine) { return 'CDP_PROCESS_METADATA_UNAVAILABLE' }
  if ($process.Name -ine 'chrome.exe') { return 'CDP_PROCESS_NOT_CHROME' }
  $profiles = [regex]::Matches($process.CommandLine, '(?:^|\s)--user-data-dir=(?:"([^"]+)"|([^\s]+))')
  if ($profiles.Count -eq 0) { return 'CDP_PROFILE_MISSING' }
  if ($profiles.Count -ne 1) { return 'CDP_WRONG_PROFILE' }
  $profile = $profiles[0].Groups[1].Value
  if (-not $profile) { $profile = $profiles[0].Groups[2].Value }
  try {
    if (-not [IO.Path]::IsPathRooted($profile) -or [IO.Path]::GetFullPath($profile).TrimEnd('\') -ine [IO.Path]::GetFullPath($ExpectedProfile).TrimEnd('\')) { return 'CDP_WRONG_PROFILE' }
  } catch { return 'CDP_WRONG_PROFILE' }
  return 'CDP_VERIFIED'
}
Get-DedicatedChromeCode
