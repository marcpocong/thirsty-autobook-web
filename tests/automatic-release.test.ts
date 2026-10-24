import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReleaseDraft, newReleaseProfile, parseReleaseProfile, preferenceDifferences } from '../src/automatic-release.js';
import { compileObjective, enumerateTargets, savedMangoReleaseSetup } from '../src/booking-objective.js';
import { adviseDailyBudget } from '../src/daily-budget.js';
import { releaseNotices } from '../src/release-reminders.js';
import { postRunReport } from '../src/post-run-report.js';
import { summarizeRunOutcome } from '../src/run-outcome.js';
import { DailyPlanning, planningMutationBlocked, restorationBlocked } from '../ui/daily-planning.js';
import { defaultSetup, bookingView } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import type { Dashboard } from '../ui/types.js';

const now=Date.parse('2026-10-22T23:59:00Z');
afterEach(()=>vi.restoreAllMocks());
const dashboard=()=>({operation:'idle',ready:false,lock:false,qrHandoffs:[],browserHealth:{A:true,B:true}} as unknown as Dashboard);
const goal=()=>{const p=newReleaseProfile(now);p.objective.wings.MANGO.minimum=2;p.objective.wings.MANGO.ideal=2;p.objective.wings.MANGO.courts=[7,6,5].map((court,i)=>({court,priority:i+1}));p.objective.wings.MANGO.durationHours=3;p.workers=['A','B'];return p;};
async function store(existing=false){const root=await mkdtemp(join(tmpdir(),'thirsty-daily-'));if(existing)await writeFile(join(root,'config.local.json'),'owner saved bytes');return {root,service:new DailyPlanning(root)};}

