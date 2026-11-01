import {readdir,lstat,realpath,readFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import type {WorkerId} from '../workers.js';
import {browserIdentity,verifyDedicatedChromeAsync} from '../browser.js';
import {loadLocalCheckoutCustomer} from './local-customer.js';
import {CHECKOUT_RECOVERY_FILE,readCheckoutRecoveryRecord,recoveryHash} from './checkout-recovery.js';
import {readHoldVerification,type HoldVerification} from './pending-hold-state.js';
import {recoverPendingHold,type RecoveryOptions,type RecoveryPage} from './pending-hold-recovery.js';
import {assertCanonicalRecoveryRuntime} from './recovery-runtime.js';
import {assertRecoveryWindow} from './recovery-window.js';

export interface PendingHoldRow {
  id:string;worker:WorkerId|null;wing:string;courts:number[];date:string;start:string;end:string;amount:number|null;
  advertisedExpiry:string|null;local:HoldVerification['local'];provider:HoldVerification['provider'];qr:HoldVerification['qr'];
  outstanding:boolean;freshConfirmationRequired:boolean;lastCheckedAt:string|null;diagnostic:string;contradiction:boolean;
}
interface Entry {id:string;directory:string;row:PendingHoldRow}
export interface RecoveryConnection {page:RecoveryPage;identity:RecoveryOptions['identity'];disconnect:()=>Promise<void>}
type Connector=(worker:WorkerId,mode:'original'|'fresh',bookingId?:string)=>Promise<RecoveryConnection>;
/** A new service instance intentionally does not trust previous-process confirmations. */
export class PendingHoldService {
  private confirmations=new Map<string,{at:number;state:HoldVerification}>();
  private running=false;
  constructor(private readonly root:string,private readonly connect?:Connector,private readonly now=()=>new Date(),private readonly sessionId=randomUUID()){}
  get busy(){return this.running;}
  private async entries():Promise<Entry[]>{
    const base=resolve(this.root,'.local/api-booking/api-first-journals'),found:Entry[]=[];
    try{if((await lstat(base)).isSymbolicLink())throw Error('RECOVERY_DIRECTORY_REFUSED');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
    const walk=async(directory:string,depth:number):Promise<void>=>{
      let files;try{files=await readdir(directory,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('RECOVERY_DISCOVERY_FAILED');}
      if(depth>6)throw Error('RECOVERY_DISCOVERY_DEPTH_EXCEEDED');
      if(files.some(f=>f.name===CHECKOUT_RECOVERY_FILE)){
        const id=recoveryHash(relative(base,directory).replaceAll('\\','/'));
        let row:PendingHoldRow={id,worker:null,wing:'UNKNOWN',courts:[],date:'Unknown',start:'?',end:'?',amount:null,advertisedExpiry:null,
          local:'UNKNOWN',provider:'UNKNOWN',qr:'NOT_CHECKED',outstanding:true,freshConfirmationRequired:true,lastCheckedAt:null,diagnostic:'PRIVATE_RECOVERY_RECORD_UNREADABLE',contradiction:false};
        try{
          if((await lstat(join(directory,CHECKOUT_RECOVERY_FILE))).isSymbolicLink())throw Error('RECOVERY_SYMLINK_REFUSED');
          const {record,responseHash}=await readCheckoutRecoveryRecord(directory),last=await readHoldVerification(directory),plan=record.plan;
          if(last&&last.responseHash!==responseHash)throw Error('RECOVERY_RESPONSE_CHANGED');
          const current=this.confirmations.get(id)??(last?.sessionId===this.sessionId?{at:Date.parse(last.at),state:last}:undefined),age=current?this.now().getTime()-current.at:Infinity,
            fresh=!!current&&age>=0&&age<=30_000&&current.state.responseHash===responseHash;
          const effective=fresh?current!.state:null;
          const expiries=(record.response as {bookings?:Array<{hold_expires_at?:unknown}>}|null)?.bookings?.map(b=>b.hold_expires_at).filter((v):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v)))??[];
          const expiry=expiries.length?expiries.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]!:null;
          const active=!!effective&&effective.provider==='PROVIDER_HOLD_CONFIRMED'&&!!expiry&&Date.parse(expiry)>this.now().getTime();
          const terminal=last?.provider==='EXPIRED_OR_UNAVAILABLE'||last?.provider==='PAYMENT_CONFIRMED';
          row={id,worker:record.workerId,wing:plan.wing??'MANGO',courts:plan.courts.map(c=>c.court),date:plan.targetDate,start:plan.startTime,end:plan.endTime,amount:plan.totalPrice,
            advertisedExpiry:expiry,local:last?.local??'RESPONSE_CAPTURED',provider:active?'PROVIDER_HOLD_CONFIRMED':terminal?last!.provider:'UNKNOWN',
            qr:active?effective!.qr:'NOT_CHECKED',outstanding:!terminal,freshConfirmationRequired:!active&&!terminal,lastCheckedAt:last?.at??null,
            diagnostic:!fresh&&last?.provider==='PROVIDER_HOLD_CONFIRMED'?'FRESH_PROVIDER_CONFIRMATION_REQUIRED':last?.code??'PROVIDER_NOT_CHECKED',contradiction:last?.contradiction??false};
        }catch(e){if(e instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(e.message))row.diagnostic=e.message;/* private parse errors are never serialized */}
        found.push({id,directory,row});
      }
      for(const f of files)if(f.isDirectory()&&!f.isSymbolicLink()&&(f.name==='fan-out'||/^[a-f0-9]{64}$/.test(f.name)))await walk(join(directory,f.name),depth+1);
    };
    await walk(base,0);return found.sort((a,b)=>Number(b.row.outstanding)-Number(a.row.outstanding)||a.id.localeCompare(b.id));
  }
  async list():Promise<PendingHoldRow[]>{return (await this.entries()).map(e=>e.row);}
  async recover(id:string,mode:'original'|'fresh'='fresh'):Promise<HoldVerification>{
    if(this.running)throw Error('RECOVERY_ALREADY_RUNNING');
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('RECOVERY_ID_INVALID');
    this.running=true;
    try{
      const entry=(await this.entries()).find(e=>e.id===id);if(!entry?.row.worker)throw Error('RECOVERY_RECORD_NOT_FOUND_OR_UNREADABLE');
      const base=await realpath(resolve(this.root,'.local/api-booking/api-first-journals'));
      const directory=await realpath(entry.directory),child=relative(base,directory);
      if(!child||child.startsWith('..')||isAbsolute(child))throw Error('RECOVERY_DIRECTORY_REFUSED');
      if(!this.connect)await assertCanonicalRecoveryRuntime(this.root);
      await assertRecoveryWindow(this.root,this.now());
      const {record}=await readCheckoutRecoveryRecord(directory);
      const bookingId=(record.response as {bookings?:Array<{id?:string}>})?.bookings?.[0]?.id;
      const connection=await (this.connect??connectRecoveryBrowser)(entry.row.worker,mode,bookingId);
      try{
        const state=await recoverPendingHold(connection.page,directory,{identity:connection.identity,now:this.now,sessionId:this.sessionId,claimRoot:resolve(this.root,'.local/api-booking/recovery-claims')});
        this.confirmations.set(id,{at:this.now().getTime(),state});return state;
      }finally{await connection.disconnect();}
    }finally{this.running=false;}
  }
}

