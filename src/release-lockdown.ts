import { performance } from 'node:perf_hooks';

export type ReleaseLockdownState = 'IDLE' | 'RELEASE_CRITICAL_LOCKDOWN' | 'FLUSHING';
export interface LockdownMark { name: string; atMs: number; windowMs: 50 | 20 | 10 | 0 }
export interface LockdownSummary { enteredAtMs: number | null; exitedAtMs: number | null; deferred: number; flushed: number; marks: LockdownMark[];
  workInFinal50Ms: number; workInFinal20Ms: number; workInFinal10Ms: number }

/**
 * In-memory release-window coordinator. Required journal and safety work must never be passed here;
 * only explicitly nonessential callbacks may be deferred. No formatting, I/O or callback execution occurs
 * between enter() and exit().
 */
export class ReleaseCriticalLockdown {
  state: ReleaseLockdownState = 'IDLE';
  private queue: Array<() => void> = [];
  private marks: LockdownMark[] = [];
  private enteredAt: number | null = null;
  private exitedAt: number | null = null;
  private flushed = 0;
  constructor(private readonly releaseMonoMs: number, private readonly now: () => number = () => performance.now()) {}
  enter(): void { if (this.state !== 'IDLE') return; this.enteredAt = this.now(); this.state = 'RELEASE_CRITICAL_LOCKDOWN'; }
  mark(name: string): void {
    if (this.state !== 'RELEASE_CRITICAL_LOCKDOWN') return;
    const atMs = this.now() - this.releaseMonoMs, before = -atMs;
    this.marks.push({ name, atMs: Math.round(atMs * 100) / 100, windowMs: before >= 0 && before <= 10 ? 10 : before <= 20 && before >= 0 ? 20 : before <= 50 && before >= 0 ? 50 : 0 });
  }
  defer(callback: () => void): void { if (this.state === 'RELEASE_CRITICAL_LOCKDOWN') this.queue.push(callback); else callback(); }
  exit(): void {
    if (this.state !== 'RELEASE_CRITICAL_LOCKDOWN') return;
    this.exitedAt = this.now(); this.state = 'FLUSHING';
    const queued = this.queue.splice(0); setImmediate(() => { for (const callback of queued) { try { callback(); } finally { this.flushed++; } } this.state = 'IDLE'; });
  }
  summary(): LockdownSummary {
    const count = (window: 10 | 20 | 50) => this.marks.filter(mark => mark.windowMs > 0 && mark.windowMs <= window).length;
    return { enteredAtMs: this.enteredAt === null ? null : this.enteredAt - this.releaseMonoMs, exitedAtMs: this.exitedAt === null ? null : this.exitedAt - this.releaseMonoMs,
      deferred: this.queue.length + this.flushed, flushed: this.flushed, marks: [...this.marks], workInFinal50Ms: count(50), workInFinal20Ms: count(20), workInFinal10Ms: count(10) };
  }
}
