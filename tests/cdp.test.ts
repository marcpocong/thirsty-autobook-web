import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
it.skipIf(process.platform !== 'win32')('classifies listener/profile failures without returning process metadata', () => {
  const script = String.raw`
    function Get-NetTCPConnection { if($script:metadataFailure){throw 'secret-command'}; return $script:listeners }
    function Get-CimInstance { return $script:processMetadata }
    $script:listeners=@()
    . ./scripts/verify-onda-chrome.ps1
    $script:listeners=@([pscustomobject]@{LocalPort=9222;LocalAddress='0.0.0.0';OwningProcess=1})
    Get-DedicatedChromeCode
    $script:listeners=@([pscustomobject]@{LocalPort=9222;LocalAddress='127.0.0.1';OwningProcess=1},[pscustomobject]@{LocalPort=9222;LocalAddress='::1';OwningProcess=2})
    Get-DedicatedChromeCode
    $script:listeners=@([pscustomobject]@{LocalPort=9222;LocalAddress='127.0.0.1';OwningProcess=1})
    $script:processMetadata=$null
    Get-DedicatedChromeCode
    $script:processMetadata=[pscustomobject]@{Name='other.exe';CommandLine='secret-command'}
    Get-DedicatedChromeCode
    $script:processMetadata=[pscustomobject]@{Name='chrome.exe';CommandLine='secret-command'}
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --user-data-dir="C:\wrong" secret-command'
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --user-data-dir="'+$ExpectedProfile+'" secret-command'
    Get-DedicatedChromeCode
    $script:metadataFailure=$true
    Get-DedicatedChromeCode
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile','-Command',script], {encoding:'utf8',windowsHide:true});
  expect(output.trim().split(/\r?\n/)).toEqual(['CDP_NOT_LISTENING','CDP_UNSAFE_BIND','CDP_AMBIGUOUS_LISTENER',
    'CDP_PROCESS_METADATA_UNAVAILABLE','CDP_PROCESS_NOT_CHROME','CDP_PROFILE_MISSING','CDP_WRONG_PROFILE','CDP_VERIFIED','CDP_PROCESS_METADATA_UNAVAILABLE']);
  expect(output).not.toContain('secret-command');
});
it('launcher shares verification, reuses only verified sessions and never kills a listener', () => {
  const source = readFileSync('scripts/start-onda-chrome.ps1','utf8');
  expect(source).toContain('verify-onda-chrome.ps1');
  expect(source).toContain("$verification -eq 'CDP_VERIFIED'");
  expect(source).toContain("$verification -ne 'CDP_NOT_LISTENING'");
  expect(source).not.toMatch(/Stop-Process|taskkill/i);
});
