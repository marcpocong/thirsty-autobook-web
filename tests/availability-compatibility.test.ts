import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {availabilityRequestPath,availabilityFailureStatus} from '../src/api-booking/availability-contract.js';
import {OndaLiveAvailabilityProvider,LiveAvailabilityError} from '../src/api-booking/live-availability-provider.js';
import {availabilityFixture} from './availability-fixture.js';
import {parseAvailability} from '../src/api-booking/availability-parser.js';
import {targetDateState,courtHourStates,countCourtHourStates} from '../src/api-booking/court-hour-matrix.js';
import {readPreReleaseEvidence,classifyTargetEvidence,assertScheduledAvailabilityAccess} from '../src/api-booking/pre-release-evidence.js';
import {runNetworkReadiness} from '../src/network-readiness.js';
import {waitForObserverExit} from '../src/observer-chrome.js';

const date='2026-11-05',releaseMs=Date.parse('2026-11-03T00:00:00Z'),observedAtMs=releaseMs-120_000;
const parse=(raw:unknown)=>parseAvailability(raw,{startDate:date,endDate:date,capturedAt:new Date(observedAtMs).toISOString(),now:new Date(observedAtMs),maximumAgeMs:15000,fixtureKind:'synthetic',label:'OFFLINE_COMPATIBILITY'});
function closed(){const raw=availabilityFixture(date);for(const slots of Object.values(raw.data.slotsBySpace))for(const slot of slots)slot.isAvailable=false;return raw;}

