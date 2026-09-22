import { describe, expect, it } from 'vitest';
import { AdaptiveDirectLaneGate } from '../../src/api-booking/adaptive-direct-lane.js';

describe('E/F adaptive lane fail-closed gate', () => {
  it('lets the first attempt commit and permanently blocks the other', () => {
    const gate = new AdaptiveDirectLaneGate();
    expect(gate.commitment).toBe('watching');
    expect(gate.tryCommit('proof')).toBe(true);
    expect(gate.commitment).toBe('proof');
    expect(gate.tryCommit('proofless')).toBe(false);
    expect(gate.tryCommit('proof')).toBe(false);
  });

  it('lets proofless win the race when it commits first', () => {
    const gate = new AdaptiveDirectLaneGate();
    expect(gate.tryCommit('proofless')).toBe(true);
    expect(gate.tryCommit('proof')).toBe(false);
    expect(gate.commitment).toBe('proofless');
  });

  it('reopens proofless eligibility only after a conclusive pre-dispatch proof failure', () => {
    const gate = new AdaptiveDirectLaneGate();
    gate.tryCommit('proof');
    gate.releaseProofCommitment();
    expect(gate.commitment).toBe('watching');
    expect(gate.tryCommit('proofless')).toBe(true);
  });

  it('never reopens once proofless has already committed', () => {
    const gate = new AdaptiveDirectLaneGate();
    gate.tryCommit('proofless');
    gate.releaseProofCommitment();
    expect(gate.commitment).toBe('proofless');
  });

  it('never reopens a proof commitment once a possible dispatch occurred (no manual release call)', () => {
    const gate = new AdaptiveDirectLaneGate();
    gate.tryCommit('proof');
    // Caller observed a possibly-dispatched or verified outcome and correctly
    // never calls releaseProofCommitment(); eligibility stays permanently closed.
    expect(gate.tryCommit('proofless')).toBe(false);
    expect(gate.commitment).toBe('proof');
  });
});
