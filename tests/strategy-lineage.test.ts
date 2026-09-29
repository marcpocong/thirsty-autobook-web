import { describe, expect, it } from 'vitest';
import { emptySmartDraft, type SmartDraft } from '../src/precision-simple.js';
import { moveSuggestionRow, reconstructLineage, resetSuggestionRow, strategyModificationCount, suggestionLineage } from '../ui/renderer/strategy.js';

const slot = (court: number, start = '19:00') => ({ court, start, durationHours: 3 });
const accepted = (): SmartDraft => ({ ...emptySmartDraft(), immediate: [slot(7), slot(6), slot(5)], backups: [slot(4, '18:00'), slot(3, '20:00')] });

describe('Editable Smart suggestion lineage', () => {
  it('moves B with I1 and resets it to B rather than the row-zero A baseline', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    moveSuggestionRow(current, lineage, 'immediate', 1, -1);
    current.immediate[0] = { ...current.immediate[0]!, court: 1, start: '17:00' };
    expect(lineage.immediate).toEqual(['I1', 'I0', 'I2']);
    expect(resetSuggestionRow(current, baseline, lineage, 'immediate', 0)).toBe(true);
    expect(current.immediate[0]).toEqual(baseline.immediate[1]);
    expect(current.immediate[1]).toEqual(baseline.immediate[0]);
  });

  it('removes A without shifting B identity, then resets B to original B', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    current.immediate.splice(0, 1); lineage.immediate.splice(0, 1);
    current.immediate[0] = { ...current.immediate[0]!, start: '17:00' };
    expect(lineage.immediate).toEqual(['I1', 'I2']);
    expect(resetSuggestionRow(current, baseline, lineage, 'immediate', 0)).toBe(true);
    expect(current.immediate[0]).toEqual(baseline.immediate[1]);
  });

  it('keeps backup origins through reorder and reset', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    moveSuggestionRow(current, lineage, 'backups', 1, -1); current.backups[0] = { ...current.backups[0]!, court: 1 };
    expect(resetSuggestionRow(current, baseline, lineage, 'backups', 0)).toBe(true);
    expect(current.backups[0]).toEqual(baseline.backups[1]);
  });

  it('marks operator-added rows null and gives them no reset baseline', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    current.immediate.push(slot(2)); lineage.immediate.push(null);
    expect(resetSuggestionRow(current, baseline, lineage, 'immediate', 3)).toBe(false);
    expect(strategyModificationCount(current, baseline, lineage)).toBe(1);
  });

  it('persists reordered lineage and reconstructs it after reload', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    moveSuggestionRow(current, lineage, 'immediate', 1, -1); current.immediate[0] = { ...current.immediate[0]!, start: '18:00' };
    const restored = reconstructLineage(structuredClone(current), baseline, structuredClone(lineage));
    expect(restored).toEqual(lineage);
    expect(resetSuggestionRow(current, baseline, restored, 'immediate', 0)).toBe(true);
    expect(current.immediate[0]).toEqual(baseline.immediate[1]);
  });

  it('conservatively recovers old exact rows and leaves modified or added rows originless', () => {
    const baseline = accepted(), current = structuredClone(baseline);
    moveSuggestionRow(current, suggestionLineage(baseline), 'immediate', 1, -1);
    current.immediate[0] = { ...current.immediate[0]!, start: '18:00' }; current.immediate.push(slot(2));
    expect(reconstructLineage(current, baseline).immediate).toEqual([null, 'I0', 'I2', null]);
  });

  it('reset all is an exact accepted-baseline clone with fresh deterministic lineage', () => {
    const baseline = accepted(), current = structuredClone(baseline), lineage = suggestionLineage(baseline);
    moveSuggestionRow(current, lineage, 'immediate', 1, -1); current.immediate.pop(); current.immediate.push(slot(2));
    const reset = structuredClone(baseline), resetLineage = suggestionLineage(baseline);
    expect(reset).toEqual(baseline); expect(resetLineage).toEqual({ immediate: ['I0', 'I1', 'I2'], backups: ['B0', 'B1'] });
  });
});