describe('automatic recurring drafts',()=>{
  it('defaults new profiles to enabled balanced 8-attempt Shotgun without authorization',()=>{
    const p=newReleaseProfile(now), d=generateReleaseDraft(p,now);
    expect(p).toMatchObject({enabled:true,preferredBudget:8,preset:'BALANCED'});expect(d).toMatchObject({status:'DRAFT',objective:{strategy:'SHOTGUN',shotgun:{budget:8,limitToIdeal:true}}});
    expect(d).not.toHaveProperty('armed');expect(d).not.toHaveProperty('authorization');
  });
  it.each([
    ['2026-10-22T23:59:59.999Z','2026-10-25'],['2026-10-23T00:00:00.000Z','2026-10-26'],
    ['2026-12-31T23:59:59.999Z','2027-01-03'],['2027-01-01T00:00:00.000Z','2027-01-04'],
    ['2026-10-31T00:00:00.000Z','2026-11-03']
  ])('uses authoritative Manila rollover at %s',(at,date)=>{
    const p=goal(), before=structuredClone(p), d=generateReleaseDraft(p,Date.parse(at));expect(d.targetDates.MANGO).toBe(date);expect(p).toEqual(before);
  });
  it('keeps Buko provisional and date +6 planning distinct from Mango +2',()=>{
    const p=goal();p.objective.wings.BUKO.enabled=true;const d=generateReleaseDraft(p,now);
    expect(d.targetDates).toEqual({MANGO:'2026-10-25',BUKO:'2026-10-29'});expect(d.notes.join(' ')).toContain('PROVISIONAL');
    expect(compileObjective(d.objective,{nowMs:now}).liveStatus).not.toBe('SUPPORTED');
  });
  it('preserves literal custom assignments and offsets through next date and runtime serialization',()=>{
    const p=goal(), ids=enumerateTargets(p.objective).targets.map(t=>t.id);
    p.distribution='CUSTOM';p.preset='CUSTOM';p.preferredBudget=4;
    p.objective.shotgun={...p.objective.shotgun,budget:4,allocationMode:'CUSTOM',timingMode:'CUSTOM',customAssignments:[ids[0]!,ids[1]!,ids[0]!,ids[1]!],customOffsetsMs:[-987,-654,-321,0]};
    const d=generateReleaseDraft(p,Date.parse('2026-10-23T00:00:00Z'));
    expect(d.objective.shotgun.customOffsetsMs).toEqual([-987,-654,-321,0]);expect(d.objective.shotgun.customAssignments?.every(id=>id.includes('2026-10-26'))).toBe(true);
    const c=compileObjective(d.objective,{nowMs:Date.parse('2026-10-23T00:00:00Z')});
    const runtime=savedMangoReleaseSetup(c,'2026-10-26');expect(runtime.problems).toEqual([]);
    expect(JSON.stringify(runtime.setup)).toContain('-987');expect(c.cohorts[0]?.immediate.map(t=>t.court)).toEqual([7,6]);
  });
  it('generates idempotently across concurrent ticks and restart; preserves config, manual draft and journals byte for byte',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);const {root,service}=await store(true), s=dashboard();
    await mkdir(join(root,'.local/booking-objective'),{recursive:true});await writeFile(join(root,'.local/booking-objective/draft.json'),'manual unsaved/saved draft bytes');
    await mkdir(join(root,'.local/api-booking'),{recursive:true});await writeFile(join(root,'.local/api-booking/unknown.json'),'UNKNOWN original bytes');
    expect((await service.view(s)).migrationRequired).toBe(true);
    await service.saveProfile(goal(),s);
    const views=await Promise.all(Array.from({length:4},()=>service.tick(s,undefined,now)));expect(new Set(views.map(v=>v.generated?.id)).size).toBe(1);
    // A responding CDP endpoint alone is not verified worker ownership/authentication capacity.
    expect(views[0]?.advice?.recommended).toBeNull();expect(views[0]?.advice?.executable).toBe(0);
    const restarted=await new DailyPlanning(root).tick(s,undefined,now+30_000);expect(restarted.generated?.id).toBe(views[0]?.generated?.id);expect(restarted.generated?.generatedAt).toBe(views[0]?.generated?.generatedAt);
    const next=await new DailyPlanning(root).tick(s,undefined,now+61_000);expect(next.generated?.id).not.toBe(restarted.generated?.id);
    expect(await readFile(join(root,'config.local.json'),'utf8')).toBe('owner saved bytes');expect(await readFile(join(root,'.local/booking-objective/draft.json'),'utf8')).toBe('manual unsaved/saved draft bytes');expect(await readFile(join(root,'.local/api-booking/unknown.json'),'utf8')).toBe('UNKNOWN original bytes');
  });
  it('does not generate while armed or active and never mutates the existing proposal',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);const {service}=await store();const s=dashboard();const first=await service.tick(s,undefined,now);
    for(const operation of ['scheduled','full','prepare'] as const){const active={...s,operation};expect(planningMutationBlocked(active)).toBe(true);const after=await service.tick(active,undefined,now+86400000);expect(after.generated).toEqual(first.generated);await expect(service.saveProfile(goal(),active)).rejects.toThrow('PLAN_ACTIVE');}
  });
  it('respects opt-out, with a manual generation action still available',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);const {service}=await store(true), p=goal(),s=dashboard();p.enabled=false;await service.saveProfile(p,s);
    expect((await service.tick(s,undefined,now)).generated).toBeNull();expect((await service.tick(s,undefined,now,true)).generated?.status).toBe('DRAFT');
  });
  it('refuses malformed metadata without resetting or overwriting it',async()=>{
    const {root}=await store();await mkdir(join(root,'.local/booking-objective'),{recursive:true});const path=join(root,'.local/booking-objective/daily-planning.json');await writeFile(path,'broken');
    await expect(new DailyPlanning(root).tick(dashboard())).rejects.toThrow('DAILY_STATE_UNREADABLE');expect(await readFile(path,'utf8')).toBe('broken');
    expect(()=>parseReleaseProfile({...goal(),preferredBudget:NaN})).toThrow('PROFILE_INVALID');
  });
});

describe('evidence-based preferred versus feasible budgets',()=>{
  it('keeps a high preferred budget and proposes a lower capacity count without editing it',()=>{
    const p=goal();p.preferredBudget=16;p.objective.shotgun.budget=16;const before=structuredClone(p.objective);
    const a=adviseDailyBudget(p.objective,{nowMs:now,unavailableWorkers:new Set(['C','D','E','F','G'])},{connectedWorkers:new Set(['A','B']),calibrationMatches:false,providerVolumePermitted:false,blockedSubmission:false,
      prior:{p95Source:'COMPATIBLE_MEASURED_HISTORY',preparationP95Ms:30492,sampleCount:16} as any});
    expect(a.preferred).toBe(16);expect(a.recommended).toBeLessThan(16);expect(a.executable).toBe(0);expect(a.reasons.join(' ')).toMatch(/calibration/);expect(p.objective).toEqual(before);
  });
  it('cannot invent a feasible distinct-court plan with worker shortage or an UNKNOWN blocker',()=>{
    const p=goal(),a=adviseDailyBudget(p.objective,{nowMs:now},{connectedWorkers:new Set(),calibrationMatches:false,providerVolumePermitted:false,blockedSubmission:true});expect(a).toMatchObject({recommended:null,executable:0,status:'BLOCKED'});
  });
  it('keeps custom offsets literal when capacity cannot support them',()=>{
    const p=goal();p.objective.shotgun.timingMode='CUSTOM';p.objective.shotgun.customOffsetsMs=[-901,-71,0];const before=structuredClone(p.objective);
    const a=adviseDailyBudget(p.objective,{nowMs:now},{connectedWorkers:new Set(),calibrationMatches:false,providerVolumePermitted:false,blockedSubmission:false});expect(a.recommended).toBeNull();expect(p.objective).toEqual(before);
  });
});

