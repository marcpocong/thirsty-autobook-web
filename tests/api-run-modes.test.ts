import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandSpec } from '../ui/processes.js';
import { API_RUN_MODES } from '../src/api-run-modes.js';

let previous: string | undefined;
beforeEach(() => { previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1'; });
afterEach(() => { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; });

describe('the app spawns every API runner mode the runner supports', () => {
  // 48c21bf shipped the runner's security-check mode while the app's spawn schema still refused it (ZodError), so the
  // pre-release security check could never start in the installed app; fake-runner tests could not see it.
  it.each(API_RUN_MODES)('accepts %s and passes it to the runner unchanged', mode => {
    const spec = commandSpec({ kind: 'apiRun', mode, date: '2026-10-22', fingerprint: 'a'.repeat(64), checkoutMethod: 'proofless' }, 'C:/install', 'C:/install/.local/runtime/node.exe');
    expect(spec).toMatchObject({ executable: 'C:/install/.local/runtime/node.exe', automation: true });
    const args = (spec as { args: string[] }).args;
    expect(args.at(-2)).toMatch(/src[\\/]api-booking[\\/]desktop-runner\.ts$/);
    expect(JSON.parse(args.at(-1)!)).toMatchObject({ mode, date: '2026-10-22', fingerprint: 'a'.repeat(64) });
  });
  it('arms the live environment only for live modes: the security check can never submit', () => {
    const live = (mode: typeof API_RUN_MODES[number]) => (commandSpec({ kind: 'apiRun', mode, date: '2026-10-22', fingerprint: 'a'.repeat(64) }, 'C:/install', 'node') as { apiLive?: boolean }).apiLive;
    expect(API_RUN_MODES.filter(live)).toEqual(['live', 'live-now']);
  });
});
