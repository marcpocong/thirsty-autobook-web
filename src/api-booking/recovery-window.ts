import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** External operator/CLI recovery must not add work beside a live dispatcher.
 * Held and proven orphaned past-dispatch locks are read-only recovery contexts,
 * never permission to delete a lock or submit another booking.
 */
export async function assertRecoveryWindow(root:string,now=new Date()):Promise<void>{
  let lock;try{lock=JSON.parse(await readFile(join(root,'.local/automation.lock'),'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('RECOVERY_AUTOMATION_STATE_UNKNOWN');}
  if(lock.stage==='HOLD_VERIFIED')return;
  if(lock.stage!=='FINAL_ACTION_DISPATCHING'||!Number.isInteger(lock.pid)||lock.pid<=0)throw Error('RECOVERY_DISPATCH_ACTIVE_OR_UNRESOLVED');
  const deadline=lock.dispatchDeadlineAt??lock.releaseAt;
  if(deadline!==undefined&&(!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)+1000>=now.getTime()))throw Error('RECOVERY_DISPATCH_ACTIVE_OR_UNRESOLVED');
  let absent=false;try{process.kill(lock.pid,0);}catch(e){absent=(e as NodeJS.ErrnoException).code==='ESRCH';}
  if(!absent)throw Error('RECOVERY_DISPATCH_ACTIVE_OR_UNRESOLVED');
}
