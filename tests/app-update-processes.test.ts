import { describe,it,expect,vi } from 'vitest';
import { execFileSync } from 'node:child_process';
vi.mock('node:child_process',async importOriginal=>{
  const original=await importOriginal<typeof import('node:child_process')>();
  return {...original,execFileSync:vi.fn(()=> '[]')};
});
// @ts-expect-error plain ESM installation helper
import { windowsProcesses } from '../scripts/app-installation.mjs';

describe.skipIf(process.platform!=='win32')('Windows update process query serialization',()=>{
  it.each([0,1,2])('keeps %i synthetic process records as an array',async count=>{
    vi.mocked(execFileSync).mockClear();
    expect(windowsProcesses()).toEqual([]);
    const args=vi.mocked(execFileSync).mock.calls[0]![1] as string[];
    const command=args[args.indexOf('-Command')+1]!;
    const synthetic=Array.from({length:count},(_,i)=>`[pscustomobject]@{Name='node.exe';ProcessId=${i+1};ExecutablePath='C:\\fixture\\node.exe';CommandLine='synthetic';CreationDate=[datetime]'2026-10-01T00:00:00Z'}`).join(';');
    const original=await vi.importActual<typeof import('node:child_process')>('node:child_process');
    // Override the CIM query in the child process; no real process or installation state is inspected.
    const output=original.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`function Get-CimInstance { ${synthetic} }; ${command}`],{encoding:'utf8',windowsHide:true});
    const result=JSON.parse(output);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(count);
    if(count)expect(result[0]).toMatchObject({ProcessId:1,CommandLine:'synthetic',CreatedMs:Date.parse('2026-10-01T00:00:00Z')});
  });
});
