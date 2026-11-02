import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,readdir,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pendingFixture,fakeRecoveryPage,fixtureNow} from '../helpers/pending-hold-fixture.js';
import {recoverPendingHold} from '../../src/api-booking/pending-hold-recovery.js';
import {readHoldVerification} from '../../src/api-booking/pending-hold-state.js';
import {PendingHoldService,eligibleRecoveryTestWorkers} from '../../src/api-booking/pending-hold-service.js';
import {handlePendingRecovery} from '../../ui/pending-hold-actions.js';

async function fixture(work:(f:Awaited<ReturnType<typeof pendingFixture>>)=>Promise<void>,legacy=false,omitHourlyFacility=false){
  const root=await mkdtemp(join(tmpdir(),'pending-hold-'));try{await work(await pendingFixture(root,'A',7,legacy,undefined,omitHourlyFacility));}finally{await rm(root,{recursive:true,force:true});}
}
const opts=(f:Awaited<ReturnType<typeof pendingFixture>>)=>({identity:f.identity,now:()=>fixtureNow,claimRoot:join(f.root,'claims'),sleep:vi.fn(async()=>{})});
describe('independent provider hold verification and existing-only recovery',()=>{
  it('traces independent confirmation before navigation and QR; observer exceptions do not change recovery',()=>fixture(async f=>{
    const {page}=fakeRecoveryPage(f),events:string[]=[];
    const result=await recoverPendingHold(page,f.directory,{...opts(f),onTrace:trace=>{events.push(trace.event);throw Error('OBSERVER_FAILED');}});
    expect(result.provider).toBe('PROVIDER_HOLD_CONFIRMED');expect(result.qr).toBe('QR_READY');
    expect(events.indexOf('PROVIDER_LOOKUP')).toBeLessThan(events.indexOf('PROVIDER_CONFIRMED'));
    expect(events.indexOf('PROVIDER_CONFIRMED')).toBeLessThan(events.indexOf('CHECKOUT_NAVIGATION'));
    expect(events.indexOf('CHECKOUT_NAVIGATION')).toBeLessThan(events.indexOf('QR_PRESENTED'));
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);expect(f.submissions()).toBe(1);
  }));
  it('never traces a confirmation, navigation or QR for a before-expiry 404',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f),events:string[]=[];mocks.evaluate.mockResolvedValue({status:404,body:null,retryAfterMs:null});
    const result=await recoverPendingHold(page,f.directory,{...opts(f),onTrace:trace=>{events.push(trace.event);}});
    expect(result.provider).toBe('UNKNOWN');expect(events).toContain('PROVIDER_LOOKUP');
    expect(events).not.toContain('PROVIDER_CONFIRMED');expect(events).not.toContain('CHECKOUT_NAVIGATION');expect(events).not.toContain('QR_PRESENTED');
  }));
  const collapsedHour=(f:Awaited<ReturnType<typeof pendingFixture>>,index:number)=>({success:true,data:{...f.provider.data,...f.provider.data.groupBookings[index],
    groupBookings:undefined,bookingGroupId:'expired-original-group',bookingSessions:[],bookingStatus:'expired',paymentStatus:'expired',canResumeCheckout:false}});
  it('reconciles a collapsed expired group only after independently matching every original hourly GET',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockImplementation(async(_source,args)=>({status:200,body:collapsedHour(f,f.raw.bookings.findIndex(b=>b.id===args.bookingId)),retryAfterMs:null}));
    const result=await recoverPendingHold(page,f.directory,{...opts(f),now:()=>new Date(Date.parse(f.expiry)+60_000)});
    expect(result).toMatchObject({provider:'EXPIRED_OR_UNAVAILABLE',code:'PROVIDER_HOURLY_GROUP_EXPIRED',qr:'NOT_CHECKED'});
    expect(mocks.evaluate.mock.calls.map(c=>c[1].bookingId)).toEqual(f.raw.bookings.map(b=>b.id));
    expect(mocks.evaluate.mock.calls.every(c=>c[1].kind==='LOOKUP')).toBe(true);expect(mocks.goto).not.toHaveBeenCalled();
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);expect(f.submissions()).toBe(1);
  }));
  it.each(['pending','resumable','future','missing group'])('does not infer collapsed group expiry from %s evidence',kind=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f),body=collapsedHour(f,0);
    if(kind==='pending'){body.data.bookingStatus='pending';body.data.paymentStatus='pending';}
    if(kind==='resumable')body.data.canResumeCheckout=true;
    if(kind==='missing group')body.data.bookingGroupId='';
    mocks.evaluate.mockResolvedValue({status:200,body,retryAfterMs:null});
    const result=await recoverPendingHold(page,f.directory,{...opts(f),now:()=>kind==='future'?fixtureNow:new Date(Date.parse(f.expiry)+60_000)});
    expect(result.provider).toBe('UNKNOWN');expect(result.code).toBe('PROVIDER_PARTIAL_HOURLY_GROUP');expect(mocks.evaluate).toHaveBeenCalledTimes(1);expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it.each(['foreign customer','wrong time','wrong group','pending sibling','duplicate sibling'])("retains UNKNOWN for a collapsed group's %s",kind=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockImplementation(async(_source,args)=>{
      const index=f.raw.bookings.findIndex(b=>b.id===args.bookingId),body=collapsedHour(f,index);
      if(index===1){if(kind==='foreign customer')body.data.customerId='foreign';if(kind==='wrong time')body.data.startTime='19:00';if(kind==='wrong group')body.data.bookingGroupId='different-group';if(kind==='pending sibling')body.data.bookingStatus='pending';if(kind==='duplicate sibling')body.data.id=f.raw.bookings[0]!.id;}
      return {status:200,body,retryAfterMs:null};});
    expect((await recoverPendingHold(page,f.directory,{...opts(f),now:()=>new Date(Date.parse(f.expiry)+60_000)})).provider).toBe('UNKNOWN');
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);expect(mocks.goto).not.toHaveBeenCalled();expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
  }));
  it.each([404,410,429])('keeps the whole collapsed group UNKNOWN and stops after sibling HTTP %s',status=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockImplementation(async(_source,args)=>args.bookingId===f.raw.bookings[0]!.id?
      {status:200,body:collapsedHour(f,0),retryAfterMs:null}:{status,body:null,retryAfterMs:100});
    const result=await recoverPendingHold(page,f.directory,{...opts(f),now:()=>new Date(Date.parse(f.expiry)+60_000)});
    expect(result.provider).toBe('UNKNOWN');expect(mocks.evaluate).toHaveBeenCalledTimes(2);expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it('validates registered facility identity when checkout hourly rows omit optional facility_id',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);
    expect((await recoverPendingHold(page,f.directory,opts(f))).qr).toBe('QR_READY');
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP','ACCESS']);
    expect(f.submissions()).toBe(1);expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
  },false,true));
  it.each(['foreign','missing'])('rejects %s lookup facility even when checkout hourly facility_id is absent',kind=>fixture(async f=>{
    for(const row of f.provider.data.groupBookings){if(kind==='missing')delete (row as Record<string,unknown>).facilityId;else row.facilityId='foreign';}
    if(kind==='missing')delete (f.provider.data as Record<string,unknown>).facilityId;else f.provider.data.facilityId='foreign';
    const {page,mocks}=fakeRecoveryPage(f);
    expect((await recoverPendingHold(page,f.directory,opts(f))).code).toBe('PROVIDER_IDENTITY_MISMATCH');
    expect(mocks.goto).not.toHaveBeenCalled();expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP']);
  },false,true));
  it('accepts equivalent provider date/time wire formats without shifting the service date',()=>fixture(async f=>{
    for(const row of f.provider.data.groupBookings){row.date+='T00:00:00.000Z';row.startTime+=':00';row.endTime+=':00';}
    expect((await recoverPendingHold(fakeRecoveryPage(f).page,f.directory,opts(f))).qr).toBe('QR_READY');
  }));
  it('validates the official lookup before granting access, durably records states, and never rewrites the journal',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f),result=await recoverPendingHold(page,f.directory,opts(f));
    expect(result).toMatchObject({local:'LOCAL_RESPONSE_VALID',provider:'PROVIDER_HOLD_CONFIRMED',qr:'QR_READY'});
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP','ACCESS']);
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);expect(f.submissions()).toBe(1);
    const text=JSON.stringify(result);expect(text).not.toContain('PRIVATE-');expect(text).not.toContain('fixture@example.invalid');expect(text).not.toContain('booking-7-0');
    const records=await readdir(join(f.directory,'hold-verification'));expect(records.length).toBeGreaterThanOrEqual(4);
  }));
  it.each([401,403,404,410,429,500])('keeps provider HTTP %s distinct and never navigates on failure',status=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockImplementation(async(_code,args)=>args.kind==='ACCESS'?{status:200,body:{success:true},retryAfterMs:null}:{status,body:null,retryAfterMs:null});
    const options=opts(f),result=await recoverPendingHold(page,f.directory,options);
    const codes:Record<number,string>={401:'PROVIDER_AUTHENTICATION_REQUIRED',403:'PROVIDER_ACCESS_DENIED',404:'PROVIDER_404_BEFORE_ADVERTISED_EXPIRY',410:'PROVIDER_CHECKOUT_UNAVAILABLE',429:'PROVIDER_RATE_LIMITED',500:'PROVIDER_SERVER_ERROR'};
    expect(result.code).toBe(codes[status]);expect(result.qr).not.toBe('QR_READY');expect(mocks.goto).not.toHaveBeenCalled();
    expect(result.contradiction).toBe(status===404);expect(mocks.evaluate).toHaveBeenCalledTimes([401,403].includes(status)?3:status===500?2:1);
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
  }));
  it('uses only a fully matched lookup capability when the captured token is stale',()=>fixture(async f=>{
    Object.assign(f.provider.data,{checkoutToken:'FRESH-PROVIDER-CAPABILITY'});
    const {page,mocks}=fakeRecoveryPage(f);
    mocks.evaluate.mockImplementation(async(_code,args)=>args.kind==='LOOKUP'?{status:200,body:f.provider,retryAfterMs:null}:
      {status:args.token==='FRESH-PROVIDER-CAPABILITY'?200:401,body:{},retryAfterMs:null});
    const result=await recoverPendingHold(page,f.directory,opts(f));
    expect(result).toMatchObject({provider:'PROVIDER_HOLD_CONFIRMED',qr:'QR_READY'});
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP','ACCESS']);
    expect(JSON.stringify(result)).not.toContain('FRESH-PROVIDER-CAPABILITY');
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);expect(f.submissions()).toBe(1);
  }));
  it.each([401,403])('uses the original grant only when the initial lookup requires access (%s)',status=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);let lookups=0;
    mocks.evaluate.mockImplementation(async(_code,args)=>args.kind==='ACCESS'?{status:200,body:{},retryAfterMs:null}:
      ++lookups===1?{status,body:null,retryAfterMs:null}:{status:200,body:f.provider,retryAfterMs:null});
    expect((await recoverPendingHold(page,f.directory,opts(f))).qr).toBe('QR_READY');
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP','ACCESS','LOOKUP']);
  }));
  it('stops when both the original lookup and captured grant require authentication',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockResolvedValue({status:401,body:null,retryAfterMs:null});
    const result=await recoverPendingHold(page,f.directory,opts(f));
    expect(result).toMatchObject({provider:'UNKNOWN',qr:'NOT_CHECKED',code:'PROVIDER_AUTHENTICATION_REQUIRED'});
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP','ACCESS']);expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it('never uses a replacement capability from a foreign booking',()=>fixture(async f=>{
    Object.assign(f.provider.data,{id:'foreign',checkoutToken:'FOREIGN-CAPABILITY'});
    const {page,mocks}=fakeRecoveryPage(f);
    expect((await recoverPendingHold(page,f.directory,opts(f))).code).toBe('PROVIDER_IDENTITY_MISMATCH');
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP']);expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it('keeps independent hold proof when checkout access is denied after the lookup',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);
    mocks.evaluate.mockImplementation(async(_code,args)=>args.kind==='LOOKUP'?{status:200,body:f.provider,retryAfterMs:null}:{status:401,body:null,retryAfterMs:null});
    expect(await recoverPendingHold(page,f.directory,opts(f))).toMatchObject({provider:'PROVIDER_HOLD_CONFIRMED',qr:'FAILED',code:'PROVIDER_AUTHENTICATION_REQUIRED'});
    expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it('verifies without granting access or navigating, and rejects malformed replacement tokens',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);
    expect((await recoverPendingHold(page,f.directory,{...opts(f),verifyOnly:true})).provider).toBe('PROVIDER_HOLD_CONFIRMED');
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP']);
    mocks.evaluate.mockClear();Object.assign(f.provider.data,{checkoutToken:'invalid\ntoken'});
    expect((await recoverPendingHold(page,f.directory,opts(f))).code).toBe('PROVIDER_CHECKOUT_TOKEN_INVALID');
    expect(mocks.evaluate.mock.calls.map(c=>c[1].kind)).toEqual(['LOOKUP']);expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it.each([null,0,1500,120_000])('stops at the first 429 with Retry-After %s without polling through a restriction',retryAfterMs=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);
    mocks.evaluate.mockResolvedValueOnce({status:429,body:{},retryAfterMs}).mockResolvedValue({status:200,body:f.provider,retryAfterMs:null});
    const o=opts(f),result=await recoverPendingHold(page,f.directory,o);
    expect(result).toMatchObject({provider:'UNKNOWN',code:'PROVIDER_RATE_LIMITED'});
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);expect(mocks.goto).not.toHaveBeenCalled();expect(o.sleep).not.toHaveBeenCalled();
  }));
  it('bounds timeout reads and safely classifies exceptions containing private URLs',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockRejectedValue(Error('https://app.onda.fit/?checkoutToken=PRIVATE-A-0'));
    const result=await recoverPendingHold(page,f.directory,opts(f));expect(result.code).toBe('PROVIDER_READ_TIMEOUT_OR_TRANSPORT_FAILED');expect(mocks.evaluate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('PRIVATE-A-0');
  }));
  it.each(['TIMEOUT','NETWORK','TOO_LARGE'] as const)('classifies browser read failure %s without exposing its body',failure=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockResolvedValue({status:0,body:null,retryAfterMs:null,failure} as never);
    const result=await recoverPendingHold(page,f.directory,opts(f));
    expect(result.code).toBe(failure==='TIMEOUT'?'PROVIDER_READ_TIMEOUT':failure==='NETWORK'?'PROVIDER_READ_TRANSPORT_FAILED':'PROVIDER_RESPONSE_TOO_LARGE');
    expect(mocks.evaluate).toHaveBeenCalledTimes(failure==='TOO_LARGE'?1:2);
  }));
  it('does not wait an unbounded Retry-After for a 5xx response',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockResolvedValue({status:503,body:null,retryAfterMs:120_000});
    const o=opts(f);expect((await recoverPendingHold(page,f.directory,o)).code).toBe('PROVIDER_SERVER_ERROR');expect(o.sleep).not.toHaveBeenCalled();
  }));
  it.each(['id','space','date','time','customer','amount','session','partial','extra','duplicate','status'])('rejects provider mismatch: %s',kind=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f),d=f.provider.data;
    if(kind==='id')d.id='foreign';if(kind==='space')d.groupBookings[0]!.spaceId='foreign';if(kind==='date')d.groupBookings[0]!.date='2026-11-04';
    if(kind==='time')d.groupBookings[0]!.startTime='09:00';if(kind==='customer')d.groupBookings[0]!.customerId='foreign';if(kind==='amount')d.checkoutTotal=600;
    if(kind==='session')d.groupBookings[0]!.bookingSessionId='foreign';if(kind==='partial')d.groupBookings.pop();if(kind==='extra')d.groupBookings.push({...d.groupBookings[0]!,id:'extra'});
    if(kind==='duplicate')d.groupBookings[1]!.id=d.groupBookings[0]!.id;if(kind==='status')d.groupBookings[1]!.paymentStatus='paid';
    const result=await recoverPendingHold(page,f.directory,opts(f));expect(result.provider).toBe('UNKNOWN');expect(mocks.goto).not.toHaveBeenCalled();
  }));
  it('requires fresh matching legacy contacts instead of trusting a worker letter',()=>fixture(async f=>{
    const {page}=fakeRecoveryPage(f);f.provider.data.customerEmail='someone-else@example.invalid';
    expect((await recoverPendingHold(page,f.directory,opts(f))).code).toBe('LEGACY_CUSTOMER_BINDING_UNVERIFIED');
    f.provider.data.customerEmail=f.identity.customer.customerEmail;
    expect((await recoverPendingHold(page,f.directory,opts(f))).qr).toBe('QR_READY');
  },true));
  it.each(['worker','customer','profile','context'])('refuses changed identity: %s',kind=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f),o=opts(f);
    if(kind==='worker')o.identity={...o.identity,workerId:'B'};
    if(kind==='customer')o.identity={...o.identity,customer:{...o.identity.customer,customerEmail:'other@example.invalid'}};
    if(kind==='profile')o.identity={...o.identity,profile:'other-profile'};
    if(kind==='context')o.identity={...o.identity,assertContext:async()=>{throw Error('CDP_WRONG_PROFILE');}};
    if(kind==='worker')await expect(recoverPendingHold(page,f.directory,o)).rejects.toThrow('RECOVERY_WORKER_MISMATCH');
    else expect((await recoverPendingHold(page,f.directory,o)).provider).toBe('UNKNOWN');
    expect(mocks.evaluate).not.toHaveBeenCalled();
  }));
  it('keeps original UNKNOWN even after independent confirmation and QR recovery',()=>fixture(async f=>{
    const j=JSON.parse(f.journalBefore);j.state='unknown';j.failureCode='CHECKOUT_SESSION_INVALID';const before=JSON.stringify(j);await writeFile(f.journalPath,before);
    expect((await recoverPendingHold(fakeRecoveryPage(f).page,f.directory,opts(f))).qr).toBe('QR_READY');
    expect(await readFile(f.journalPath,'utf8')).toBe(before);
  }));
  it('recovers an exact UNKNOWN intent after capture succeeded but observed-response journaling failed',()=>fixture(async f=>{
    const j=JSON.parse(f.journalBefore);j.state='unknown';delete j.observedResponse;j.failureCode='CHECKOUT_RESPONSE_CAPTURE_FAILED';
    const before=JSON.stringify(j);await writeFile(f.journalPath,before);
    expect((await recoverPendingHold(fakeRecoveryPage(f).page,f.directory,opts(f))).qr).toBe('QR_READY');
    expect(await readFile(f.journalPath,'utf8')).toBe(before);
  }));
  it('refuses mismatched journals before provider reads',()=>fixture(async f=>{
    const j=JSON.parse(f.journalBefore);j.attempt.courtIds=[6];await writeFile(f.journalPath,JSON.stringify(j));const {page,mocks}=fakeRecoveryPage(f);
    expect((await recoverPendingHold(page,f.directory,opts(f))).code).toBe('CHECKOUT_RECOVERY_JOURNAL_MISMATCH');expect(mocks.evaluate).not.toHaveBeenCalled();
  }));
  it.each(['wrong summary','missing QR','blank QR','wrong URL','expires during navigation'])('retains confirmed hold but refuses incorrect QR: %s',kind=>fixture(async f=>{
    const {page,mocks,element,setUrl}=fakeRecoveryPage(f);const o=opts(f);let late=false;
    if(kind==='wrong summary')mocks.locator.mockImplementation(()=>({innerText:vi.fn(async()=>f.body.replace('1,800.00','600.00')),filter:()=>({first:()=>element})}));
    if(kind==='missing QR')element.waitFor.mockRejectedValue(Error('not visible'));
    if(kind==='blank QR')element.evaluate.mockResolvedValue(false);
    if(kind==='wrong URL')mocks.goto.mockImplementation(async()=>{setUrl('https://app.onda.fit/book/thirsty-pickle?bookingId=other');});
    if(kind==='expires during navigation'){o.now=()=>late?new Date('2026-11-01T01:11:00Z'):fixtureNow;mocks.goto.mockImplementation(async(u)=>{setUrl(u);late=true;});}
    const result=await recoverPendingHold(page,f.directory,o);expect(result.provider).toBe('PROVIDER_HOLD_CONFIRMED');expect(result.qr).toBe('FAILED');
  }));
  it('uses provider status for expiry/payment and never infers payment from QR',()=>fixture(async f=>{
    const {page}=fakeRecoveryPage(f);for(const b of f.provider.data.groupBookings)b.bookingStatus='expired';
    expect((await recoverPendingHold(page,f.directory,opts(f))).provider).toBe('EXPIRED_OR_UNAVAILABLE');
    f.provider.data.paymentStatus='paid';f.provider.data.bookingStatus='confirmed';for(const b of f.provider.data.groupBookings){b.bookingStatus='confirmed';b.paymentStatus='paid';}
    const result=await recoverPendingHold(page,f.directory,opts(f));expect(result.provider).toBe('PAYMENT_CONFIRMED');expect(result.qr).not.toBe('QR_READY');
  }));
  it('does not infer expiry from an old advertisement; records an after-expiry 404 separately',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);mocks.evaluate.mockResolvedValue({status:404,body:null,retryAfterMs:null});
    const result=await recoverPendingHold(page,f.directory,{...opts(f),now:()=>new Date('2026-11-01T01:11:00Z')});
    expect(result).toMatchObject({provider:'EXPIRED_OR_UNAVAILABLE',contradiction:false,code:'PROVIDER_NOT_FOUND_AFTER_ADVERTISED_EXPIRY'});
  }));
  it('serializes recovery per worker across controller instances without booking-lock edits',()=>fixture(async f=>{
    const {page,mocks}=fakeRecoveryPage(f);let unblock!:()=>void;
    const waiting=new Promise<void>(r=>unblock=r);mocks.evaluate.mockImplementationOnce(async()=>{await waiting;return {status:200,body:{},retryAfterMs:null};});
    const first=recoverPendingHold(page,f.directory,opts(f));
    while(!mocks.evaluate.mock.calls.length)await new Promise(r=>setTimeout(r,1));
    await expect(recoverPendingHold(fakeRecoveryPage(f).page,f.directory,opts(f))).rejects.toThrow('RECOVERY_WORKER_BUSY');unblock();await first;
    expect((await recoverPendingHold(fakeRecoveryPage(f).page,f.directory,opts(f))).qr).toBe('QR_READY');
  }));
});