describe('persistent local reminders and reports',()=>{
  const reminder={fingerprint:'saved',releaseMs:now+5*60_000,armed:false,prepared:false,calibration:'EXPIRED',browsersConnected:false};
  it('sends only the nearest crossed interval on restart, and uses truthful hold/unknown messages',()=>{
    const notices=releaseNotices({...reminder,runId:'run',holds:1,unknown:1},now,[60,30,10]);expect(notices.filter(n=>n.id.includes('reminder:')).map(n=>n.id)).toEqual(['saved:reminder:10']);
    expect(notices.find(n=>n.id.includes('holds:'))?.body).toContain('not a paid booking');expect(notices.find(n=>n.id.includes('unknown:'))?.body).toContain('Do not retry');
  });
  it('deduplicates across renderer reload and restart using a durable delivery reservation',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);const {root,service}=await store(true),s=dashboard();
    s.booking=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Synthetic Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));s.booking.releaseMs=now+5*60_000;await service.saveProfile(goal(),s);
    const ids:string[]=[];await service.tick(s,n=>{ids.push(n.id);return true;},now);await service.tick(s,n=>{ids.push(n.id);return true;},now);
    await new DailyPlanning(root).tick(s,n=>{ids.push(n.id);return true;},now);expect(ids.length).toBeGreaterThan(1);expect(new Set(ids).size).toBe(ids.length);
  });
  it('records settled outcome accounting without confusing UNKNOWN, unsent, hold and payment',()=>{
    const s=dashboard();s.runTiming={runId:'fixture-run',label:'release',startedAt:new Date(now).toISOString(),endedAt:new Date(now+1).toISOString(),elapsedMs:1};s.runSummaryRunId='fixture-run';
    s.runSummary=summarizeRunOutcome([{state:'HOLD_VERIFIED'},{state:'UNKNOWN'},{state:'NOT_DISPATCHED',code:'SHOTGUN_TRIGGER_MISSED'}],3);
    const r=postRunReport(s,null,now)!;expect(r.summary).toMatchObject({initiated:2,holds:1,unknown:1,unsent:1});expect(r.conclusion).toMatch(/temporary holds/);expect(r.recommendations.join(' ')).toMatch(/do not retry/);
    s.runSummaryRunId='previous-run';expect(postRunReport(s)).toBeNull();
  });
});

describe('Last Known Good configuration',()=>{
  it('requires validation and a clean build; snapshot includes only configuration and evidence context',async()=>{
    const {root,service}=await store(true),s=dashboard();s.booking=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Synthetic Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    await expect(service.snapshot(s,null)).rejects.toThrow('SNAPSHOT_REQUIRES');s.build={buildId:'fixture',gitSha:'a'.repeat(40),dirty:false} as any;
    const entry=await service.snapshot(s,null);expect(entry.reason).toBe('CONFIGURATION_VALIDATED');expect(entry).not.toHaveProperty('authorization');expect(entry).not.toHaveProperty('journals');
    expect((await new DailyPlanning(root).snapshotById(entry.id)).setup).toEqual(s.booking.setup);expect(await service.snapshot(s,null)).toEqual(entry);
    expect(preferenceDifferences(entry.setup,{...entry.setup,START_TIME:'19:00'}).some(d=>d.field==='START_TIME')).toBe(true);
  });
  it('blocks restoration for active runs, possible holds, locks and UNKNOWN results',()=>{
    const s=dashboard();expect(restorationBlocked(s)).toBe(false);
    for(const patch of [{operation:'scheduled'},{lock:true},{possibleHolds:[{}]},{runSummary:{unknown:1}},{qrHandoffs:[{holdExpiresAt:new Date(Date.now()+60_000).toISOString()}]}])expect(restorationBlocked({...s,...patch} as Dashboard)).toBe(true);
  });
});
