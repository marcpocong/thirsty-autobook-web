import {createSocket} from 'node:dgram';
import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {z} from 'zod';
import {clockConsensus,type ClockConsensus,type ClockSample} from './release-clock.js';

const NTP_UNIX_EPOCH_SECONDS=2_208_988_800;
const STATE_PATH=resolve('.local/network-clock.json');
export const NETWORK_CLOCK_MAX_AGE_MS=2*60*60_000;
const ClockStateSchema=z.object({source:z.string().regex(/^time(?:[1-4])?\.google\.com$/),offsetMs:z.number().finite(),roundTripMs:z.number().finite().nonnegative(),synchronizedAt:z.iso.datetime(),
  // Present when the offset is a multi-sample consensus (ntp-consensus-v1); source/roundTripMs then describe its fastest kept sample.
  method:z.literal('ntp-consensus-v1').optional(),sampleCount:z.number().int().nonnegative().optional(),keptCount:z.number().int().nonnegative().optional(),
  spreadMs:z.number().finite().nonnegative().optional(),uncertaintyMs:z.number().finite().nonnegative().optional(),quality:z.enum(['GOOD','DEGRADED']).optional()}).strict();
export type NetworkClockState=z.infer<typeof ClockStateSchema>;

function writeTimestamp(packet:Buffer,offset:number,unixMs:number){
  const seconds=Math.floor(unixMs/1000)+NTP_UNIX_EPOCH_SECONDS;
  const fraction=Math.floor(((unixMs%1000)/1000)*0x1_0000_0000);
  packet.writeUInt32BE(seconds>>>0,offset);packet.writeUInt32BE(fraction>>>0,offset+4);
}
function readTimestamp(packet:Buffer,offset:number){
  const seconds=packet.readUInt32BE(offset)-NTP_UNIX_EPOCH_SECONDS;
  const fraction=packet.readUInt32BE(offset+4)/0x1_0000_0000;
  return (seconds+fraction)*1000;
}
export function calculateNtpOffset(t1:number,t2:number,t3:number,t4:number){
  const offsetMs=((t2-t1)+(t3-t4))/2,roundTripMs=Math.max(0,(t4-t1)-(t3-t2));
  if(![offsetMs,roundTripMs].every(Number.isFinite))throw Error('NETWORK_CLOCK_RESPONSE_INVALID');
  return {offsetMs,roundTripMs};
}
async function sample(host:string,timeoutMs=2500):Promise<NetworkClockState>{
  return new Promise((resolveSample,reject)=>{
    const socket=createSocket('udp4'),packet=Buffer.alloc(48);packet[0]=0x23;
    const t1=Date.now();writeTimestamp(packet,40,t1);
    let settled=false;
    const timer=setTimeout(()=>finish(Error('NETWORK_CLOCK_TIMEOUT')),timeoutMs);
    const finish=(error?:Error,value?:NetworkClockState)=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();error?reject(error):resolveSample(value!);};
    socket.once('error',()=>finish(Error('NETWORK_CLOCK_TRANSPORT_FAILED')));
    socket.once('message',message=>{
      const t4=Date.now();
      if(message.length<48||(message[0]!&7)!==4) {finish(Error('NETWORK_CLOCK_RESPONSE_INVALID'));return;}
      try{
        const t2=readTimestamp(message,32),t3=readTimestamp(message,40),timing=calculateNtpOffset(t1,t2,t3,t4);
        if(Math.abs(timing.offsetMs)>5*60_000||timing.roundTripMs>5000)throw Error('NETWORK_CLOCK_RESPONSE_INVALID');
        finish(undefined,{source:host,offsetMs:timing.offsetMs,roundTripMs:timing.roundTripMs,synchronizedAt:new Date(t4+timing.offsetMs).toISOString()});
      }catch(error){finish(error instanceof Error?error:Error('NETWORK_CLOCK_RESPONSE_INVALID'));}
    });
    socket.send(packet,123,host,error=>{if(error)finish(Error('NETWORK_CLOCK_TRANSPORT_FAILED'));});
  });
}
export const GOOGLE_NTP_HOSTS=['time.google.com','time1.google.com','time2.google.com','time3.google.com','time4.google.com'] as const;
export interface ConsensusRoundOptions { samplesPerHost?:number; spacingMs?:number; timeoutMs?:number; minKept?:number;
  hosts?:readonly string[]; sampler?:(host:string,timeoutMs:number)=>Promise<ClockSample> }
