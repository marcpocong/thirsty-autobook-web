import {execFileSync} from 'node:child_process';
import {shotgunMachineKey} from '../src/shotgun-timing.js';

/** Probe the executable used by createRunner, never the Electron controller's embedded Node.
 * No profile is rewritten. An unavailable runtime produces no applicable calibration. */
export function readDispatcherMachineKey(executable:string):string|null {
  try {
    const version=execFileSync(executable,['--version'],{encoding:'utf8',windowsHide:true,timeout:5_000,maxBuffer:16_384}).trim();
    // The dispatcher is a child on this same host; only its Node runtime differs from Electron.
    return /^v\d+\.\d+\.\d+$/.test(version)?shotgunMachineKey(version):null;
  }catch{return null;}
}
