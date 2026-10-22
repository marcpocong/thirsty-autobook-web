import { LiveAvailabilityError } from './live-availability-provider.js';

/** Per-observer circuit. Refusals stop, transient errors get bounded backoff;
 * skipped reads never masquerade as HTTP requests. No alternate access path. */
export class AvailabilityReadPolicy {
  private blocked:string|undefined;
  private nextReadMs=0;
  private failures=0;
  constructor(private readonly now=()=>Date.now()) {}
  beforeRead():void {
    if(this.blocked)throw new LiveAvailabilityError(this.blocked,undefined,false);
    if(this.now()<this.nextReadMs)throw new LiveAvailabilityError('AVAILABILITY_BACKOFF',undefined,false,this.nextReadMs-this.now());
  }
  success():void {this.failures=0;this.nextReadMs=0;}
  failure(error:unknown):void {
    const code=error instanceof Error?error.message:'UNKNOWN',status=error instanceof LiveAvailabilityError?error.httpStatus:undefined;
    if(status===401||status===403){this.blocked='AVAILABILITY_PROVIDER_REFUSED';return;}
    const transient=status===429||status!==undefined&&status>=500||['AVAILABILITY_TRANSPORT_FAILED','AVAILABILITY_READ_TIMEOUT','AVAILABILITY_BODY_FAILED'].includes(code);
    if(!transient){this.blocked='AVAILABILITY_MANUAL_RECHECK_REQUIRED';return;}
    if(++this.failures>=3){this.blocked='AVAILABILITY_RETRY_BUDGET_EXHAUSTED';return;}
    this.nextReadMs=this.now()+Math.max(status===429?30_000:1000*2**(this.failures-1),error instanceof LiveAvailabilityError?error.retryAfterMs??0:0);
  }
}
