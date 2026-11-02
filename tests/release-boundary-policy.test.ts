import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {defaultObjective,compileObjective,savedMangoReleaseSetup,objectiveFromLegacySetup} from '../src/booking-objective.js';
import {BookingSetupSchema,ConfigSchema,planFingerprint} from '../src/config.js';
import {armPrecisionRace,fireArmedAttempt,armedWindow} from '../src/api-booking/armed-dispatch.js';
import {freezePrecisionRace,precisionTargetPlan,validatePrecisionTargets,assertPrecisionFreezeIntact} from '../src/api-booking/precision-race.js';
import {consumeSubmissionPermit} from '../src/api-booking/durable-submission-journal.js';
import {CriticalPathRecorder} from '../src/api-booking/critical-path.js';

const now=Date.parse('2026-11-02T08:00:00Z'),release=Date.parse('2026-11-03T00:00:00Z');
const customer={clientId:'00000000-0000-4000-8000-00000000c11e',customerId:'00000000-0000-4000-8000-000000000b00',customerEmail:'fixture@example.invalid',customerPhone:'09123456789',customerFirstName:'Fixture',customerLastName:'Player'};
function objective(){const o=defaultObjective(now);o.wings.MANGO.courts=[5,6,7].map((court,i)=>({court,priority:i+1}));o.wings.MANGO.durationHours=3;
  o.shotgun={...o.shotgun,releaseTimingPolicy:'ZERO_BOUNDARY_V1',budget:1,windowStartMs:0,windowEndMs:0,limitToIdeal:true};return o;}

describe('opt-in zero-boundary production Shotgun policy',()=>{
  it('round trips the corrected target and policy; both authorization fingerprints change when policy changes',()=>{
    const o=objective(),compiled=compileObjective(o,{nowMs:now});expect(compiled.problems).toEqual([]);
    expect(compiled.attemptCount).toBe(1);expect(compiled.cohorts[0]?.releaseMs).toBe(release);
    const setup=BookingSetupSchema.parse(savedMangoReleaseSetup(compiled,'2026-11-05').setup);
    expect(setup.STRATEGY_V2?.shotgun?.releaseTimingPolicy).toBe('ZERO_BOUNDARY_V1');
    expect(setup.STRATEGY_V2?.shotgun?.exactSchedule.map(s=>s.configuredOffsetMs)).toEqual([0]);
    expect(setup.PRECISION_PHASE3?.budgets).toEqual({wave2:0,rescue:0,total:1});
    expect(objectiveFromLegacySetup(setup,now).objective.shotgun.releaseTimingPolicy).toBe('ZERO_BOUNDARY_V1');
    const other=structuredClone(o);delete other.shotgun.releaseTimingPolicy;
    expect(compileObjective(other,{nowMs:now}).fingerprint).not.toBe(compiled.fingerprint);
    const config=ConfigSchema.parse({...setup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_EMAIL:'fixture@example.invalid',PLAYER_PHONE:'09123456789'});
    const legacy=structuredClone(config);delete legacy.STRATEGY_V2!.shotgun!.releaseTimingPolicy;
    expect(planFingerprint(config)).not.toBe(planFingerprint(legacy));
  });
  it.each([-1,1])('refuses a literal %s ms policy mismatch without shifting it',offset=>{
    const o=objective();o.shotgun.timingMode='CUSTOM';o.shotgun.customOffsetsMs=[offset];
    expect(compileObjective(o,{nowMs:now}).problems.length).toBeGreaterThan(0);expect(o.shotgun.customOffsetsMs).toEqual([offset]);
  });
  it('rejects a second send, shifted window, or backup budget',()=>{
    const o=objective();o.shotgun.budget=2;expect(compileObjective(o,{nowMs:now}).problems.join(' ')).toContain('ZERO_BOUNDARY_V1');
    const setup=BookingSetupSchema.parse(savedMangoReleaseSetup(compileObjective(objective(),{nowMs:now}),'2026-11-05').setup);
    setup.PRECISION_PHASE3!.budgets.wave2=1;expect(BookingSetupSchema.safeParse(setup).success).toBe(false);
  });
  it.each([-1,0,50,51])('uses real production arming/one-use dispatch at T%+d ms',async offset=>{
    const root=await mkdtemp(join(tmpdir(),'release-boundary-'));
    try{const target=validatePrecisionTargets([{court:5,start:'19:00',durationHours:3}],'2026-11-05')[0]!;
      const attempt={target,plan:precisionTargetPlan(target,'2026-11-05'),dispatchTimingPolicy:'SHOTGUN_STRICT' as const,releaseTimingPolicy:'ZERO_BOUNDARY_V1' as const};
      const race=freezePrecisionRace('2026-11-05',release,[attempt]);
      expect(race.fingerprint).not.toBe(freezePrecisionRace('2026-11-05',release,[{...attempt,releaseTimingPolicy:undefined}]).fingerprint);
      assertPrecisionFreezeIntact(race);
      const armed=await armPrecisionRace(race,{journalRoot:root,releaseMs:release,now:()=>release-1000,customerFor:()=>customer});let posts=0;
      const transport={publicCheckoutProofless:async(_request:unknown,permit:Parameters<typeof consumeSubmissionPermit>[0],options:any)=>{
        options.beforePost();expect(options.strictTiming).toEqual({notBeforeNodeMs:release,notAfterNodeMs:release+50});
        consumeSubmissionPermit(permit,armed.attempts[0]!.key);posts++;return {};}};
      const action=()=>fireArmedAttempt(armed.attempts[0]!,transport,{nowMs:()=>release+offset,monotonicDeadline:n=>n},armedWindow(armed,armed.attempts[0]!),()=>false);
      if(offset<0||offset>50)await expect(action()).rejects.toThrow(offset<0?'DIRECT_RELEASE_NOT_REACHED':'SHOTGUN_TRIGGER_MISSED');else await action();
      expect(posts).toBe(offset>=0&&offset<=50?1:0);await expect(action()).rejects.toThrow();
    }finally{if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
  });
  it('keeps lookup, confirmation and QR marks in the original monotonic domain',()=>{
    const r=new CriticalPathRecorder(release,1000,0,['A']);r.mark('A','providerLookup',1010);r.mark('A','providerConfirmed',1020);r.mark('A','checkoutNavigation',1030);r.mark('A','qrReady',1040);
    expect(r.rows()[0]!.lifecycle).toMatchObject({providerLookupMs:10,providerConfirmedMs:20,checkoutNavigationMs:30,qrReadyMs:40});
    const empty=new CriticalPathRecorder(release,1000,0,['A']).rows()[0]!;expect(empty.lifecycle?.providerConfirmedMs).toBeNull();expect(empty.fetchInvokedMs).toBeNull();
  });
});
