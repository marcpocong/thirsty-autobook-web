import { it, expect,vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {browserIdentity,candidateBrowserIdentity} from '../src/browser.js';
import {startForPreparation} from '../src/booking-prepare.js';
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
    $script:processMetadata.CommandLine='chrome --remote-debugging-port=9222 --user-data-dir="C:\wrong" secret-command'
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --remote-debugging-port=9222 --user-data-dir="'+$ExpectedProfile+'" secret-command'
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
  expect(source).toContain('browser-endpoints.json');
  expect(source).toContain("[ValidateScript({ $_ -eq 0 -or ($_ -ge 1024 -and $_ -le 65535) })][int]$Port");
  expect(source).not.toMatch(/Stop-Process|taskkill/i);
});
it('keeps the control panel diagnostic port separate from every API Chrome worker',()=>{
  const launcher=readFileSync('scripts/run-thirsty-pickle-bot.mjs','utf8');
  const match=launcher.match(/--remote-debugging-port=(\d+)/);
  expect(match).not.toBeNull();
  const panelPort=Number(match![1]);
  const previous=process.env.THIRSTY_API_TEST_INSTALLATION;
  try{
    process.env.THIRSTY_API_TEST_INSTALLATION='1';
    expect(['A','B','C','D'].map(id=>browserIdentity(id as 'A'|'B'|'C'|'D').port)).not.toContain(panelPort);
  }finally{if(previous===undefined)delete process.env.THIRSTY_API_TEST_INSTALLATION;else process.env.THIRSTY_API_TEST_INSTALLATION=previous;}
});
it.skipIf(process.platform !== 'win32')('B rejects A profile, wrong debugging port, unsafe binding, duplicate owning processes and duplicate profiles',()=>{
  const script=String.raw`
    function Get-NetTCPConnection { return $script:listeners }
    function Get-CimInstance { return $script:processMetadata }
    $script:listeners=@()
    . ./scripts/verify-onda-chrome.ps1 -Port 9223 -ExpectedProfile (Join-Path (Get-Location) '.local/onda-chrome-profile-b')
    $script:listeners=@([pscustomobject]@{LocalPort=9223;LocalAddress='127.0.0.1';OwningProcess=2})
    $script:processMetadata=[pscustomobject]@{Name='chrome.exe';CommandLine='chrome --remote-debugging-port=9223 --user-data-dir="'+$ExpectedProfile+'" private-marker'}
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --remote-debugging-port=9223 --user-data-dir="'+(Join-Path (Get-Location) '.local/onda-chrome-profile')+'" private-marker'
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --remote-debugging-port=9222 --user-data-dir="'+$ExpectedProfile+'" private-marker'
    Get-DedicatedChromeCode
    $script:processMetadata.CommandLine='chrome --remote-debugging-port=9223 --user-data-dir="'+$ExpectedProfile+'" --user-data-dir="'+$ExpectedProfile+'" private-marker'
    Get-DedicatedChromeCode
    $script:listeners=@([pscustomobject]@{LocalPort=9223;LocalAddress='0.0.0.0';OwningProcess=2})
    Get-DedicatedChromeCode
    $script:listeners=@([pscustomobject]@{LocalPort=9223;LocalAddress='127.0.0.1';OwningProcess=2},[pscustomobject]@{LocalPort=9223;LocalAddress='::1';OwningProcess=3})
    Get-DedicatedChromeCode
  `;
  const output=execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true});
  expect(output.trim().split(/\r?\n/)).toEqual(['CDP_NOT_LISTENING','CDP_VERIFIED','CDP_WRONG_PROFILE','CDP_WRONG_PORT','CDP_WRONG_PROFILE','CDP_UNSAFE_BIND','CDP_AMBIGUOUS_LISTENER']);expect(output).not.toContain('private-marker');
});
it('does not persist failed fallback candidates and commits only a verified replacement',async()=>{
  const initial=candidateBrowserIdentity('A',9222),attempts:number[]=[],persisted:number[]=[];
  const launch=vi.fn(async(identity:typeof initial)=>{attempts.push(identity.port);if(identity.port!==19224)throw Error('CDP_WRONG_PORT');});
  const verify=vi.fn((identity:typeof initial)=>{expect(identity.cdpUrl).toBe(`http://127.0.0.1:${identity.port}`);});
  const result=await startForPreparation(initial,{available:async()=>true,launch,verify,persist:(id,port)=>{persisted.push(port);return candidateBrowserIdentity(id,port);}});
  expect(attempts).toEqual([9222,19222,19224]);expect(persisted).toEqual([19224]);expect(verify).toHaveBeenCalledOnce();expect(result.port).toBe(19224);
});
