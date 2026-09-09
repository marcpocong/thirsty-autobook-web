import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { ConfigSchema, calculateTarget, compilePreferences, expandHours } from '../src/config.js';
import { parseCell, resolvePreference } from '../src/grid.js';
import { Safety, requireArmed, securityReason, waitUntil } from '../src/safety.js';
import { boundedRelease } from '../src/release.js';
import { Telemetry } from '../src/telemetry.js';
import { checkout, validateSummary, type BookingSummary, type CheckoutAdapter, type Player } from '../src/checkout.js';

const input = { START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7,6], FALLBACK_COURTS: [1], FALLBACK_TIMES: ['10:00'], MAX_PRICE: 1500, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '+639000000000', PLAYER_EMAIL: 'fixture@example.invalid' };
const config = ConfigSchema.parse(input);
describe('configuration and calendar', () => {
  it('uses Manila calendar date across UTC midnight and year end', () => {
    const target = calculateTarget(config, DateTime.fromISO('2026-12-31T17:00:00Z'));
    expect(target.targetDate).toBe('2027-01-03');
    expect(target.releaseISO).toBe('2027-01-01T08:00:00.000+08:00');
  });
  it('calculates +2 calendar days and 08:00 release', () => {
    const target = calculateTarget(config, DateTime.fromISO('2026-09-10T07:59:00+08:00'));
    expect(target.targetDate).toBe('2026-09-12');
    expect(target.releaseMs).toBe(Date.parse('2026-09-10T08:00:00+08:00'));
  });
  it('defaults release lead to zero', () => expect(config.RELEASE_LEAD_MS).toBe(0));
  it.each([-1, 1, NaN, Infinity])('rejects unvalidated release lead %s', value => expect(ConfigSchema.safeParse({ ...input, RELEASE_LEAD_MS: value }).success).toBe(false));
  it.each([{ START_TIME: '25:00' }, { START_TIME: '08:30' }, { DURATION_HOURS: 0 }, { DURATION_HOURS: 1.5 }, { TIMEZONE: 'Invalid' }, { MAX_PRICE: -1 }, { PREFERRED_COURTS: [] }, { PREFERRED_COURTS: [1,1] }, { FALLBACK_COURTS: [7] }, { FALLBACK_TIMES: ['08:00'] }, { PLAYER_FULL_NAME: '' }, { PLAYER_PHONE: '' }, { PLAYER_EMAIL: 'bad' }, { CDP_URL: 'http://0.0.0.0:9222' }, { MAX_RELEASE_RELOADS: 3 }, { RELEASE_TIME: '25:00:00' }])('rejects invalid configuration %j', delta => expect(ConfigSchema.safeParse({ ...input, ...delta }).success).toBe(false));
  it('compiles exact time-first then court order', () => expect(compilePreferences(config).map(p => [p.court, p.hours[0]])).toEqual([[7,'08:00'],[6,'08:00'],[1,'08:00'],[7,'10:00'],[6,'10:00'],[1,'10:00']]));
  it('expands hourly slots and rejects midnight crossing', () => { expect(expandHours('10:00',2)).toEqual(['10:00','11:00']); expect(() => expandHours('23:00',2)).toThrow(); });
});
describe('slot semantics', () => {
  const raw = { date: '2026-09-11', hour:'10:00', label:'Court 1: Mango Wing 10 AM to 11 AM available', state:'available', disabled:false };
  it('requires agreeing semantic state and availability', () => { expect(parseCell(raw).state).toBe('OPEN'); expect(parseCell({...raw, disabled:true}).state).toBe('UNKNOWN'); expect(parseCell({...raw, state:'surprise'}).state).toBe('UNKNOWN'); });
  it('requires matching hour and hourly duration', () => { expect(parseCell({...raw,hour:'11:00'}).state).toBe('UNKNOWN'); expect(parseCell({...raw,label:'Court 1: Mango Wing 10 AM to 12 PM available'}).state).toBe('UNKNOWN'); });
  it('never combines different courts or selects UNKNOWN', () => {
    const a=parseCell(raw), b={...a,court:2,hour:'11:00'};
    expect(resolvePreference([a,b],[{court:1,hours:['10:00','11:00']}])).toBeUndefined();
    expect(resolvePreference([{...a,state:'UNKNOWN'}],[{court:1,hours:['10:00']}])).toBeUndefined();
  });
});
describe('safety', () => {
  it('forbids fallback after booking lock',()=>{const s=new Safety();s.fallback();s.lock();expect(()=>s.fallback()).toThrow('BOOKING_LOCKED');});
  it('abort and disconnect disable subsequent operations',()=>{for(const reason of ['USER_ABORT','CHROME_DISCONNECTED']){const s=new Safety();s.stop(reason);expect(()=>s.check()).toThrow(reason);}});
  it('aborts scheduler promptly',async()=>{const c=new AbortController();const waiting=waitUntil(Date.now()+100000,c.signal);c.abort();await expect(waiting).rejects.toThrow();});
  it('does not trigger scheduler early',async()=>{const target=Date.now()+20;await waitUntil(target,new AbortController().signal);expect(Date.now()).toBeGreaterThanOrEqual(target);});
  it('bounds reloads and stops on security error',async()=>{let calls=0;await expect(boundedRelease(2,0,new AbortController().signal,async()=>{calls++;return undefined;})).rejects.toThrow('RELEASE_HORIZON');expect(calls).toBe(2);calls=0;await expect(boundedRelease(2,0,new AbortController().signal,async()=>{calls++;throw Error('RATE_LIMITED');})).rejects.toThrow('RATE_LIMITED');expect(calls).toBe(1);});
  it('recognizes rate limit and human challenges',()=>{expect(securityReason('Too many requests')).toBe('RATE_LIMITED');expect(securityReason('Verify you are human')).toBe('SECURITY_CHALLENGE');expect(securityReason('Court Schedule')).toBeUndefined();});
  it('requires armed on all scheduled modes',()=>{for(const m of ['race','race:dry','release:observe']){expect(()=>requireArmed(m,false)).toThrow('ARMED_FLAG_REQUIRED');expect(()=>requireArmed(m,true)).not.toThrow();}});
  it('records numeric metadata without input objects',()=>{const t=new Telemetry();t.mark('playerFillCompleted',{email:'private@example.invalid'} as unknown as number);expect(JSON.stringify(t.events)).not.toContain('private');expect(()=>t.mark('private@example.invalid')).toThrow();});
});
describe('checkout contract — synthetic, no live adapter',()=>{
  const summary:BookingSummary={venue:'Thirsty Pickle | SM Seaside',date:'2026-09-11',court:1,start:'10:00',end:'12:00',duration:2,amount:1200,currency:'PHP'};
  const player:Player={fullName:'Fixture Player',phone:'+639000000000',email:'fixture@example.invalid'};
  function fixture(){const calls:string[]=[]; const adapter:CheckoutAdapter={review:async()=>{calls.push('review');return summary;},fillPlayer:async p=>{calls.push('fill');return p;},playerProceed:async()=>{calls.push('playerProceed');},paymentSummary:async()=>{calls.push('summary');return summary;},acceptTerms:async()=>{calls.push('terms');return true;},finalOndaAction:async()=>{calls.push('final');}};return {calls,adapter};}
  it.each(['venue','date','court','start','end','duration','currency'] as const)('stops for review/payment %s mismatch',key=>{const bad={...summary,[key]:'wrong'};expect(()=>validateSummary(bad,summary,1500,'REVIEW')).toThrow('MISMATCH');expect(()=>validateSummary(bad,summary,1500,'PAYMENT')).toThrow('MISMATCH');});
  it('enforces maximum price and exact reviewed payment amount',()=>{expect(()=>validateSummary({...summary,amount:1600},summary,1500,'REVIEW')).toThrow('PRICE');expect(()=>validateSummary({...summary,amount:1201},summary,1500,'PAYMENT')).toThrow('PRICE');});
  it('does not accept terms without per-run authorization',async()=>{const {calls,adapter}=fixture();expect(await checkout(adapter,new Safety(),new Telemetry(),summary,player,1500,false)).toBe('TERMS_NOT_AUTHORIZED');expect(calls).toEqual(['review','fill','playerProceed','summary']);});
  it('stops on incorrect player values',async()=>{const {calls,adapter}=fixture();adapter.fillPlayer=async()=>({...player,email:'wrong@example.invalid'});await expect(checkout(adapter,new Safety(),new Telemetry(),summary,player,1500,true)).rejects.toThrow('PLAYER_VALUES');expect(calls).not.toContain('playerProceed');});
  it('hands off and permanently forbids all future interaction',async()=>{const {calls,adapter}=fixture();const s=new Safety();expect(await checkout(adapter,s,new Telemetry(),summary,player,1500,true)).toBe('PAYMENT_BOUNDARY_REACHED');expect(calls.at(-1)).toBe('final');expect(()=>s.check()).toThrow('PAYMENT_BOUNDARY');expect(()=>s.fallback()).toThrow();});
  it('seals boundary even when final click fails ambiguously',async()=>{const s=new Safety();await expect(s.finalAction(async()=>{throw Error('transport lost');})).rejects.toThrow('transport lost');expect(()=>s.check()).toThrow('PAYMENT_BOUNDARY');});
});