/** Connect only to the record's verified dedicated profile; never switches customer/token. */
export async function connectRecoveryBrowser(worker:WorkerId,mode:'original'|'fresh',bookingId?:string):Promise<RecoveryConnection>{
  const identity=browserIdentity(worker);await verifyDedicatedChromeAsync(identity);
  const customer=loadLocalCheckoutCustomer(worker);
  const browser=await chromium.connectOverCDP(identity.cdpUrl,{timeout:10_000});
  try{
    const context=browser.contexts()[0];if(!context)throw Error('RECOVERY_BROWSER_CONTEXT_MISSING');
    const pages=context.pages().filter(p=>{try{const u=new URL(p.url());return u.origin==='https://app.onda.fit'&&u.pathname==='/book/thirsty-pickle';}catch{return false;}});
    let page;
    if(mode==='fresh'){page=await context.newPage();await page.goto('https://app.onda.fit/book/thirsty-pickle',{waitUntil:'domcontentloaded',timeout:30_000});}
    else {const matching=bookingId?pages.filter(p=>new URL(p.url()).searchParams.get('bookingId')===bookingId):[];
      if(matching.length)page=matching[0]!;else {if(pages.length!==1)throw Error('RECOVERY_ORIGINAL_TAB_AMBIGUOUS');page=pages[0]!;}}
    return {page,identity:{workerId:worker,customer,profile:identity.expectedProfile,assertContext:async()=>{
      await verifyDedicatedChromeAsync(identity);
      const current=loadLocalCheckoutCustomer(worker);
      if(JSON.stringify(current)!==JSON.stringify(customer))throw Error('RECOVERY_CUSTOMER_CHANGED');
    }},disconnect:()=>browser.close()};
  }catch{await browser.close();throw Error('RECOVERY_BROWSER_UNAVAILABLE_OR_AMBIGUOUS');}
}

export interface RotationCandidate {worker:WorkerId;profileVerified:boolean;customerVerified:boolean;browserClean:boolean;activeRunner:boolean}
/** Rotation never frees a hold. UNKNOWN and unconfirmed expired advertisements remain outstanding. */
export function eligibleRecoveryTestWorkers(candidates:RotationCandidate[],holds:PendingHoldRow[]):WorkerId[]{
  return candidates.filter(c=>c.profileVerified&&c.customerVerified&&c.browserClean&&!c.activeRunner&&
    !holds.some(h=>h.worker===c.worker&&h.outstanding)).map(c=>c.worker);
}
