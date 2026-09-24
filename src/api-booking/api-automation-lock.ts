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
  // Independent lanes (A-D, E/F, G/H) may call dispatching()/held()/release()
  // at nearly the same time. The underlying atomic write reuses one per-process
  // temp file path, so concurrent writers must never overlap; serialize every
  // mutation through this queue instead.
  private queue:Promise<void>=Promise.resolve();

  private constructor() {}

  private enqueue(task:()=>Promise<void>):Promise<void>{
    const run=this.queue.then(task,task);
    this.queue=run.catch(()=>undefined);
    return run;
  }

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

  /**
   * Precision pre-release arm: one durable rewrite well before T-0, so the release
   * instant itself needs no lock I/O. From here recovery must assume a POST may have
   * left once releaseAt has passed.
   */
  async armed(releaseMs:number,dispatchDeadlineMs:number,armedCount:number){
    if(!Number.isSafeInteger(releaseMs)||!Number.isSafeInteger(dispatchDeadlineMs)||dispatchDeadlineMs<releaseMs||!Number.isInteger(armedCount)||armedCount<1)
      throw Error('LOCK_ARM_INVALID');
    await this.enqueue(()=>this.write('FINAL_ACTION_ARMED',{armedAt:new Date().toISOString(),releaseAt:new Date(releaseMs).toISOString(),
      dispatchDeadlineAt:new Date(dispatchDeadlineMs).toISOString(),armedCount}));
  }
  async dispatching(){await this.enqueue(()=>this.write('FINAL_ACTION_DISPATCHING'));}
  async held(holdExpiresAt:string){
    if(!Number.isFinite(Date.parse(holdExpiresAt))||Date.parse(holdExpiresAt)<=Date.now())throw Error('HOLD_EXPIRY_INVALID');
    await this.enqueue(()=>this.write('HOLD_VERIFIED',{holdVerifiedAt:new Date().toISOString(),holdExpiresAt}));
  }
  async release(){
    await this.enqueue(async()=>{
      if(this.released)return;
      await removeOwnedRecord(this.path,this.identity.pid,this.identity.runID);this.released=true;
    });
  }
}
