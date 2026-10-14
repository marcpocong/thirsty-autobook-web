import { DualWingPlanSchema } from '../src/dual-wing-plan-schema.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileDualWingPlan, type DualWingPlan } from '../src/dual-wing-plan.js';
import { validateLabRequest, type LabRequest, type LabResult } from '../src/shotgun-test-lab.js';
import { nextWingRelease, WING_RELEASE_POLICIES } from '../src/wing-release-policy.js';

/** One isolated rehearsal child. Operator/customer configuration is never read. */
export class ShotgunLabService {
  child:ChildProcess|null=null;
  busy=false;
  private stopRequested=false;
  private completion:Promise<void>=Promise.resolve();
  private finished:(()=>void)|undefined;
  constructor(private root:string,private node:string,private onPhase?:(phase:string)=>void){}
  preview(value:DualWingPlan) {
    if(JSON.stringify(value).length>50000)throw Error('LAB_INPUT_TOO_LARGE');
    return compileDualWingPlan(DualWingPlanSchema.parse(value));
  }
  defaults(){return {MANGO:nextWingRelease(new Date(),'MANGO'),BUKO:nextWingRelease(new Date(),'BUKO'),policies:WING_RELEASE_POLICIES};}
  async save(value:DualWingPlan){
    const compiled=this.preview(value);if(!compiled.phase3)throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
    await mkdir(join(this.root,'.local/shotgun-test-lab'),{recursive:true});
    await writeFile(join(this.root,'.local/shotgun-test-lab/planning-only.json'),JSON.stringify(value,null,2));
  }
  async load():Promise<DualWingPlan|null>{try{const value=JSON.parse(await readFile(join(this.root,'.local/shotgun-test-lab/planning-only.json'),'utf8')) as DualWingPlan;this.preview(value);return value;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
  stop(){this.stopRequested=true;this.child?.send('stop');}
  async stopAndWait(){this.stop();await this.completion;}
  async run(input:LabRequest):Promise<LabResult>{
    if(this.busy)throw Error('LAB_ALREADY_RUNNING');
    this.busy=true;this.stopRequested=false;this.completion=new Promise(done=>{this.finished=done;});
    try {
    this.preview(input.plan);validateLabRequest(input);
    const directory=resolve(this.root,'.local/shotgun-test-lab/runs',randomUUID());
    await mkdir(directory,{recursive:true});
    const file=join(directory,'input.json');await writeFile(file,JSON.stringify(input));
    return await new Promise<LabResult>((done,fail)=>{
      let result:LabResult|undefined,error:string|undefined;
      const child=spawn(this.node,[join(this.root,'dist/src/shotgun-test-lab-child.js'),file,directory],{cwd:this.root,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
      this.child=child;if(this.stopRequested)child.send('stop');
      child.on('message',(value:unknown)=>{const message=value as {result?:LabResult;error?:string;phase?:string};if(message.phase)this.onPhase?.(message.phase);if(message.result)result=message.result;if(message.error)error=message.error;});
      child.on('error',e=>{this.child=null;fail(e);});
      child.on('exit',code=>{this.child=null;if(code===0&&result)done(result);else fail(Error(error??'LAB_CHILD_FAILED'));});
    });
    } finally {this.busy=false;this.finished?.();}
  }
}
