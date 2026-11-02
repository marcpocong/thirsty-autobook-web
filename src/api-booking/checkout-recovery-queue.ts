import type { WorkerId } from '../workers.js';

/** Off the dispatch path: fan-out responses sharing one profile recover serially.
 * Each work item still acquires the production recovery claim and revalidates its original capture. */
export class CheckoutRecoveryQueue {
  private readonly tails = new Map<WorkerId, Promise<void>>();
  run<T>(worker: WorkerId, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(worker) ?? Promise.resolve()).then(work);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(worker, tail);
    void tail.then(() => { if (this.tails.get(worker) === tail) this.tails.delete(worker); });
    return result;
  }
}
