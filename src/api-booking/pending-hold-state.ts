import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {publishPrivateJson} from './private-persistence.js';

export const VerificationStateSchema=z.object({
  schema:z.literal(1),sequence:z.number().int().positive(),at:z.iso.datetime(),
  responseHash:z.string().regex(/^[a-f0-9]{64}$/),journalHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sessionId:z.uuid().optional(),
  local:z.enum(['RESPONSE_CAPTURED','LOCAL_RESPONSE_VALID','UNKNOWN']),
  provider:z.enum(['NOT_CHECKED','PROVIDER_HOLD_CONFIRMED','PAYMENT_CONFIRMED','UNKNOWN','EXPIRED_OR_UNAVAILABLE']),
  qr:z.enum(['NOT_CHECKED','QR_READY','FAILED']),
  code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  contradiction:z.boolean(),httpStatus:z.number().int().min(100).max(599).optional(),
  milestones:z.array(z.object({event:z.enum(['RESPONSE_PERSISTED','LOCAL_VALIDATED','IDENTITY_BOUND','PROVIDER_LOOKUP','PROVIDER_RESULT','PROVIDER_CONFIRMED','CHECKOUT_ACCESS','CHECKOUT_NAVIGATION','ORDER_VERIFIED','QR_PRESENTED']),
    at:z.iso.datetime(),clockDomain:z.enum(['NODE_WALL','TRUSTED_NETWORK']),durationMs:z.number().nonnegative().optional(),durationDomain:z.literal('NODE_MONOTONIC').optional(),
    httpStatus:z.number().int().min(100).max(599).optional(),operation:z.enum(['ACCESS','LOOKUP']).optional(),failure:z.enum(['TIMEOUT','NETWORK','TOO_LARGE','TRANSPORT']).optional()})).max(50),
}).strict();
export type HoldVerification=z.infer<typeof VerificationStateSchema>;
export async function readHoldVerification(directory:string):Promise<HoldVerification|null>{
  let files:string[];try{files=await readdir(join(directory,'hold-verification'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('RECOVERY_STATE_UNREADABLE');}
  const records=await Promise.all(files.filter(f=>/^\d{10}(?:-[a-f0-9-]+)?\.json$/.test(f)).map(async f=>{
    const text=await readFile(join(directory,'hold-verification',f),'utf8');if(text.length>32_768)throw Error('RECOVERY_STATE_INVALID');
    return VerificationStateSchema.parse(JSON.parse(text));
  }));
  if(new Set(records.map(r=>r.sequence)).size!==records.length)throw Error('RECOVERY_STATE_CONFLICT');
  return records.sort((a,b)=>b.sequence-a.sequence)[0]??null;
}
/** Append-only, separately from submission journals. Call under the recovery worker claim. */
export async function appendHoldVerification(directory:string,value:Omit<HoldVerification,'schema'|'sequence'>):Promise<HoldVerification>{
  for(let attempt=0;attempt<8;attempt++){
    const previous=await readHoldVerification(directory);
    if(previous&&previous.responseHash!==value.responseHash)throw Error('RECOVERY_RESPONSE_CHANGED');
    const record=VerificationStateSchema.parse({...value,schema:1,sequence:(previous?.sequence??0)+1});
    try{await publishPrivateJson(join(directory,'hold-verification',`${String(record.sequence).padStart(10,'0')}.json`),record);return record;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  }
  throw Error('RECOVERY_STATE_WRITE_CONTENTION');
}
