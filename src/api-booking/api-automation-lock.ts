import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { lifecycleWriter, removeOwnedRecord } from '../checkout-lifecycle.js';
import type { WorkerId } from '../workers.js';

/** Global cross-mode lock for API checkout attempts and retained payment holds. */
export class ApiAutomationLock {
  private readonly path=resolve('.local/automation.lock');
  private readonly identity={pid:process.pid,runID:randomUUID()};
  private readonly write=lifecycleWriter(this.path,this.identity);
  private released=false;

  private constructor() {}

  static async acquire(mode:'standard'|'extended',workers:readonly WorkerId[]) {
    const lock=new ApiAutomationLock();
    await mkdir(dirname(lock.path),{recursive:true,mode:0o700});
    const handle=await open(lock.path,'wx',0o600).catch(()=>{throw Error('AUTOMATION_LOCK_EXISTS');});
    try{
      const at=new Date().toISOString();
      await handle.writeFile(JSON.stringify({...lock.identity,mode,workers,stage:'API_READY',stageAt:at}));
      await handle.sync();
    }finally{await handle.close();}
    return lock;
  }

  async dispatching(){await this.write('FINAL_ACTION_DISPATCHING');}
  async held(holdExpiresAt:string){
    if(!Number.isFinite(Date.parse(holdExpiresAt))||Date.parse(holdExpiresAt)<=Date.now())throw Error('HOLD_EXPIRY_INVALID');
    await this.write('HOLD_VERIFIED',{holdVerifiedAt:new Date().toISOString(),holdExpiresAt});
  }
  async release(){if(this.released)return;await removeOwnedRecord(this.path,this.identity.pid,this.identity.runID);this.released=true;}
}
