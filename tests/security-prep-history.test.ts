import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {securityPrepHistory} from '../src/security-prep-history.js';

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'thirsty-prep-history-'));await mkdir(join(root,'.local/api-booking/run-progress'),{recursive:true});});
afterEach(async()=>{if(root&&resolve(root).startsWith(resolve(tmpdir())+sep))await rm(root,{recursive:true,force:true});});
const samples=async(durations:number[],failure=false,concurrent=2)=>writeFile(join(root,'.local/api-booking/run-progress/fixture.ndjson'),durations.map(durationMs=>JSON.stringify({
  stage:'SECURITY_PREPARATION_COMPLETED',source:'FRESH_ACQUISITION',durationMs,activeSecurity:concurrent-1,at:new Date().toISOString(),...(failure?{failureCategory:'SECURITY_FAILED'}:{})})).join('\n'));
describe('compatible preparation duration evidence is never a success authorization',()=>{
  it('retains the exact eight-sample 30.492-second p95 for two workers',async()=>{
    await samples([8000,9000,10000,11789,12000,15000,20000,30492]);
    expect(securityPrepHistory(root,2)).toMatchObject({samples:8,p95Ms:30492,atConcurrency:2});
  });
  it('does not treat failed preparation durations as successful evidence',async()=>{
    await samples([60000,60000,60000,60000,60000],true);
    expect(securityPrepHistory(root,2)).toMatchObject({samples:0,p95Ms:null,atConcurrency:null});
  });
  it('keeps small samples and incompatible concurrency non-applicable',async()=>{
    await samples([1000,2000,3000,4000]);
    expect(securityPrepHistory(root,2)).toMatchObject({samples:4,atConcurrency:null});
    await samples([1000,2000,3000,4000,5000],false,8);
    expect(securityPrepHistory(root,2)).toMatchObject({samples:5,atConcurrency:null});
  });
  it('reports missing history without inventing measurements',()=>{
    expect(securityPrepHistory(root,2)).toMatchObject({samples:0,p95Ms:null,atConcurrency:null});
  });
});
