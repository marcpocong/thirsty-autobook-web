import { resolve, relative, isAbsolute,dirname } from 'node:path';
import { realpath } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PendingHoldService} from '../src/api-booking/pending-hold-service.js';
import {recoveryHash} from '../src/api-booking/checkout-recovery.js';
import {assertCanonicalRecoveryRuntime} from '../src/api-booking/recovery-runtime.js';

// Restore only an existing, exactly revalidated reservation. There is no submit,
// retry, cancellation, journal mutation, or payment-completion code in this tool.
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help') {
    console.log('From the canonical installed root: npm run checkout:recover -- --list | --recover <opaque-id> [original|fresh] | <original-journal-directory>\nIndependently verifies and reopens only the original reservation. Never submits a booking or pays.');
    return;
  }
  if(resolve(dirname(fileURLToPath(import.meta.url)),'..')!==resolve('.'))throw Error('RECOVERY_REQUIRES_INSTALLED_ENTRY_POINT');
  process.env.THIRSTY_API_INSTALLATION='1';
  const service=new PendingHoldService(resolve('.'));
  if(args.length===1&&args[0]==='--list'){console.log(JSON.stringify({rows:await service.list()}));return;}
  await assertCanonicalRecoveryRuntime(resolve('.'));
  let id:string,mode:'original'|'fresh'='fresh';
  if(args[0]==='--recover'&&(args.length===2||args.length===3)){
    id=args[1]!;if(args[2]!==undefined&&!['original','fresh'].includes(args[2]))throw Error('RECOVERY_MODE_INVALID');mode=(args[2] as typeof mode)??mode;
  }else if(args.length===1){
    const root=await realpath(resolve('.local/api-booking/api-first-journals')),directory=await realpath(resolve(args[0]!)),child=relative(root,directory);
    if(!child||child.startsWith('..')||isAbsolute(child))throw Error('CHECKOUT_RECOVERY_DIRECTORY_INVALID');
    id=recoveryHash(child.replaceAll('\\','/'));
  }else throw Error('CHECKOUT_RECOVERY_DIRECTORY_REQUIRED');
  const outcome=await service.recover(id,mode);
  console.log(JSON.stringify({outcome,paymentAutomated:false,newBookingSubmissions:0,journalsUnchanged:true}));
  if(outcome.qr!=='QR_READY')process.exitCode=1;
}
main().catch(error=>{
  // Never print browser errors, URLs, tokens, raw captures, or provider bodies.
  const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'CHECKOUT_RECOVERY_FAILED';
  console.error(code);process.exitCode=1;
});