describe('restart discovery, operator action and browser rotation',()=>{
  it('discovers A/B/C independently, requires fresh confirmation after restart and respects outstanding holds',()=>fixture(async a=>{
    const b=await pendingFixture(a.root,'B',6),c=await pendingFixture(a.root,'C',5),fixtures={A:a,B:b,C:c};
    const connect=vi.fn(async(worker:'A'|'B'|'C')=>({page:fakeRecoveryPage(fixtures[worker]).page,identity:fixtures[worker].identity,disconnect:vi.fn(async()=>{})}));
    const service=new PendingHoldService(a.root,connect as never,()=>fixtureNow),rows=await service.list();expect(rows).toHaveLength(3);
    const row=rows.find(r=>r.worker==='B')!;expect((await service.recover(row.id,'fresh')).qr).toBe('QR_READY');
    expect((await service.list()).find(r=>r.worker==='B')?.provider).toBe('PROVIDER_HOLD_CONFIRMED');
    const restarted=new PendingHoldService(a.root,connect as never,()=>fixtureNow);expect((await restarted.list()).find(r=>r.worker==='B')).toMatchObject({provider:'UNKNOWN',freshConfirmationRequired:true,outstanding:true});
    const candidates=(['A','B','C'] as const).map(worker=>({worker,profileVerified:true,customerVerified:true,browserClean:true,activeRunner:false}));
    expect(eligibleRecoveryTestWorkers(candidates,rows)).toEqual([]);expect(connect).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rows)).not.toContain('PRIVATE-');expect(JSON.stringify(rows)).not.toContain('fixture@example.invalid');
  }));
  it('exposes corrupt captures without leaking errors and rejects traversal and foreign IPC shapes',()=>fixture(async f=>{
    await writeFile(join(f.directory,'checkout-recovery-private.json'),'PRIVATE-CORRUPT-DATA');
    const service=new PendingHoldService(f.root,vi.fn() as never);const rows=await service.list();expect(rows[0]).toMatchObject({provider:'UNKNOWN',diagnostic:'PRIVATE_RECOVERY_RECORD_UNREADABLE'});
    const state={operation:'idle' as const};expect(await handlePendingRecovery(service,state,{action:'recover',id:'../secret',mode:'fresh'})).toHaveProperty('error','RECOVERY_REQUEST_INVALID');
    expect(await handlePendingRecovery(service,state,{action:'recover',id:'a'.repeat(64),mode:'fresh',checkoutToken:'secret'})).toHaveProperty('error','RECOVERY_REQUEST_INVALID');
  }));
  it('refuses provider reads during a release/runner/lab operation',()=>fixture(async f=>{
    const service=new PendingHoldService(f.root,vi.fn() as never);
    expect(await handlePendingRecovery(service,{operation:'scheduled'},{action:'list'})).toHaveProperty('error','RECOVERY_REQUIRES_IDLE_APPLICATION');
    expect(await handlePendingRecovery(service,{operation:'idle',activeApiRelease:{releaseMs:1,targetDate:'2026-11-03',phase:'WAITING'}},{action:'list'})).toHaveProperty('error','RECOVERY_REQUIRES_IDLE_APPLICATION');
    expect(await handlePendingRecovery(service,{operation:'idle'},{action:'list'},true)).toHaveProperty('error','RECOVERY_REQUIRES_IDLE_APPLICATION');
  }));
});
