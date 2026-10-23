import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BookingSetupSchema, type BookingSetup } from '../src/config.js';
import { compileObjective, savedMangoReleaseSetup, parseStoredObjective, objectiveProblems } from '../src/booking-objective.js';
import { generateReleaseDraft, newReleaseProfile, parseReleaseProfile, preferenceDifferences, type ReleaseProfile, type GeneratedReleaseDraft } from '../src/automatic-release.js';
import { nextReleaseFor, releaseInstantFor } from '../src/wing-release-data.js';
import { adviseDailyBudget, type BudgetAdvice } from '../src/daily-budget.js';
import { releaseNotices, type LocalNotice } from '../src/release-reminders.js';
import { postRunReport, type PostRunReport } from '../src/post-run-report.js';
import type { Dashboard } from './types.js';

export interface ConfigurationSnapshot {
  id: string; createdAt: string; setup: BookingSetup; profile: ReleaseProfile | null;
  objective: import('../src/booking-objective.js').BookingObjective | null;
  build: Dashboard['build']; calibration: Dashboard['shotgunTimingVerdict'];
  reason: 'CONFIGURATION_VALIDATED';
}
interface DailyDocument {
  version: 1; profile: ReleaseProfile | null; generated: GeneratedReleaseDraft | null;
  delivered: string[]; snapshots: ConfigurationSnapshot[]; reports: PostRunReport[];
}
export interface DailyView {
  profile: ReleaseProfile | null; generated: GeneratedReleaseDraft | null; migrationRequired: boolean;
  advice: BudgetAdvice | null; snapshots: Array<Omit<ConfigurationSnapshot,'setup'|'profile'|'objective'>>;
  reports: PostRunReport[]; error: string | null;
}
export const planningMutationBlocked = (s: Dashboard) => s.operation !== 'idle' || !!s.scheduledRelease || !!s.activeApiRelease;
export const restorationBlocked = (s: Dashboard) => planningMutationBlocked(s) || !!s.lock || !!s.possibleHolds?.length || !!s.runSummary?.unknown ||
  !!s.qrHandoffs?.some(h => !h.holdExpiresAt || Date.parse(h.holdExpiresAt) > Date.now());