describe('official availability compatibility and release separation',()=>{
  it('uses the observed fixed endpoint and asks for membership restrictions without guessing another source',()=>{
    const url=new URL(availabilityRequestPath(date),'https://app.onda.fit');
    expect(url.pathname).toBe('/api/public/facilities/5f8786bd-dc61-4509-b893-74cda8f783f7/date-availability');
    expect(Object.fromEntries(url.searchParams)).toEqual({startDate:date,endDate:date,duration:'60',includeSchedule:'true',includeMemberOnlyAccess:'true',slotDateMode:'web-operating-day'});
    expect(()=>availabilityRequestPath('2026-02-31')).toThrow('AVAILABILITY_QUERY_INVALID');
  });
  it.each([[401,'AVAILABILITY_AUTH_REQUIRED'],[403,'AVAILABILITY_ACCESS_DENIED'],[429,'AVAILABILITY_RATE_LIMITED'],[404,'AVAILABILITY_ENDPOINT_UNSUPPORTED'],[410,'AVAILABILITY_ENDPOINT_UNSUPPORTED']] as const)('classifies HTTP %s and releases its failed response without retry',async(status,classification)=>{
    let cancelled=0;const fetcher=vi.fn(async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{status}));
    const provider=new OndaLiveAvailabilityProvider({fetcher});
    await expect(provider.getAvailability({startDate:date,endDate:date})).rejects.toMatchObject({httpStatus:status,classification,requestSent:true});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(cancelled).toBe(1);
  });
  it('keeps stale, incompatible, transport and unknown states distinct',()=>{
    expect(availabilityFailureStatus(Error('AVAILABILITY_SNAPSHOT_STALE'))).toBe('AVAILABILITY_STALE');
    expect(availabilityFailureStatus(Error('AVAILABILITY_SLOT_INVALID'))).toBe('AVAILABILITY_RESPONSE_INCOMPATIBLE');
    expect(availabilityFailureStatus(Error('AVAILABILITY_TRANSPORT_FAILED'))).toBe('AVAILABILITY_TRANSPORT_FAILED');
    expect(availabilityFailureStatus(Error('AVAILABILITY_BROWSER_PREPARATION_REQUIRED'))).toBe('AVAILABILITY_UNKNOWN');
  });
  it('rejects old server cache evidence even when the browser received it just now',async()=>{
    const provider=new OndaLiveAvailabilityProvider({fetcher:async()=>new Response(JSON.stringify(availabilityFixture(date)),{headers:{'content-type':'application/json','age':'120'}})});
    await expect(provider.getAvailability({startDate:date,endDate:date})).rejects.toMatchObject({code:'AVAILABILITY_SNAPSHOT_STALE',classification:'AVAILABILITY_STALE'});
  });
  it.each([null,[],{restricted:true}])('refuses unqualified member-only metadata %j instead of claiming OPEN',memberOnlyAccessBySlot=>{
    const raw=availabilityFixture(date);expect(()=>parse({...raw,data:{...raw.data,memberOnlyAccessBySlot}})).toThrow('AVAILABILITY_MEMBERSHIP_UNVERIFIED');
  });
  it('accepts the observed empty membership map while preserving legacy snapshots',()=>{
    const raw=availabilityFixture(date);expect(parse({...raw,data:{...raw.data,memberOnlyAccessBySlot:{}}}).slots).toEqual(parse(raw).slots);
  });
  it('classifies a complete closed future template as unreleased even when dates:true, without fabricating openness',async()=>{
    const snapshot=parse(closed());expect(targetDateState(snapshot,date,{releaseMs,observedAtMs})).toBe('UNRELEASED');
    expect(countCourtHourStates(courtHourStates(snapshot,date,{releaseMs,observedAtMs}))).toEqual({OPEN:0,TAKEN:0,UNRELEASED:112,UNKNOWN:0});
    const evidence=await readPreReleaseEvidence({date,releaseMs,now:()=>observedAtMs,sleep:async()=>{throw Error('NO_RETRY_EXPECTED');},readAvailability:async()=>snapshot,readBookings:async()=>({blocks:[],failedCourts:[]})});
    expect(()=>assertScheduledAvailabilityAccess(evidence)).not.toThrow();
    expect(classifyTargetEvidence({court:5,start:'19:00',durationHours:3},evidence,date)).toMatchObject({eligible:true,evidence:'NO_PUBLIC_BOOKING_DATE_UNRELEASED'});
    expect(classifyTargetEvidence({court:5,start:'19:00',durationHours:3},{...evidence,blocks:[{court:5,startTime:'19:00',endTime:'20:00'}]},date).eligible).toBe(false);
  });
  it('does not infer an unreleased template from a failed read, incomplete cells, an open cell or a boundary-time response',()=>{
    const snapshot=parse(closed());expect(targetDateState(undefined,date,{releaseMs,observedAtMs})).toBe('UNKNOWN');
    expect(targetDateState({...snapshot,slots:snapshot.slots.slice(1)},date,{releaseMs,observedAtMs})).toBe('RELEASED');
    expect(targetDateState({...snapshot,slots:[{...snapshot.slots[0]!,isAvailable:true},...snapshot.slots.slice(1)]},date,{releaseMs,observedAtMs})).toBe('RELEASED');
    expect(targetDateState(snapshot,date,{releaseMs,observedAtMs:releaseMs-999})).toBe('RELEASED');
  });
  it.each([401,403,429])('cannot authorize scheduled preparation from an HTTP %s denial',async status=>{
    let reads=0;const evidence=await readPreReleaseEvidence({date,releaseMs,now:()=>observedAtMs,sleep:async()=>{throw Error('NO_RETRY');},readAvailability:async()=>{reads++;throw new LiveAvailabilityError('AVAILABILITY_HTTP_FAILED',status,true);},readBookings:async()=>({blocks:[],failedCourts:[]})});
    expect(reads).toBe(1);expect(evidence.dateState).toBe('UNKNOWN');expect(()=>assertScheduledAvailabilityAccess(evidence)).toThrow(evidence.availabilityFailure!.classification);
  });
  it.each([401,403,429])('ends the Network Readiness action after its first HTTP %s',async status=>{
    const fetcher=vi.fn(async()=>new Response('',{status}));const r=await runNetworkReadiness({date,requests:5,spacingMs:0,fetcher,dns:async()=>{},interfaces:()=>({}),clockRound:async()=>{throw Error('OFFLINE_CLOCK');}});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(r).toMatchObject({requests:1,requestedRequests:5,succeeded:0,failed:1,verdict:'INSUFFICIENT_DATA'});expect(r.samples[0]?.httpStatus).toBe(status);
  });
});

describe('observer exit race and timer cleanup',()=>{
  it('returns immediately for an exit that happened before Browser.close replied',async()=>{
    vi.useFakeTimers();try{const child=new EventEmitter();await waitForObserverExit(child as ChildProcess,()=>true);expect(child.listenerCount('exit')).toBe(0);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
  });
  it('removes the timeout and listener after a normal exit',async()=>{
    vi.useFakeTimers();try{const child=new EventEmitter();let exited=false;const pending=waitForObserverExit(child as ChildProcess,()=>exited);exited=true;child.emit('exit',0);await pending;expect(child.listenerCount('exit')).toBe(0);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
  });
});
