import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { objectiveFromLegacySetup, parseStoredObjective, type BookingObjective } from '../src/booking-objective.js';
import type { SavedShotgunPreset } from '../src/shotgun-advisor.js';
import type { BookingSetup } from '../src/config.js';

/**
 * Booking Setup draft persistence. The draft is separate from the saved release authorization (config.local.json):
 * "Save Draft" never changes what can be armed. The binding records which objective fingerprint produced the saved
 * release plan fingerprint, so the UI can show whether the plan on screen is exactly the one preparation will use.
 */
export interface ObjectiveBinding { objectiveFingerprint: string; configFingerprint: string; savedAt: string }
export interface ObjectiveDocument { version: 1; objective: BookingObjective; savedAt: string; binding: ObjectiveBinding | null }
const DIRECTORY = '.local/booking-objective';
async function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temporary, path);
}
export class ObjectiveStore {
  constructor(private root: string) {}
  private path(name: string) { return join(this.root, DIRECTORY, name); }
  async load(legacySetup: BookingSetup | null, nowMs = Date.now()): Promise<{ document: ObjectiveDocument | null; migrated: BookingObjective | null; notes: string[]; presets: SavedShotgunPreset[] }> {
    let document: ObjectiveDocument | null = null;
    try { const value = JSON.parse(await readFile(this.path('draft.json'), 'utf8')) as ObjectiveDocument; const objective = parseStoredObjective(value.objective);
      if (value.version === 1 && objective) document = { ...value, objective }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let migrated: BookingObjective | null = null, notes: string[] = [];
    // In-memory interpretation of the existing saved Mango plan. Nothing is written until the operator saves.
    if (!document && legacySetup) { const result = objectiveFromLegacySetup(legacySetup as never, nowMs); migrated = result.objective; notes = result.notes; }
    return { document, migrated, notes, presets: await this.presets() };
  }
  async save(objective: unknown, binding?: ObjectiveBinding | null): Promise<ObjectiveDocument> {
    const parsed = parseStoredObjective(objective); if (!parsed) throw Error('OBJECTIVE_INVALID');
    if (JSON.stringify(parsed).length > 100_000) throw Error('OBJECTIVE_TOO_LARGE');
    await mkdir(join(this.root, DIRECTORY), { recursive: true });
    let previous: ObjectiveDocument | null = null;
    try { previous = JSON.parse(await readFile(this.path('draft.json'), 'utf8')) as ObjectiveDocument; } catch { /* first save */ }
    const document: ObjectiveDocument = { version: 1, objective: parsed, savedAt: new Date().toISOString(), binding: binding === undefined ? previous?.binding ?? null : binding };
    await atomicWrite(this.path('draft.json'), document);
    return document;
  }
  async presets(): Promise<SavedShotgunPreset[]> {
    try { const value = JSON.parse(await readFile(this.path('shotgun-presets.json'), 'utf8')) as { version: 1; presets: SavedShotgunPreset[] }; return value.version === 1 && Array.isArray(value.presets) ? value.presets : []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async savePresets(presets: unknown): Promise<SavedShotgunPreset[]> {
    if (!Array.isArray(presets) || presets.length > 50 || JSON.stringify(presets).length > 200_000) throw Error('PRESETS_INVALID');
    const clean = presets.filter((p): p is SavedShotgunPreset => !!p && typeof p.id === 'string' && typeof p.name === 'string' && !!p.settings && typeof p.settings === 'object');
    if (clean.length !== presets.length || new Set(clean.map(p => p.name.toLowerCase())).size !== clean.length) throw Error('PRESETS_INVALID');
    await mkdir(join(this.root, DIRECTORY), { recursive: true });
    await atomicWrite(this.path('shotgun-presets.json'), { version: 1, presets: clean });
    return clean;
  }
}