/** Metadata under the existing objective namespace; config.local.json remains the ONLY runtime plan store. */
export class DailyPlanning {
  private queue: Promise<unknown> = Promise.resolve();
  private document: DailyDocument | null = null;
  private path: string;
  constructor(private root: string) { this.path = join(root,'.local/booking-objective/daily-planning.json'); }
  exclusive<T>(fn: () => Promise<T>): Promise<T> { const result = this.queue.then(fn); this.queue = result.catch(() => undefined); return result; }
  private async load(): Promise<DailyDocument> {
    if (this.document) return this.document;
    try {
      const raw=await readFile(this.path,'utf8');if(raw.length>8_000_000)throw Error('DAILY_STATE_TOO_LARGE');
      const d = JSON.parse(raw) as DailyDocument;
      if (d.version !== 1 || !Array.isArray(d.delivered) || !Array.isArray(d.snapshots) || !Array.isArray(d.reports)) throw Error('DAILY_STATE_INVALID');
      if(d.delivered.some(id=>typeof id!=='string'||id.length>250)||new Set(d.delivered).size!==d.delivered.length||d.snapshots.length>20||d.reports.length>50)throw Error('DAILY_STATE_INVALID');
      if (d.profile) d.profile = parseReleaseProfile(d.profile);
      if(d.generated){const g=d.generated,o=parseStoredObjective(g.objective);
        if(g.version!==1||g.status!=='DRAFT'||!/^[a-f0-9]{64}$/.test(g.id)||!Number.isFinite(Date.parse(g.generatedAt))||!Number.isFinite(Date.parse(g.releaseAt))||!o||objectiveProblems(o).length)throw Error('GENERATED_DRAFT_INVALID');
        g.objective=o;
      }
      for(const snapshot of d.snapshots){
        if(typeof snapshot.id!=='string'||!Number.isFinite(Date.parse(snapshot.createdAt))||snapshot.reason!=='CONFIGURATION_VALIDATED')throw Error('SNAPSHOT_INVALID');
        snapshot.setup=BookingSetupSchema.parse(snapshot.setup);if(snapshot.profile)snapshot.profile=parseReleaseProfile(snapshot.profile);
        if(snapshot.objective&&!parseStoredObjective(snapshot.objective))throw Error('SNAPSHOT_INVALID');
      }
      if(d.reports.some(r=>r.version!==1||typeof r.runId!=='string'||!r.summary||!Number.isFinite(Date.parse(r.createdAt))))throw Error('REPORT_INVALID');
      this.document = d;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('DAILY_STATE_UNREADABLE');
      const existing = existsSync(join(this.root,'config.local.json')) || existsSync(join(this.root,'.local/booking-objective/draft.json'));
      this.document = { version: 1, profile: existing ? null : newReleaseProfile(Date.now()), generated: null, delivered: [], snapshots: [], reports: [] };
    }
    return this.document;
  }
  private async persist() {
    await mkdir(join(this.root,'.local/booking-objective'),{recursive:true});
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try{await writeFile(temporary,JSON.stringify(this.document,null,2),{mode:0o600}); await rename(temporary,this.path);}
    catch{this.document=null;throw Error('DAILY_STATE_WRITE_FAILED');}
  }
  async view(s: Dashboard, metadataOnly=false): Promise<DailyView> {
    const d = await this.load(), objective = d.generated?.objective;
    if(metadataOnly)return {profile:d.profile,generated:d.generated,migrationRequired:!d.profile,advice:null,snapshots:d.snapshots.map(({setup,profile,objective,...metadata})=>metadata),reports:d.reports,error:null};
    const connected = new Set(Object.entries(s.browserHealth ?? {}).filter(([,ok])=>ok).map(([w])=>w));
    const permitted = new Set(d.profile?.workers ?? []);
    const unavailable = new Set(['A','B','C','D','E','F','G'].filter(w=>!permitted.has(w)));
    const compiled = objective ? compileObjective(objective,{nowMs:Date.now(),unavailableWorkers:unavailable}) : null;
    const setup = compiled ? savedMangoReleaseSetup(compiled,nextReleaseFor(Date.now(),'MANGO').bookingDate).setup : null;
    // A saved calibration never qualifies a different generated proposal.
    const matchesSaved = setup && s.booking && preferenceDifferences(s.booking.setup,setup).length === 0;
    return { profile: d.profile, generated: d.generated, migrationRequired: !d.profile,
      advice: objective?.strategy === 'SHOTGUN' ? adviseDailyBudget(objective,{nowMs:Date.now(),unavailableWorkers:unavailable},{prior:s.prewarmFeasibility,
        connectedWorkers:connected,calibrationMatches:!!matchesSaved && s.shotgunTimingVerdict?.status==='READY',providerVolumePermitted:false,blockedSubmission:restorationBlocked(s) && !planningMutationBlocked(s)}) : null,
      snapshots: d.snapshots.map(({setup,profile,objective,...metadata})=>metadata), reports: d.reports, error: null };
  }
  saveProfile(value: unknown, s: Dashboard) { return this.exclusive(async()=>{
    if (planningMutationBlocked(s)) throw Error('PLAN_ACTIVE');
    const d = await this.load();if(planningMutationBlocked(s))throw Error('PLAN_ACTIVE');d.profile = parseReleaseProfile(value); d.generated = null; await this.persist();
    return this.view(s);
  }); }
  /** Repeated launches and ticks reuse a deterministic identity; never writes the manual draft or saved authorization. */
  tick(s: Dashboard, deliver?: (notice: LocalNotice) => boolean, now=Date.now(), force=false) { return this.exclusive(async()=>{
    const d = await this.load(); let changed = false;
    const releaseMs = s.planDate?.planDate ? releaseInstantFor(s.planDate.planDate,'MANGO') : s.booking?.releaseMs ?? Infinity;
    // No metadata IO on the dispatch critical path; runner timing remains unchanged.
    if ((s.activeApiRelease || s.scheduledRelease) && Math.abs(releaseMs-now)<15_000) return this.view(s,true);
    if ((d.profile?.enabled || force) && d.profile && !planningMutationBlocked(s)) {
      const generated = generateReleaseDraft(d.profile,now);
      if (generated.id !== d.generated?.id) { d.generated = generated; changed = true; }
    }
    const report = postRunReport(s,d.reports.find(r=>r.runId!==s.runSummaryRunId),now);
    if(report){
      const existing=d.reports.find(r=>r.runId===report.runId);
      if(existing)report.createdAt=existing.createdAt;
      if(!existing||JSON.stringify(existing)!==JSON.stringify(report)){
        d.reports=[report,...d.reports.filter(r=>r.runId!==report.runId)].slice(0,50);changed=true;
        const directory=join(this.root,'.local/booking-objective/run-reports');await mkdir(directory,{recursive:true});
        const path=join(directory,`${report.runId}.json`),temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(report,null,2),{mode:0o600});await rename(temp,path);
      }
    }
    if (d.profile?.notifications && deliver && s.booking) {
      const workers = s.booking.setup.PRECISION_PHASE3?.wave1.map(w=>w.workerId) ?? [];
      const notices = releaseNotices({ fingerprint:s.booking.fingerprint,releaseMs,armed:!!s.activeApiRelease||!!s.scheduledRelease,
        prepared:!!s.ready && s.preparedPlanFingerprint===s.booking.fingerprint,calibration:s.shotgunTimingVerdict?.status??'NOT_TESTED',
        browsersConnected:workers.length>0&&workers.every(w=>s.browserHealth?.[w]),runId:s.runSummaryRunId,settled:s.runSummary?.settled,
        holds:s.runSummary?.holds,unknown:s.runSummary?.unknown,draftId:d.generated?.id,draftPending:!!d.generated },now,d.profile.reminders);
      for (const notice of notices) if (!d.delivered.includes(notice.id)) {
        // Reserve durably BEFORE showing: at-most-once across crashes/restarts (OS delivery is best effort).
        d.delivered.push(notice.id); await this.persist();
        if (!deliver(notice)) { d.delivered = d.delivered.filter(id=>id!==notice.id); changed=true; }
      }
    }
    if (changed) await this.persist(); return this.view(s);
  }); }
  snapshot(s: Dashboard, objective: ConfigurationSnapshot['objective']) { return this.exclusive(async()=>{
    if (planningMutationBlocked(s) || !s.booking || !s.build || s.build.dirty || s.planDate?.status==='STALE') throw Error('SNAPSHOT_REQUIRES_VALIDATED_SAVED_PLAN');
    const setup = BookingSetupSchema.parse(s.booking.setup), d=await this.load();
    const last = d.snapshots[0];
    if (last && !preferenceDifferences(last.setup,setup).length && !preferenceDifferences(last.profile,d.profile).length && !preferenceDifferences(last.objective,objective).length && !preferenceDifferences(last.calibration,s.shotgunTimingVerdict??null).length && last.build?.buildId===s.build.buildId) return last;
    const entry:ConfigurationSnapshot = {id:randomUUID(),createdAt:new Date().toISOString(),setup,profile:d.profile?structuredClone(d.profile):null,
      objective:objective?structuredClone(objective):null,build:s.build,calibration:s.shotgunTimingVerdict??null,reason:'CONFIGURATION_VALIDATED'};
    d.snapshots = [entry,...d.snapshots].slice(0,20); await this.persist(); return entry;
  }); }
  async snapshotById(id: string) { const entry=(await this.load()).snapshots.find(s=>s.id===id); if(!entry)throw Error('SNAPSHOT_NOT_FOUND');return structuredClone(entry); }
}
