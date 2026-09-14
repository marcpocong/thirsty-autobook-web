import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { TestBookingSchema, type BookingPlan } from './booking-plan.js';
import { resetAndPrepare } from './booking-prepare.js';
import { runBooking } from './booking-runtime.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import { emitUiEvent } from './ui-events.js';

const safety=new Safety(),t=new Telemetry();
const stop=()=>{safety.stop('USER_ABORT');process.exit(130);};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
if(process.connected){process.once('disconnect',stop);process.on('message',m=>{if((m as any)?.type==='abort')stop();});}
async function confirm(plan:BookingPlan){
  if(!process.connected)throw Error('TEST_CONFIRMATION_REQUIRED');
  return new Promise<boolean>((resolve,reject)=>{
    const timer=setTimeout(()=>{process.off('message',listener);reject(Error('CONFIRMATION_EXPIRED'));},300000);
    const listener=(m:unknown)=>{const message=m as {type?:string;approved?:boolean};if(message?.type==='bookingConfirmation'&&typeof message.approved==='boolean'){clearTimeout(timer);process.off('message',listener);resolve(message.approved);}};
    process.on('message',listener);process.send!({type:'confirmBooking',plan});
  });
}
let code=0;
try{
  await mkdir('.local',{recursive:true});await mkdir('DiagnosticsLocal',{recursive:true});
  const [mode,raw]=process.argv.slice(2);
  if(mode==='prepare'){const strategy=z.enum(['standard','extended']).parse(raw);await resetAndPrepare(strategy,safety);console.log('READY');}
  else if(mode==='test'){
    const input=TestBookingSchema.parse(JSON.parse(raw??''));
    await runBooking(loadConfig(),'test',safety,t,{...input,confirm});
  }else throw Error('MODE_REQUIRED');
}catch(e){code=1;const reason=e instanceof Error&&/^[A-Z_]{1,80}$/.test(e.message)?e.message:'BOOKING_OPERATION_FAILED';emitUiEvent({type:'error',code:reason});console.error(reason);}
finally{await t.flush();}
process.exit(code);
