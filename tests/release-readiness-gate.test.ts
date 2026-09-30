import {describe,expect,it} from 'vitest';
import {evaluateReleaseReadiness} from '../src/release-readiness-gate.js';

const base=()=>({build:{schema:'thirsty-build-info/v1' as const,kind:'installation' as const,gitSha:'a'.repeat(40),branch:'main',dirty:false,builtAt:'2026-09-30T00:00:00Z',packageVersion:'0.1.0',node:'v24',contentId:'b'.repeat(64),buildId:'x'},
  testedBuild:{gitSha:'a'.repeat(40),dirty:false,finishedAt:'2026-09-30T00:00:00Z',packaged:true},configValid:true,authorizationValid:true,
  clock:{synced:true,ageMs:1000,uncertaintyMs:2,offsetMs:1},machine:{measuredAt:'2026-09-30T00:00:00Z',cpuCount:8,memoryUsedPct:50,eventLoopP95Ms:2,processRssMb:200},
  workers:{A:{connected:true,identityValid:true,securityReady:true}},observer:{online:true,lastReadAgeMs:100,availabilityLatencyMs:20},fanOut:{compatible:true,stale:false,width:2},prewarm:true});
describe('release readiness gate',()=>{
  it('reports READY only when every check is good',()=>expect(evaluateReleaseReadiness(base()).verdict).toBe('READY'));
  it('warns for a degraded worker without silently excluding it',()=>{const input=base();input.workers.A.securityReady=false;const result=evaluateReleaseReadiness(input);expect(result.verdict).toBe('READY_WITH_WARNINGS');expect(result.degradedWorkers).toEqual(['A']);});
  it('hard-blocks an invalid saved authorization or missing trusted clock',()=>{const input=base();input.authorizationValid=false;input.clock.synced=false;expect(evaluateReleaseReadiness(input).verdict).toBe('NOT_READY');});
});
