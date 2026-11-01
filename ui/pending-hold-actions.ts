import {z} from 'zod';
import type {Dashboard} from './types.js';
import type {PendingHoldService,PendingHoldRow} from '../src/api-booking/pending-hold-service.js';
import type {HoldVerification} from '../src/api-booking/pending-hold-state.js';
export const PendingRecoveryRequest=z.discriminatedUnion('action',[
  z.object({action:z.literal('list')}).strict(),
  z.object({action:z.literal('recover'),id:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['original','fresh'])}).strict(),
]);
export type PendingRecoveryInput=z.infer<typeof PendingRecoveryRequest>;
export interface PendingRecoveryResponse {rows?:PendingHoldRow[];outcome?:HoldVerification;error?:string}
export async function handlePendingRecovery(service:Pick<PendingHoldService,'list'|'recover'>,state:Pick<Dashboard,'operation'|'scheduledRelease'|'activeApiRelease'>,
  input:unknown,labBusy=false):Promise<PendingRecoveryResponse>{
  try{
    const parsed=PendingRecoveryRequest.safeParse(input);if(!parsed.success)throw Error('RECOVERY_REQUEST_INVALID');
    if(labBusy||state.operation!=='idle'||state.scheduledRelease||state.activeApiRelease&&state.activeApiRelease.phase!=='FAILED')throw Error('RECOVERY_REQUIRES_IDLE_APPLICATION');
    if(parsed.data.action==='list')return {rows:await service.list()};
    const outcome=await service.recover(parsed.data.id,parsed.data.mode);return {outcome,rows:await service.list()};
  }catch(error){return {error:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'PENDING_HOLD_RECOVERY_FAILED'};}
}
