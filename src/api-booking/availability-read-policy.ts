import { LiveAvailabilityError } from './live-availability-provider.js';

/** Per-observer circuit. Refusals stop, transient errors get bounded backoff;
 * skipped reads never masquerade as HTTP requests. No alternate access path. */
export class AvailabilityReadPolicy {
  private blocked:LiveAvailabilityError|undefined;
  private nextReadMs=0;
  private failures=0;
  constructor(private readonly now=()=>Date.now()) {}
  beforeRead():void {
    if(this.blocked)throw new LiveAvailabilityError(this.blocked.code,this.blocked.httpStatus,false,this.blocked.retryAfterMs);
    if(this.now()<this.nextReadMs)throw new LiveAvailabilityError('AVAILABILITY_BACKOFF',undefined,false,this.nextReadMs-this.now());
  }
  success():void {this.failures=0;this.nextReadMs=0;}
  failure(error:unknown):void {
    const code=error instanceof Error?error.message:'UNKNOWN',status=error instanceof LiveAvailabilityError?error.httpStatus:undefined;
    if(status===401||status===403||status===429){this.blocked=new LiveAvailabilityError(status===429?'AVAILABILITY_RATE_LIMITED':'AVAILABILITY_PROVIDER_REFUSED',status,false,error instanceof LiveAvailabilityError?error.retryAfterMs:undefined);return;}
    const transient=status!==undefined&&status>=500||['AVAILABILITY_TRANSPORT_FAILED','AVAILABILITY_READ_TIMEOUT','AVAILABILITY_BODY_FAILED'].includes(code);
    if(!transient){this.blocked=new LiveAvailabilityError('AVAILABILITY_MANUAL_RECHECK_REQUIRED',undefined,false);return;}
    if(++this.failures>=3){this.blocked=new LiveAvailabilityError('AVAILABILITY_RETRY_BUDGET_EXHAUSTED',undefined,false);return;}
    this.nextReadMs=this.now()+Math.max(1000*2**(this.failures-1),error instanceof LiveAvailabilityError?error.retryAfterMs??0:0);
  }
}
