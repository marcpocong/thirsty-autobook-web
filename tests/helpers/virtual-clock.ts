/**
 * Deterministic time for observer tests. Any number of sleeps can be pending; time only
 * moves when the test advances it, one due timer at a time, flushing promise work in between.
 */
export class VirtualClock {
  private timers: Array<{ at: number; order: number; done: () => void }> = [];
  private order = 0;
  constructor(public now: number) {}

  readonly nowFn = () => this.now;

  /** Same contract as the watch's sleep: resolves at now+ms, or at once when the signal aborts. */
  readonly sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(done => {
    if (signal?.aborted) { done(); return; }
    const timer = { at: this.now + Math.max(0, ms), order: this.order++, done: () => { signal?.removeEventListener('abort', onAbort); done(); } };
    const onAbort = () => { this.timers = this.timers.filter(value => value !== timer); done(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    this.timers.push(timer);
  });

  /** A reader that answers `value` after `ms` of virtual time (or rejects on abort). */
  delayed<T>(ms: number, value: () => T, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(Error('ABORTED')); return; }
      const abort = () => reject(Error('ABORTED'));
      signal?.addEventListener('abort', abort, { once: true });
      void this.sleep(ms, signal).then(() => { if (!signal?.aborted) { signal?.removeEventListener('abort', abort); try { resolve(value()); } catch (error) { reject(error); } } });
    });
  }

  async settle() { for (let index = 0; index < 5; index++) await new Promise<void>(done => setImmediate(done)); }

  /** Advances to `until` (or until no timers remain), firing timers in time order. */
  async advance(until = Infinity) {
    await this.settle();
    while (true) {
      const next = [...this.timers].sort((a, b) => a.at - b.at || a.order - b.order)[0];
      if (!next || next.at > until) break;
      this.timers = this.timers.filter(value => value !== next);
      this.now = Math.max(this.now, next.at);
      next.done();
      await this.settle();
    }
    if (Number.isFinite(until)) this.now = Math.max(this.now, until);
    await this.settle();
  }

  /** Runs until `promise` settles. */
  async runUntil<T>(promise: Promise<T>): Promise<T> {
    let finished = false;
    void promise.then(() => { finished = true; }, () => { finished = true; });
    while (!finished) {
      if (!this.timers.length) { await this.settle(); if (!finished && !this.timers.length) throw Error('VIRTUAL_CLOCK_STALLED'); continue; }
      const next = [...this.timers].sort((a, b) => a.at - b.at || a.order - b.order)[0]!;
      await this.advance(next.at);
    }
    return promise;
  }
}