/** One bounded consensus round: every approved Google host, several spaced samples each, all in parallel. */
export async function queryGoogleClockConsensus(options:ConsensusRoundOptions={}):Promise<ClockConsensus>{
  const {samplesPerHost=2,spacingMs=120,timeoutMs=1200,hosts=GOOGLE_NTP_HOSTS}=options;
  const sampler=options.sampler??(async(host:string,timeout:number)=>{const value=await sample(host,timeout);return {host:value.source,offsetMs:value.offsetMs,roundTripMs:value.roundTripMs};});
  const settled=await Promise.allSettled(Array.from({length:samplesPerHost},(_,round)=>hosts.map(async host=>{
    if(round)await new Promise(done=>setTimeout(done,round*spacingMs));
    return sampler(host,timeoutMs);
  })).flat());
  return clockConsensus(settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]),options.minKept);
}
export function consensusState(consensus:ClockConsensus,wallNow=Date.now()):NetworkClockState{
  const best=consensus.samples.filter(value=>value.kept).sort((a,b)=>a.roundTripMs-b.roundTripMs)[0]!;
  return ClockStateSchema.parse({source:consensus.bestHost,offsetMs:consensus.offsetMs,roundTripMs:best.roundTripMs,synchronizedAt:new Date(wallNow+consensus.offsetMs).toISOString(),
    method:consensus.method,sampleCount:consensus.sampleCount,keptCount:consensus.keptCount,spreadMs:consensus.spreadMs,uncertaintyMs:consensus.uncertaintyMs,quality:consensus.quality});
}
/** Sanitized evidence of one consensus round (hosts, offsets and round trips only). */
export function recordClockEvidence(consensus:ClockConsensus,checkpoint:string,directory=resolve('.local/network-clock-evidence'),wallNow=Date.now()){
  if(!/^[A-Z0-9_+-]{1,24}$/.test(checkpoint))throw Error('NETWORK_CLOCK_CHECKPOINT_INVALID');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const at=new Date(wallNow+consensus.offsetMs).toISOString();
  const path=join(directory,`${at.replace(/[:.]/g,'-')}-${checkpoint}.json`);
  writeFileSync(path,JSON.stringify({checkpoint,capturedAt:at,...consensus},null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  return path;
}
/** Single fastest sample (pre-consensus method); kept for callers that need one quick reading. */
export async function queryGoogleNetworkClock():Promise<NetworkClockState>{
  const settled=await Promise.allSettled(['time.google.com','time1.google.com','time2.google.com'].map(host=>sample(host)));
  const values=settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]).sort((a,b)=>a.roundTripMs-b.roundTripMs);
  if(!values.length)throw Error('NETWORK_CLOCK_SYNC_FAILED');
  return ClockStateSchema.parse(values[0]);
}
/** Consensus sync (any successful sample is accepted here; a near-release round uses its own stricter rule). */
export async function synchronizeNetworkClock(path=STATE_PATH,round:()=>Promise<ClockConsensus>=()=>queryGoogleClockConsensus()):Promise<NetworkClockState>{
  const state=consensusState(await round());return writeNetworkClockState(state,path);
}
export function writeNetworkClockState(state:NetworkClockState,path=STATE_PATH):NetworkClockState{
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temporary=`${path}.tmp`;writeFileSync(temporary,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(temporary,path);
  return state;
}
export function readNetworkClock(path=STATE_PATH):NetworkClockState|null{
  try{return ClockStateSchema.parse(JSON.parse(readFileSync(path,'utf8')));}catch{return null;}
}
export function networkNowMs(path=STATE_PATH,systemNow=Date.now()):number{
  const state=readNetworkClock(path);return state?systemNow+state.offsetMs:systemNow;
}
export function networkClockFresh(state:NetworkClockState|null,nowMs=networkNowMs()):boolean{
  return !!state&&nowMs-Date.parse(state.synchronizedAt)>=0&&nowMs-Date.parse(state.synchronizedAt)<=NETWORK_CLOCK_MAX_AGE_MS;
}
